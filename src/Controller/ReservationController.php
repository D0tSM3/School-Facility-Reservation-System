<?php

declare(strict_types=1);

namespace CampusRoom\Controller;

use CampusRoom\Core\Auth;
use CampusRoom\Core\DateTimeHelper;
use CampusRoom\Core\Response;
use CampusRoom\Core\ReservationValidator;
use CampusRoom\Repository\ClassScheduleRepository;
use CampusRoom\Repository\ConflictOverrideRepository;
use CampusRoom\Repository\ReservationRepository;
use CampusRoom\Repository\RoomRepository;
use PDOException;

/**
 * ReservationController — Customer, Staff, and Admin reservation endpoints.
 */
class ReservationController
{
    /**
     * Section 2: every reservation is submitted under exactly one category.
     * These strings are the Reservations.category ENUM, verbatim — MySQL would
     * otherwise coerce an unknown value to '' and silently mislabel the row.
     */
    private const CATEGORIES = [
        'Academic Lecture',
        'Faculty Defense',
        'Student Org Meeting',
        'Dept Workshop',
        'Exam/Quiz',
    ];

    private ReservationRepository $reservations;

    public function __construct()
    {
        $this->reservations = new ReservationRepository();
    }

    // ---------------------------------------------------------------
    // Customer: GET /api/reservations/mine
    // ---------------------------------------------------------------

    public function mine(): never
    {
        Auth::requireRole(['Customer']);

        $list = $this->reservations->findByCustomer(Auth::userId());
        Response::json($list);
    }

    // ---------------------------------------------------------------
    // Staff: GET /api/reservations[?status=Pending]
    // ---------------------------------------------------------------

    public function index(): never
    {
        Auth::requireRole(['Staff', 'Admin']);

        $status = $_GET['status'] ?? null;

        // Whitelist allowed status values to avoid feeding arbitrary strings
        // into the query even though they are parameterised.
        $allowed = ['Pending', 'Approved', 'Rejected', 'Cancelled', 'Completed'];
        if ($status !== null && !in_array($status, $allowed, true)) {
            Response::error('status must be one of: ' . implode(', ', $allowed), 422);
        }

        // Optional paging: ?limit= (1..500, default 200) and ?offset= (>= 0).
        $limit  = isset($_GET['limit'])  && ctype_digit((string) $_GET['limit'])  ? (int) $_GET['limit']  : 200;
        $offset = isset($_GET['offset']) && ctype_digit((string) $_GET['offset']) ? (int) $_GET['offset'] : 0;
        $limit  = max(1, min(500, $limit));

        $list = $this->reservations->findAll($status, $limit, $offset);
        Response::json($list);
    }

    // ---------------------------------------------------------------
    // Any role: GET /api/reservations/{id}
    // Customers may only read their own booking.
    // ---------------------------------------------------------------

    public function show(string $reservationId): never
    {
        Auth::requireRole(['Customer', 'Staff', 'Admin']);

        $reservation = $this->reservations->findByIdDetailed($reservationId);
        if ($reservation === null) {
            Response::error('Reservation not found.', 404);
        }

        // Without this check any logged-in user could enumerate every booking on campus.
        if (Auth::role() === 'Customer' && $reservation['customer_id'] !== Auth::userId()) {
            Response::error('Forbidden.', 403);
        }

        if ($reservation['series_id'] !== null) {
            $reservation['series'] = $this->reservations->findSeries($reservation['series_id']);
        }

        Response::json($reservation);
    }

    // ---------------------------------------------------------------
    // Any role: GET /api/reservations/{id}/logs[?limit=&offset=]
    // Audit history of one booking. Customers may only read their own.
    // ---------------------------------------------------------------

    public function logs(string $reservationId): never
    {
        Auth::requireRole(['Customer', 'Staff', 'Admin']);

        $reservation = $this->reservations->findById($reservationId);
        if ($reservation === null) {
            Response::error('Reservation not found.', 404);
        }

        // Same ownership rule as show(). Without it this route would leak the
        // activity of every booking on campus to any logged-in user.
        $isCustomer = Auth::role() === 'Customer';
        if ($isCustomer && $reservation['customer_id'] !== Auth::userId()) {
            Response::error('Forbidden.', 403);
        }

        $limit  = isset($_GET['limit'])  && ctype_digit((string) $_GET['limit'])  ? (int) $_GET['limit']  : 100;
        $offset = isset($_GET['offset']) && ctype_digit((string) $_GET['offset']) ? (int) $_GET['offset'] : 0;
        $limit  = max(1, min(500, $limit));

        $filters = ['reservation_id' => $reservationId];
        $items   = $this->reservations->findLogs($filters, $limit, $offset);

        // A requester sees who acted (name + role) but not staff email addresses.
        if ($isCustomer) {
            $items = array_map(static function (array $row): array {
                unset($row['actor_email']);
                return $row;
            }, $items);
        }

        Response::json([
            'items'  => $items,
            'total'  => $this->reservations->countLogs($filters),
            'limit'  => $limit,
            'offset' => $offset,
        ]);
    }

    // ---------------------------------------------------------------
    // Customer: POST /api/reservations
    // ---------------------------------------------------------------

    public function store(): never
    {
        Auth::requireRole(['Customer']);
        $body = $this->jsonBody();
        [
            'room_id' => $roomId, 'purpose' => $purpose, 'category' => $category,
            'equipment_notes' => $equipmentNotes, 'start_time' => $startTime, 'end_time' => $endTime,
        ] = $this->bookingRequest($body);

        // Different dates = a multi-day booking: start_time's date to
        // end_time's date, using start_time's clock to end_time's clock as the
        // window on every one of those days.
        $activeDates = $body['active_dates'] ?? null;
        if (substr($startTime, 0, 10) !== substr($endTime, 0, 10)) {
            $this->storeSeries($roomId, $purpose, $category, $equipmentNotes, $startTime, $endTime, $activeDates);
        }

        $error = ReservationValidator::check($roomId, $startTime, $endTime);
        if ($error !== null) {
            $this->conflictError($error, $roomId, $startTime, $endTime, $activeDates);
        }

        // A clean single-day booking is approved on the spot unless the room
        // asks for Staff review. Anything that must wait lands as Pending and
        // shows up in the Staff / Admin Approval Queue.
        [$status, $approvalType] = $this->approvalOutcome($roomId, 1);

        try {
            $reservation = $this->reservations->create(
                Auth::userId(),
                $roomId,
                $purpose,
                $startTime,
                $endTime,
                $equipmentNotes !== '' ? $equipmentNotes : null,
                $category,
                null,
                $status,
                $approvalType
            );
        } catch (PDOException $e) {
            // Fallback in case of race condition caught by the DB trigger
            if ($e->getCode() === '45000') {
                Response::error(
                    'Scheduling Collision: Room is already booked or pending during this time window.',
                    409
                );
            }
            throw $e;
        }

        // The booking's audit trail now starts at submission, not approval.
        $dayLabel = self::compactDates([substr((string) $startTime, 0, 10)], true);
        $this->reservations->insertLog(
            Auth::userId(),
            "Reservation submitted by requester [{$dayLabel}]",
            $reservation['reservation_id']
        );
        $this->logAutoApproval($status, $approvalType, [$reservation['reservation_id']]);

        Response::json($reservation, 201);
    }

    /**
     * The fields of a new booking request (POST /api/reservations and POST
     * /api/conflict-override-requests share them), validated and normalised.
     * Ends the request with 422 on the first problem.
     *
     * @return array{room_id: string, purpose: string, category: string, equipment_notes: string, start_time: string, end_time: string}
     */
    private function bookingRequest(array $body): array
    {
        $roomId    = trim((string) ($body['room_id']    ?? ''));
        $purpose   = trim((string) ($body['purpose']    ?? ''));
        $startTime = trim((string) ($body['start_time'] ?? ''));
        $endTime   = trim((string) ($body['end_time']   ?? ''));
        $category  = trim((string) ($body['category']   ?? ''));
        $equipmentNotes = trim((string) ($body['equipment_notes'] ?? ''));

        if ($roomId === '' || $purpose === '' || $startTime === '' || $endTime === '') {
            Response::error('room_id, purpose, start_time, and end_time are required.', 422);
        }

        // Required rather than defaulted: silently filing an uncategorised
        // booking as 'Academic Lecture' would put wrong data in a column staff
        // are meant to report on.
        if (!in_array($category, self::CATEGORIES, true)) {
            Response::error('category must be one of: ' . implode(', ', self::CATEGORIES) . '.', 422);
        }

        // Reservations.purpose is VARCHAR(255); mb_strlen() counts characters,
        // not bytes, so multi-byte input doesn't slip past the DB's limit
        // and come back as a raw SQL error (Fix Guide 1.4 / Section 6).
        if (mb_strlen($purpose) > 255) {
            Response::error('purpose must be 255 characters or fewer.', 422);
        }

        if (mb_strlen($equipmentNotes) > 500) {
            Response::error('equipment_notes must be 500 characters or fewer.', 422);
        }

        // Normalise once, here at the boundary: the validator, repository and
        // DB trigger below all see 'Y-m-d H:i:s' whatever shape the client sent.
        $startTime = DateTimeHelper::toMysqlDateTime($startTime);
        $endTime   = DateTimeHelper::toMysqlDateTime($endTime);
        if ($startTime === null || $endTime === null) {
            Response::error('start_time and end_time must be valid timestamps.', 422);
        }

        // No bookings in the past. The client hides past dates (Fix Guide
        // 1.5), but the API must not trust that; the PHP default timezone
        // is already Asia/Manila.
        if (strtotime($startTime) <= time()) {
            Response::error('The start time must be in the future.', 422);
        }

        return [
            'room_id'         => $roomId,
            'purpose'         => $purpose,
            'category'        => $category,
            'equipment_notes' => $equipmentNotes,
            'start_time'      => $startTime,
            'end_time'        => $endTime,
        ];
    }

    /**
     * The approved booking that alone stands in the way of this request, or
     * null. "Alone" means the request passes every other rule (closed day,
     * hours, holiday, class, Pending bookings) once Approved bookings are
     * ignored — only then can staff resolve it by moving that booking.
     * start/end follow the POST convention: dates = range, clocks = daily window.
     */
    /**
     * The other customer's booking a request slip could resolve for this slot,
     * or null if nothing can. Only a clash with another user's Pending/Approved
     * reservation is overridable; a class schedule, holiday, closed day or
     * business-hours violation is a hard block a slip cannot resolve.
     */
    private function overridableConflict(string $roomId, string $startTime, string $endTime, ?array $activeDates = null): ?array {
        $startDate  = substr($startTime, 0, 10);
        $endDate    = substr($endTime, 0, 10);
        $dailyStart = substr($startTime, 11);
        $dailyEnd   = substr($endTime, 11);

        // General rules (room, hours, closed days, holidays, classes) are hard
        // blocks: if any trips here — reservations ignored — no slip can help.
        if (ReservationValidator::checkRange($roomId, $startDate, $endDate, $dailyStart, $dailyEnd, [], [], $activeDates) !== null) {
            return null;
        }

        $conflict = ReservationValidator::findConflictingReservation($roomId, $startDate, $endDate, $dailyStart, $dailyEnd, $activeDates);
        // Nobody overrides their own booking; they'd move it instead.
        if ($conflict === null || $conflict['customer_id'] === Auth::userId()) {
            return null;
        }
        return ['type' => 'reservation', 'reservation' => $conflict];
    }

    /**
     * End a booking request with 409, telling the client whether the customer
     * may file a conflict override request instead. Only the clashing time is
     * shared, never whose booking it is.
     */
    private function conflictError(string $error, string $roomId, string $startTime, string $endTime, ?array $activeDates = null): never
    {
        $c = $this->overridableConflict($roomId, $startTime, $endTime, $activeDates);
        $conflictInfo = null;
        if ($c !== null && $c['type'] === 'reservation') {
            $conflictInfo = ['start_time' => $c['reservation']['start_time'], 'end_time' => $c['reservation']['end_time']];
        } elseif ($c !== null && $c['type'] === 'class') {
            $conflictInfo = ['class' => $c['class']['course_code'] . ' - ' . $c['class']['section']];
        }
        Response::error($error, 409, [
            'override_eligible' => $c !== null,
            'conflict_kind'     => $c['type'] ?? null,
            'conflict'          => $conflictInfo,
        ]);
    }

    // ---------------------------------------------------------------
    // Customer: POST /api/conflict-override-requests
    // Same body as POST /api/reservations plus `reason`. Accepted only when
    // the slot is blocked solely by another customer's booking.
    // ---------------------------------------------------------------

    public function requestOverride(): never
    {
        Auth::requireRole(['Customer']);

        $body    = $this->jsonBody();
        $request = $this->bookingRequest($body);

        $reason = trim((string) ($body['reason'] ?? ''));
        if ($reason === '') {
            Response::error('Please explain why this booking is urgent.', 422);
        }
        if (mb_strlen($reason) > 500) {
            Response::error('reason must be 500 characters or fewer.', 422);
        }

        $startDate   = substr($request['start_time'], 0, 10);
        $endDate     = substr($request['end_time'], 0, 10);
        $activeDates = is_array($body['active_dates'] ?? null) ? $body['active_dates'] : null;
        $error       = ReservationValidator::checkRange(
            $request['room_id'], $startDate, $endDate,
            substr($request['start_time'], 11), substr($request['end_time'], 11),
            [], ['Pending', 'Approved'], $activeDates
        );
        if ($error === null) {
            Response::error('This slot is free. Submit a normal reservation request instead.', 422);
        }

        // The conflicting item is worked out here, never taken from the client.
        $conflict = $this->overridableConflict($request['room_id'], $request['start_time'], $request['end_time'], $activeDates);
        if ($conflict === null) {
            Response::error("An override can't resolve this: {$error}", 409);
        }

        $overrides   = new ConflictOverrideRepository();
        $isClass     = $conflict['type'] === 'class';
        $conflictRes = $isClass ? null : $conflict['reservation']['reservation_id'];
        $conflictCls = $isClass ? $conflict['class']['schedule_id'] : null;

        if ($isClass && $overrides->hasPendingForClass(Auth::userId(), $conflictCls)) {
            Response::error('You already have a request awaiting review for this class conflict.', 409);
        }
        if (!$isClass && $overrides->hasPendingFor(Auth::userId(), $conflictRes)) {
            Response::error('You already have an override request awaiting review for this slot.', 409);
        }

        $requestType    = trim((string) ($body['request_type'] ?? ''));
        $additionalInfo = trim((string) ($body['additional_info'] ?? ''));
        $altStartTime   = trim((string) ($body['alt_start_time'] ?? ''));
        $altEndTime     = trim((string) ($body['alt_end_time'] ?? ''));

        $override = $overrides->create(
            Auth::userId(),
            $request['room_id'],
            $request['start_time'],
            $request['end_time'],
            $request['purpose'],
            $request['category'],
            $request['equipment_notes'] !== '' ? $request['equipment_notes'] : null,
            $reason,
            $conflictRes,
            $requestType !== '' ? $requestType : null,
            $altStartTime !== '' ? $altStartTime : null,
            $altEndTime !== '' ? $altEndTime : null,
            $additionalInfo !== '' ? $additionalInfo : null,
            $conflictCls
        );

        // Logged against the booking it targets (class conflicts have no booking).
        $this->reservations->insertLog(
            Auth::userId(),
            $isClass ? 'Request slip filed against an official class schedule' : 'Conflict override requested by another requester',
            $conflictRes
        );

        Response::json($override, 201);
    }

    // ---------------------------------------------------------------
    // Customer: DELETE /api/conflict-override-requests/{id}
    // ---------------------------------------------------------------

    public function cancelOverride(string $id): never
    {
        Auth::requireRole(['Customer']);

        $overrides = new ConflictOverrideRepository();
        $override  = self::isUuid($id) ? $overrides->findById($id) : null;
        if ($override === null) {
            Response::error('Override request not found.', 404);
        }
        if ($override['requested_by'] !== Auth::userId()) {
            Response::error('You can only withdraw your own request slips.', 403);
        }
        if ($override['status'] !== 'Pending') {
            Response::error('Only pending request slips can be withdrawn.', 422);
        }

        $overrides->delete($id);
        Response::json(['success' => true, 'message' => 'Request slip withdrawn successfully.']);
    }

    // ---------------------------------------------------------------
    // Customer: GET /api/conflict-override-requests/mine
    // ---------------------------------------------------------------

    public function myOverrides(): never
    {
        Auth::requireRole(['Customer']);
        Response::json((new ConflictOverrideRepository())->findByRequester(Auth::userId()));
    }

    /**
     * Create one Pending row per day of a multi-day booking, all sharing a
     * series_id, in a single transaction. Responds with the first day's row
     * plus the whole series under `series`.
     */
    private function storeSeries(
        string $roomId,
        string $purpose,
        string $category,
        string $equipmentNotes,
        string $startTime,
        string $endTime,
        ?array $activeDates = null
    ): never {
        $startDate   = substr($startTime, 0, 10);
        $endDate     = substr($endTime, 0, 10);
        $dailyStart  = substr($startTime, 11);
        $dailyEnd    = substr($endTime, 11);

        $error = ReservationValidator::checkRange($roomId, $startDate, $endDate, $dailyStart, $dailyEnd, [], ['Pending', 'Approved'], $activeDates);
        if ($error !== null) {
            $this->conflictError($error, $roomId, $startTime, $endTime, $activeDates);
        }

        // Whole-range decision: a short, clean hold is auto-approved for every
        // day; a range longer than the policy limit, or a room that asks for
        // it, waits as Pending (see approvalOutcome()).
        $dayCount = count(ReservationValidator::datesBetween($startDate, $endDate) ?? []);
        if (is_array($activeDates) && count($activeDates) > 0) {
            $dayCount = count(array_intersect(ReservationValidator::datesBetween($startDate, $endDate) ?? [], $activeDates));
        }
        [$status, $approvalType] = $this->approvalOutcome($roomId, $dayCount);

        try {
            $rows = $this->createBookingRows(
                Auth::userId(), $roomId, $purpose, $category,
                $equipmentNotes !== '' ? $equipmentNotes : null, $startTime, $endTime, $activeDates, $status, $approvalType
            );
        } catch (PDOException $e) {
            if ($e->getCode() === '45000') {
                Response::error(
                    'Scheduling Collision: Room is already booked or pending during this time window.',
                    409
                );
            }
            throw $e;
        }

        // One combined audit entry for the whole booking, not one per day.
        // A consecutive range reads 'Oct 1 - 3'; separately chosen days read
        // 'Oct 1, 2, 4'. Attached to the first day, which anchors the series.
        $dates   = array_map(static fn(array $r): string => substr((string) $r['start_time'], 0, 10), $rows);
        $isRange = !(is_array($activeDates) && count($activeDates) > 0);
        $label   = self::compactDates($dates, $isRange);

        $this->reservations->insertLog(
            Auth::userId(),
            "Reservation submitted by requester [{$label}]",
            $rows[0]['reservation_id']
        );
        if ($status === 'Approved' && $approvalType === 'auto') {
            $this->reservations->insertLog(
                Auth::userId(),
                "Auto-approved: no conflicts found [{$label}]",
                $rows[0]['reservation_id']
            );
        }

        Response::json($rows[0] + ['series' => $rows], 201);
    }

    /**
     * Insert the Pending row(s) for a booking in one transaction: one row when
     * start and end share a date, otherwise one per day sharing a series_id
     * (dates = range, clocks = daily window). Validation is the caller's job.
     * Throws PDOException (45000 = the double-booking trigger) on a clash.
     *
     * @return array[] the created rows, earliest first
     */
    private function createBookingRows(
        string $customerId,
        string $roomId,
        string $purpose,
        string $category,
        ?string $equipmentNotes,
        string $startTime,
        string $endTime,
        ?array $activeDates = null,
        string $status = 'Pending',
        string $approvalType = 'manual'
    ): array {
        $startDate = substr($startTime, 0, 10);
        $endDate   = substr($endTime, 0, 10);

        if ($startDate === $endDate) {
            return [$this->reservations->create($customerId, $roomId, $purpose, $startTime, $endTime, $equipmentNotes, $category, null, $status, $approvalType)];
        }

        
        $days       = ReservationValidator::datesBetween($startDate, $endDate) ?? [];
        if ($activeDates !== null && count($activeDates) > 0) {
            $days = array_values(array_intersect($days, $activeDates));
        }
        if (empty($days)) {
            Response::error('No valid dates selected within the range.', 400);
        }

        $dailyStart = substr($startTime, 11);
        $dailyEnd   = substr($endTime, 11);
        $seriesId   = $this->reservations->newSeriesId();

        return $this->reservations->transaction(function () use ($days, $customerId, $roomId, $purpose, $category, $equipmentNotes, $dailyStart, $dailyEnd, $seriesId, $status, $approvalType): array {
            $rows = [];
            foreach ($days as $day) {
                $rows[] = $this->reservations->create(
                    $customerId, $roomId, $purpose, "$day $dailyStart", "$day $dailyEnd",
                    $equipmentNotes, $category, $seriesId, $status, $approvalType
                );
            }
            return $rows;
        });
    }

    // ---------------------------------------------------------------
    // Staff/Admin: GET /api/conflict-override-requests[?status=Pending]
    // ---------------------------------------------------------------

    public function overrideIndex(): never
    {
        Auth::requireRole(['Staff', 'Admin']);

        $status = $_GET['status'] ?? null;
        if ($status !== null && !in_array($status, ['Pending', 'Approved', 'Rejected'], true)) {
            Response::error('status must be one of: Pending, Approved, Rejected', 422);
        }

        Response::json((new ConflictOverrideRepository())->findAll($status));
    }

    // ---------------------------------------------------------------
    // Staff/Admin: PATCH /api/conflict-override-requests/{id}
    //   { status: 'Rejected', staff_comment? }
    //   { status: 'Approved', staff_comment?, move_start_time, move_end_time }
    //
    // Approving files a move request on the conflicting booking (to the
    // time staff chose). The requester's reservation is created, Pending,
    // only when that move is approved — see resolveMoveRequest(). Until
    // then both would hold the same slot, which the double-booking trigger
    // forbids.
    // ---------------------------------------------------------------

    public function resolveOverride(string $requestId): never
    {
        Auth::requireRole(['Staff', 'Admin']);

        $body         = $this->jsonBody();
        $status       = trim((string) ($body['status'] ?? ''));
        $staffComment = trim((string) ($body['staff_comment'] ?? ''));

        if (!in_array($status, ['Approved', 'Rejected'], true)) {
            Response::error('status must be Approved or Rejected.', 422);
        }
        if (mb_strlen($staffComment) > 500) {
            Response::error('staff_comment must be 500 characters or fewer.', 422);
        }

        $overrides = new ConflictOverrideRepository();
        $override  = self::isUuid($requestId) ? $overrides->findById($requestId) : null;
        if ($override === null) {
            Response::error('Override request not found.', 404);
        }
        if ($override['status'] !== 'Pending') {
            Response::error("This override request is already {$override['status']}.", 422);
        }

        $conflictId = $override['conflicting_reservation_id'];

        if ($status === 'Rejected') {
            $updated = $overrides->decide($requestId, 'Rejected', Auth::userId(), $staffComment !== '' ? $staffComment : null);
            $this->reservations->insertLog(Auth::userId(), 'Conflict override request rejected', $conflictId);
            Response::json($updated);
        }

        // A class schedule can no longer be resolved by a slip. Any such request
        // left over from the old flow (no conflicting reservation) is rejected
        // only — staff relocate the class directly from Class Schedules instead.
        if (empty($conflictId)) {
            Response::error('This request is against a class schedule and cannot be approved. Reject it, then relocate the class from Class Schedules if the room is needed.', 422);
        }

        // --- Approve: propose moving the conflicting booking out of the way ---
        $conflict = $this->reservations->findById($conflictId);
        if ($conflict === null || !in_array($conflict['status'], ['Approved', 'Pending'], true)) {
            Response::error(
                'The conflicting booking is no longer active' . ($conflict ? " ({$conflict['status']})" : '')
                . ', so there is nothing to move. Reject this override; the requester can book the slot normally.',
                409
            );
        }
        if ($this->reservations->hasPendingMoveRequest($conflictId)) {
            Response::error('The conflicting booking already has a move request awaiting review. Resolve that first.', 409);
        }

        $moveStart = DateTimeHelper::toMysqlDateTime(trim((string) ($body['move_start_time'] ?? '')));
        $moveEnd   = DateTimeHelper::toMysqlDateTime(trim((string) ($body['move_end_time'] ?? '')));
        if ($moveStart === null || $moveEnd === null) {
            Response::error('Choose where to move the conflicting booking: move_start_time and move_end_time are required.', 422);
        }
        if (strtotime($moveStart) <= time()) {
            Response::error('The new time for the conflicting booking must be in the future.', 422);
        }

        // Moving it into another part of the requested slot would free nothing.
        $days = ReservationValidator::datesBetween(substr($override['start_time'], 0, 10), substr($override['end_time'], 0, 10)) ?? [];
        $moveDay = substr($moveStart, 0, 10);
        if (in_array($moveDay, $days, true)
            && substr($moveStart, 11) < substr($override['end_time'], 11)
            && substr($moveEnd, 11) > substr($override['start_time'], 11)) {
            Response::error('That new time still overlaps the slot being requested. Pick a time outside it.', 422);
        }

        $error = ReservationValidator::check($conflict['room_id'], $moveStart, $moveEnd, $conflictId);
        if ($error !== null) {
            Response::error("The conflicting booking can't move there: {$error}", 409);
        }

        $updated = $this->reservations->transaction(function () use ($overrides, $requestId, $conflictId, $moveStart, $moveEnd, $staffComment): array {
            $move = $this->reservations->createMoveRequest(
                $conflictId,
                $moveStart,
                $moveEnd,
                'Staff proposed this move so an urgent request can use the original time slot.'
            );
            return $overrides->decide(
                $requestId, 'Approved', Auth::userId(),
                $staffComment !== '' ? $staffComment : null,
                $move['request_id'], 'Awaiting move'
            ) ?? [];
        });

        $this->reservations->insertLog(Auth::userId(), 'Move proposed by staff for a conflict override request', $conflictId);

        Response::json($updated);
    }

    /**
     * Approve a request slip that is blocked by an official class. Staff pick a
     * new room and/or a new weekday/time for the class so the requested slot is
     * freed; the class moves immediately (it has no holder to accept), then the
     * requester's booking is created Pending. Ends the response.
     */
    private function approveClassOverride(array $override, array $body, ?string $staffComment): never
    {
        $overrides = new ConflictOverrideRepository();
        $classRepo = new ClassScheduleRepository();
        $classId   = (string) $override['conflicting_class_id'];

        $class = $classRepo->findById($classId);
        if ($class === null) {
            Response::error('The conflicting class no longer exists. Reject this request; the slot may now be free.', 409);
        }

        $days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

        // Blank fields fall back to the class's current placement.
        $newRoomId = trim((string) ($body['class_room_id'] ?? ''));
        $newDay    = trim((string) ($body['class_day_of_week'] ?? ''));
        $newStart  = self::normaliseClock(trim((string) ($body['class_start_time'] ?? '')));
        $newEnd    = self::normaliseClock(trim((string) ($body['class_end_time'] ?? '')));

        $targetRoom  = $newRoomId !== '' ? $newRoomId : (string) $class['room_id'];
        $targetDay   = $newDay   !== '' ? $newDay   : (string) $class['day_of_week'];
        $targetStart = $newStart !== '' ? $newStart : self::hhmmss((string) $class['start_time']);
        $targetEnd   = $newEnd   !== '' ? $newEnd   : self::hhmmss((string) $class['end_time']);

        if ($newRoomId !== '' && (!self::isUuid($newRoomId) || (new RoomRepository())->findById($newRoomId) === null)) {
            Response::error('The destination room for the class was not found.', 404);
        }
        if (!in_array($targetDay, $days, true)) {
            Response::error('class_day_of_week must be one of: ' . implode(', ', $days) . '.', 422);
        }
        if ($newStart === null || $newEnd === null || $targetEnd <= $targetStart) {
            Response::error('The class start and end times must be valid, with end after start.', 422);
        }

        $unchanged = $targetRoom === (string) $class['room_id']
            && $targetDay === (string) $class['day_of_week']
            && $targetStart === self::hhmmss((string) $class['start_time'])
            && $targetEnd === self::hhmmss((string) $class['end_time']);
        if ($unchanged) {
            Response::error('Choose a different room and/or time for the class — nothing was changed.', 422);
        }

        // The move must actually free the requested slot: if the class stays in
        // the requested room, its new weekday/time must fall outside the request.
        $reqWeekdays = array_unique(array_map(
            static fn(string $d): string => date('l', (int) strtotime($d)),
            ReservationValidator::datesBetween(substr((string) $override['start_time'], 0, 10), substr((string) $override['end_time'], 0, 10)) ?? []
        ));
        if ($targetRoom === (string) $override['room_id']
            && in_array($targetDay, $reqWeekdays, true)
            && $targetStart < substr((string) $override['end_time'], 11)
            && $targetEnd   > substr((string) $override['start_time'], 11)) {
            Response::error('That placement still overlaps the requested slot. Move the class to another room or outside the requested time.', 422);
        }

        // The class's new home must itself be free (ignoring the class itself).
        $classClash = $classRepo->findOverlappingClasses($targetRoom, $targetDay, $targetStart, $targetEnd, $classId);
        if ($classClash) {
            $c = $classClash[0];
            Response::error("The class can't move there: another class holds it ({$c['course_code']} - {$c['section']}).", 409);
        }
        $resClash = $classRepo->findOverlappingReservations($targetRoom, $targetDay, $targetStart, $targetEnd);
        if ($resClash) {
            Response::error('The class can\'t move there: a reservation already occupies that room at that time.', 409);
        }

        // Move the class, then book the requester in the freed slot. Done
        // sequentially (not one transaction) because createBookingRows opens
        // its own for multi-day holds and the PDO driver has no nesting — the
        // same shape settleOverrideAfterMove() uses after a reservation move.
        $classRepo->updatePlacement($classId, $targetRoom, $targetDay, $targetStart, $targetEnd);
        $this->reservations->insertLog(
            Auth::userId(),
            "Class {$class['course_code']} {$class['section']} relocated/rescheduled to resolve a request slip"
        );

        $startDate  = substr((string) $override['start_time'], 0, 10);
        $endDate    = substr((string) $override['end_time'], 0, 10);
        $dailyStart = substr((string) $override['start_time'], 11);
        $dailyEnd   = substr((string) $override['end_time'], 11);

        $error     = ReservationValidator::checkRange($override['room_id'], $startDate, $endDate, $dailyStart, $dailyEnd);
        $createdId = null;
        if ($error === null) {
            try {
                $rows = $this->createBookingRows(
                    $override['requested_by'], $override['room_id'], $override['purpose'], $override['category'],
                    $override['equipment_notes'], $override['start_time'], $override['end_time'], null, 'Approved'
                );
                $createdId = $rows[0]['reservation_id'] ?? null;
            } catch (PDOException $e) {
                if ($e->getCode() !== '45000') {
                    throw $e;
                }
                $error = 'Room is already booked or pending during this time window.';
            }
        }

        $outcome = $createdId !== null ? 'Booked' : 'Booking failed';
        $overrides->decide($override['request_id'], 'Approved', Auth::userId(), $staffComment, null, $outcome);
        $overrides->setOutcome($override['request_id'], $outcome, $createdId !== null ? null : $error, $createdId);
        if ($createdId !== null) {
            $this->reservations->insertLog(Auth::userId(), 'Reservation created from an approved class-conflict request slip', $createdId);
        }

        $updated = $overrides->findById($override['request_id']) ?? [];
        $updated['message'] = $createdId !== null
            ? 'Class moved and the requester\'s booking was created and Approved.'
            : "The class was moved, but the requester's booking couldn't be created: {$error}";
        Response::json($updated);
    }

    /** 'H:MM' or 'HH:MM' or 'HH:MM:SS' -> 'HH:MM:SS'; '' stays ''; null if invalid. */
    private static function normaliseClock(string $value): ?string
    {
        if ($value === '') {
            return '';
        }
        if (preg_match('/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/', $value, $m) !== 1) {
            return null;
        }
        [$h, $i, $s] = [(int) $m[1], (int) $m[2], (int) ($m[3] ?? 0)];
        if ($h > 23 || $i > 59 || $s > 59) {
            return null;
        }
        return sprintf('%02d:%02d:%02d', $h, $i, $s);
    }

    /** Any 'HH:MM[:SS]' (or a timestamp's time part) -> 'HH:MM:SS'. */
    private static function hhmmss(string $value): string
    {
        $t = strlen($value) > 8 ? substr($value, 11) : $value;
        return self::normaliseClock($t) ?: '00:00:00';
    }

    /**
     * Finish an approved override once its move request is decided:
     * approved -> create the requester's Pending reservation(s) in the freed
     * slot; rejected -> record that the slot stays with its holder. Returns
     * a short note for staff, or null if this move wasn't override-driven.
     */
    private function settleOverrideAfterMove(string $moveRequestId, string $moveStatus, ?string $staffComment): ?string
    {
        $overrides = new ConflictOverrideRepository();
        $override  = $overrides->findAwaitingMove($moveRequestId);
        if ($override === null) {
            return null;
        }

        if ($moveStatus === 'Rejected') {
            $overrides->setOutcome($override['request_id'], 'Move rejected', $staffComment);
            return 'The linked override request was not fulfilled: the slot stays with its current holder.';
        }

        $error = ReservationValidator::checkRange(
            $override['room_id'],
            substr($override['start_time'], 0, 10),
            substr($override['end_time'], 0, 10),
            substr($override['start_time'], 11),
            substr($override['end_time'], 11)
        );

        if ($error === null) {
            try {
                $rows = $this->createBookingRows(
                    $override['requested_by'], $override['room_id'], $override['purpose'], $override['category'],
                    $override['equipment_notes'], $override['start_time'], $override['end_time'], null, 'Approved'
                );
            } catch (PDOException $e) {
                if ($e->getCode() !== '45000') {
                    throw $e;
                }
                $error = 'Room is already booked or pending during this time window.';
            }
        }

        if ($error !== null) {
            $overrides->setOutcome($override['request_id'], 'Booking failed', $error);
            return "The move went through, but the override booking couldn't be created: {$error}";
        }

        $overrides->setOutcome($override['request_id'], 'Booked', null, $rows[0]['reservation_id']);
        foreach ($rows as $row) {
            $this->reservations->insertLog(Auth::userId(), 'Reservation created from an approved conflict override request', $row['reservation_id']);
        }
        return 'The override requester\'s booking was created and Approved.';
    }

    private static function isUuid(string $value): bool
    {
        return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value) === 1;
    }

    /**
     * A booking's dates as one compact label for the audit log:
     *   single day            -> 'Oct 1'
     *   consecutive range      -> 'Oct 1 - 2'   (month repeated only across months)
     *   specific/separate days -> 'Oct 1, 2, 3'
     *
     * @param string[] $ymd    'Y-m-d' dates
     * @param bool     $asRange true for a consecutive range, false for a day list
     */
    private static function compactDates(array $ymd, bool $asRange): string
    {
        $ymd = array_values(array_unique(array_filter($ymd)));
        sort($ymd);
        if ($ymd === []) {
            return '';
        }

        $token = static fn(string $d): string => date('M j', (int) strtotime($d)); // 'Oct 1'
        if (count($ymd) === 1) {
            return $token($ymd[0]);
        }

        if ($asRange) {
            $first = $ymd[0];
            $last  = $ymd[count($ymd) - 1];
            // Same month: 'Oct 1 - 2'. Across months: 'Oct 30 - Nov 2'.
            return date('Y-m', (int) strtotime($first)) === date('Y-m', (int) strtotime($last))
                ? $token($first) . ' - ' . date('j', (int) strtotime($last))
                : $token($first) . ' - ' . $token($last);
        }

        // Separate days: name the month once per month it appears.
        $parts = [];
        $lastMonth = null;
        foreach ($ymd as $d) {
            $month = date('Y-m', (int) strtotime($d));
            $parts[] = $month === $lastMonth ? date('j', (int) strtotime($d)) : $token($d);
            $lastMonth = $month;
        }
        return implode(', ', $parts);
    }

    // ---------------------------------------------------------------
    // Staff: PATCH /api/reservations/{id}
    // ---------------------------------------------------------------

    public function update(string $reservationId): never
    {
        Auth::requireRole(['Staff', 'Admin']);

        $body   = $this->jsonBody();
        $status = trim($body['status'] ?? '');

        $allowed = ['Approved', 'Rejected', 'Completed'];
        if (!in_array($status, $allowed, true)) {
            Response::error('status must be one of: ' . implode(', ', $allowed), 422);
        }

        $existing = $this->reservations->findById($reservationId);
        if ($existing === null) {
            Response::error('Reservation not found.', 404);
        }

        // Approving or rejecting one day of a multi-day booking decides the
        // whole booking. Completed stays per day: each day finishes on its own.
        if ($existing['series_id'] !== null && $status !== 'Completed') {
            $this->updateSeriesStatus($existing, $status);
        }

        // A booking that was clean when it was requested can have become
        // impossible since: a class added to that room/day, a holiday declared,
        // the room put under maintenance. Re-check the whole start..end range
        // before it becomes Approved. Only on the way INTO Approved: completing
        // or rejecting must never be blocked by a schedule that changed later.
        // The reservation itself is excluded so it doesn't collide with itself.
        if ($status === 'Approved' && $existing['status'] !== 'Approved') {
            $error = ReservationValidator::check(
                $existing['room_id'],
                $existing['start_time'],
                $existing['end_time'],
                $reservationId
            );
            if ($error !== null) {
                Response::error($error, 409);
            }
        }

        try {
            $reservation = $this->reservations->updateStatus(
                $reservationId,
                $status,
                Auth::userId()
            );
        } catch (PDOException $e) {
            if ($e->getCode() === '45000') {
                Response::error(
                    'Scheduling Collision: Room is already booked or pending during this time window.',
                    409
                );
            }
            throw $e;
        }

        if ($reservation === null) {
            Response::error('Reservation not found.', 404);
        }

        // Audit log for every status change.
        $this->reservations->insertLog(
            Auth::userId(),
            "Reservation status changed to {$status}",
            $reservationId
        );

        Response::json($reservation);
    }

    /**
     * Approve or reject every day of $existing's series that is still in the
     * same status as $existing (a day the customer already cancelled is left
     * alone). Approval re-validates each day first, ignoring the series' own
     * rows so it can't collide with itself. Responds with $existing's updated
     * row plus the whole series under `series`.
     */
    private function updateSeriesStatus(array $existing, string $status): never
    {
        $series  = $this->reservations->findSeries($existing['series_id']);
        $targets = array_values(array_filter(
            $series,
            static fn(array $row): bool => $row['status'] === $existing['status'] && $row['status'] !== $status
        ));
        $seriesIds = array_column($series, 'reservation_id');

        if ($status === 'Approved') {
            foreach ($targets as $row) {
                $day   = substr($row['start_time'], 0, 10);
                $error = ReservationValidator::checkRange(
                    $row['room_id'],
                    $day,
                    $day,
                    substr($row['start_time'], 11, 8),
                    substr($row['end_time'], 11, 8),
                    $seriesIds
                );
                if ($error !== null) {
                    Response::error($error, 409);
                }
            }
        }

        try {
            $this->reservations->transaction(function () use ($targets, $status): void {
                foreach ($targets as $row) {
                    $this->reservations->updateStatus($row['reservation_id'], $status, Auth::userId());
                }
            });
        } catch (PDOException $e) {
            if ($e->getCode() === '45000') {
                Response::error(
                    'Scheduling Collision: Room is already booked or pending during this time window.',
                    409
                );
            }
            throw $e;
        }

        foreach ($targets as $row) {
            $this->reservations->insertLog(
                Auth::userId(),
                "Reservation status changed to {$status} (multi-day booking)",
                $row['reservation_id']
            );
        }

        $updated = $this->reservations->findById($existing['reservation_id']);
        Response::json(($updated ?? $existing) + ['series' => $this->reservations->findSeries($existing['series_id'])]);
    }

    // ---------------------------------------------------------------
    // Customer: PATCH /api/reservations/{id}/cancel
    // ---------------------------------------------------------------

    public function cancel(string $reservationId): never
    {
        Auth::requireRole(['Customer', 'Staff', 'Admin']);

        $existing = $this->reservations->findById($reservationId);
        if ($existing === null) {
            Response::error('Reservation not found.', 404);
        }

        $role    = Auth::role();
        $userId  = Auth::userId();
        $isOwner = $existing['customer_id'] === $userId;

        // A customer may only cancel their own booking. Staff/Admin may
        // cancel anyone's.
        if ($role === 'Customer' && !$isOwner) {
            Response::error('Forbidden.', 403);
        }

        // An Approved booking can be cancelled by its owner directly, with no
        // staff confirmation. The same-day cut-off (Business Rules Art. X Sec. 3)
        // still applies to customers: on the booking date the booking runs its course.
        if ($role === 'Customer' && $existing['status'] === 'Approved' && self::isTooLateToCancel($existing['start_time'])) {
            Response::error(
                'An approved booking cannot be cancelled on the day it takes place. Please contact the facilities desk directly.',
                422
            );
        }

        // Terminal states cannot be re-cancelled.
        if (!in_array($existing['status'], ['Pending', 'Approved'], true)) {
            Response::error(
                "This reservation is {$existing['status']} and can no longer be cancelled.",
                422
            );
        }

        $body   = $this->jsonBody();
        $reason = trim($body['reason'] ?? '');

        // Staff/Admin cancelling on someone else's behalf must say why.
        // (Staff/Admin are never the owner, since customer_id is always a
        // Customer account, so this is effectively "required for staff".)
        if (!$isOwner && $reason === '') {
            Response::error('A cancellation reason is required when cancelling on behalf of a requester.', 422);
        }

        // A requester cancelling their own booking must also say why (Business
        // Rules Art. X Sec. 2); the reason is what Staff/Admin see in the log.
        if ($isOwner && $reason === '') {
            Response::error('Please give a reason for cancelling.', 422);
        }
        if (mb_strlen($reason) > 250) {
            Response::error('The reason must be 250 characters or fewer.', 422);
        }

        $reservation = $this->reservations->cancel($reservationId, $userId, $reason !== '' ? $reason : null);

        $actor = $isOwner ? 'requester' : strtolower((string) $role);
        $this->reservations->insertLog(
            $userId,
            "Reservation cancelled by {$actor}" . ($reason !== '' ? ": {$reason}" : ''),
            $reservationId
        );

        Response::json($reservation);
    }

    // ---------------------------------------------------------------
    // Customer/Staff/Admin: POST /api/reservations/{id}/rebook
    // Clones a reservation (any status) into a new Pending booking, always
    // owned by the ORIGINAL requester — even when Staff/Admin act on
    // someone else's behalf from the dispatch queue.
    // ---------------------------------------------------------------

    public function rebook(string $sourceReservationId): never
    {
        Auth::requireRole(['Customer', 'Staff', 'Admin']);

        $source = $this->reservations->findById($sourceReservationId);
        if ($source === null) {
            Response::error('Reservation not found.', 404);
        }

        $role   = Auth::role();
        $userId = Auth::userId();

        if ($role === 'Customer' && $source['customer_id'] !== $userId) {
            Response::error('Forbidden.', 403);
        }

        // Art. XIII Sec. 2: only a finished booking may seed a new one. Both
        // interfaces already offer Re-book on these three statuses only, but
        // the rule belongs here — re-filing from a live Pending/Approved row
        // would quietly create a second booking for a slot already held.
        $refilable = ['Completed', 'Rejected', 'Cancelled'];
        if (!in_array($source['status'], $refilable, true)) {
            Response::error(
                "Only a completed, rejected or cancelled booking can be re-filed; this one is {$source['status']}.",
                422
            );
        }

        $body           = $this->jsonBody();
        $roomId         = trim((string) ($body['room_id']    ?? '')) ?: $source['room_id'];
        $purpose        = trim((string) ($body['purpose']    ?? '')) ?: $source['purpose'];
        $startTime      = trim((string) ($body['start_time'] ?? ''));
        $endTime        = trim((string) ($body['end_time']   ?? ''));
        $equipmentNotes = trim((string) ($body['equipment_notes'] ?? '')) ?: (string) ($source['equipment_notes'] ?? '');

        // A re-booking keeps the original's category unless the caller sends a
        // different one. The staff modal sends none, so it always inherits.
        $category = trim((string) ($body['category'] ?? ''));
        if ($category === '') {
            $category = (string) ($source['category'] ?? 'Academic Lecture');
        }
        if (!in_array($category, self::CATEGORIES, true)) {
            Response::error('category must be one of: ' . implode(', ', self::CATEGORIES) . '.', 422);
        }

        if ($startTime === '' || $endTime === '') {
            Response::error('start_time and end_time are required.', 422);
        }

        // Reservations.purpose is VARCHAR(255); mb_strlen() counts characters,
        // not bytes (Fix Guide Section 6). $purpose here may fall back to the
        // source reservation's stored purpose, which is fine — it already
        // fit the column once — but a caller-supplied override is checked.
        if (mb_strlen($purpose) > 255) {
            Response::error('purpose must be 255 characters or fewer.', 422);
        }

        $startTime = DateTimeHelper::toMysqlDateTime($startTime);
        $endTime   = DateTimeHelper::toMysqlDateTime($endTime);
        if ($startTime === null || $endTime === null) {
            Response::error('start_time and end_time must be valid timestamps.', 422);
        }

        // No bookings in the past (Fix Guide Section 6).
        if (strtotime($startTime) <= time()) {
            Response::error('The start time must be in the future.', 422);
        }

        if (mb_strlen($equipmentNotes) > 500) {
            Response::error('equipment_notes must be 500 characters or fewer.', 422);
        }

        // Re-validate against CURRENT conditions — holidays, class
        // schedules, room maintenance/deactivation, and overlaps can all
        // have changed since the source reservation was made. Never skip
        // this because "it was valid before". This also covers the
        // Maintenance / is_active check via ReservationValidator's own
        // step 0, so no separate room-status check is needed here.
        $error = ReservationValidator::check($roomId, $startTime, $endTime);
        if ($error !== null) {
            Response::error($error, 409);
        }

        try {
            $reservation = $this->reservations->create(
                $source['customer_id'],
                $roomId,
                $purpose,
                $startTime,
                $endTime,
                $equipmentNotes !== '' ? $equipmentNotes : null,
                $category
            );
        } catch (PDOException $e) {
            if ($e->getCode() === '45000') {
                Response::error(
                    'Scheduling Collision: Room is already booked or pending during this time window.',
                    409
                );
            }
            throw $e;
        }

        // Attached to the NEW booking, so its history opens with where it came from.
        $this->reservations->insertLog(
            $userId,
            "Reservation re-booked from {$sourceReservationId}",
            $reservation['reservation_id']
        );

        Response::json($reservation, 201);
    }

    // ---------------------------------------------------------------
    // Customer: DELETE /api/reservations/{id}
    //
    // "Remove" clears a booking out of My Reservations. It is a soft hide:
    // the row stays for staff, the room calendar and the audit trail. Removing
    // something still Pending cancels it first, otherwise the room would stay
    // blocked by a booking its owner can no longer see.
    // ---------------------------------------------------------------

    public function remove(string $reservationId): never
    {
        Auth::requireRole(['Customer']);

        $existing = $this->reservations->findById($reservationId);
        if ($existing === null) {
            Response::error('Reservation not found.', 404);
        }

        $userId = Auth::userId();
        if ($existing['customer_id'] !== $userId) {
            Response::error('Forbidden.', 403);
        }

        // Approved is excluded on purpose: the room is committed, so it must be
        // cancelled first. Completed is excluded because it is the record of a
        // room actually being used.
        $removable = ['Pending', 'Rejected', 'Cancelled'];
        if (!in_array($existing['status'], $removable, true)) {
            $hint = $existing['status'] === 'Approved'
                ? ' Cancel it first, then remove it.'
                : '';
            $article = $existing['status'] === 'Approved' ? 'An' : 'A';
            Response::error(
                "{$article} " . strtolower($existing['status']) . ' booking cannot be removed.' . $hint,
                422
            );
        }

        // Withdrawing a request that is still awaiting staff: cancel it so the
        // slot is released, then hide it. Both, or the room stays locked.
        if ($existing['status'] === 'Pending') {
            $this->reservations->cancel($reservationId, $userId, 'Withdrawn by requester');
            $this->reservations->insertLog($userId, 'Reservation withdrawn by requester', $reservationId);
        }

        $this->reservations->hideFromCustomer($reservationId);
        $this->reservations->insertLog(
            $userId,
            'Reservation removed from the requester\'s list',
            $reservationId
        );

        Response::json(['reservation_id' => $reservationId, 'removed' => true]);
    }

    // ---------------------------------------------------------------
    // Cancellation Requests
    // ---------------------------------------------------------------

    /**
     * True once the booking's own date has arrived (or passed).
     *
     * A cancellation that lands on the day itself is no use to anyone — the
     * room is already committed and nobody can be found to take the slot — so
     * the request window closes at midnight before the booking.
     */
    private static function isTooLateToCancel(string $startTime): bool
    {
        return date('Y-m-d', (int) strtotime($startTime)) <= date('Y-m-d');
    }

    // Customer: POST /api/reservations/{id}/cancel-request
    public function requestCancel(string $reservationId): never
    {
        Auth::requireRole(['Customer']);

        $existing = $this->reservations->findById($reservationId);
        if ($existing === null) {
            Response::error('Reservation not found.', 404);
        }

        $userId = Auth::userId();
        if ($existing['customer_id'] !== $userId) {
            Response::error('Forbidden.', 403);
        }

        if ($existing['status'] !== 'Approved') {
            Response::error(
                "Only an approved booking needs a cancellation request; this one is {$existing['status']}.",
                422
            );
        }

        if (self::isTooLateToCancel($existing['start_time'])) {
            Response::error(
                'A cancellation request cannot be submitted on the day the booking takes place. Please contact the facilities desk directly.',
                422
            );
        }

        if ($this->reservations->hasPendingCancelRequest($reservationId)) {
            Response::error('A cancellation request for this booking is already awaiting review.', 422);
        }

        $body   = $this->jsonBody();
        $reason = trim((string) ($body['reason'] ?? ''));

        if ($reason === '') {
            Response::error('Please give a reason for the cancellation.', 422);
        }
        if (mb_strlen($reason) > 500) {
            Response::error('reason must be 500 characters or fewer.', 422);
        }

        $request = $this->reservations->createCancelRequest($reservationId, $reason);

        $this->reservations->insertLog(
            $userId,
            "Cancellation requested by requester: {$reason}",
            $reservationId
        );

        Response::json($request, 201);
    }

    // Staff/Admin: GET /api/reservations/cancel-requests[?status=Pending]
    public function getCancelRequests(): never
    {
        Auth::requireRole(['Staff', 'Admin']);

        $status  = $_GET['status'] ?? null;
        $allowed = ['Pending', 'Approved', 'Rejected'];
        if ($status !== null && !in_array($status, $allowed, true)) {
            Response::error('status must be one of: ' . implode(', ', $allowed), 422);
        }

        Response::json($this->reservations->findCancelRequests($status));
    }

    // Staff/Admin: GET /api/reservations/cancellations[?limit=&offset=]
    // Read-only log of bookings the requester cancelled themselves.
    public function getUserCancellations(): never
    {
        Auth::requireRole(['Staff', 'Admin']);

        $limit  = isset($_GET['limit'])  && ctype_digit((string) $_GET['limit'])  ? (int) $_GET['limit']  : 200;
        $offset = isset($_GET['offset']) && ctype_digit((string) $_GET['offset']) ? (int) $_GET['offset'] : 0;

        Response::json($this->reservations->findUserCancellations($limit, $offset));
    }

    // Staff/Admin: PATCH /api/reservations/cancel-requests/{id}
    public function resolveCancelRequest(string $requestId): never
    {
        Auth::requireRole(['Staff', 'Admin']);

        $body         = $this->jsonBody();
        $status       = trim((string) ($body['status'] ?? ''));
        $staffComment = trim((string) ($body['staff_comment'] ?? $body['comment'] ?? ''));

        if (!in_array($status, ['Approved', 'Rejected'], true)) {
            Response::error('status must be Approved or Rejected', 422);
        }

        $existing = $this->reservations->findCancelRequestById($requestId);
        if ($existing === null) {
            Response::error('Cancellation request not found.', 404);
        }

        if ($existing['status'] !== 'Pending') {
            Response::error('Cancellation request is already resolved.', 422);
        }

        // Rejecting must say why — the booking stands and the requester is
        // owed an explanation.
        if ($status === 'Rejected' && $staffComment === '') {
            Response::error('A comment is required when rejecting a cancellation request.', 422);
        }

        // Approving the request is what actually cancels the booking. The
        // reason recorded on the reservation is the customer's own words;
        // cancelled_by is the staff member who carried it out.
        if ($status === 'Approved') {
            if (!in_array($existing['reservation_status'], ['Pending', 'Approved'], true)) {
                Response::error(
                    "This booking is {$existing['reservation_status']} and can no longer be cancelled.",
                    422
                );
            }
            $this->reservations->cancel(
                $existing['reservation_id'],
                Auth::userId(),
                'Cancellation requested by requester: ' . $existing['reason']
            );
        }

        $request = $this->reservations->updateCancelRequestStatus(
            $requestId,
            $status,
            Auth::userId(),
            $staffComment === '' ? null : $staffComment
        );

        $this->reservations->insertLog(
            Auth::userId(),
            "Cancellation request {$status}" . ($staffComment !== '' ? ": {$staffComment}" : ''),
            $existing['reservation_id']
        );

        Response::json($request);
    }

    // ---------------------------------------------------------------
    // Move Requests
    // ---------------------------------------------------------------

    public function requestMove(string $reservationId): never
    {
        Auth::requireRole(['Customer']);

        $existing = $this->reservations->findById($reservationId);
        if ($existing === null) {
            Response::error('Reservation not found.', 404);
        }

        if ($existing['customer_id'] !== Auth::userId()) {
            Response::error('Forbidden.', 403);
        }

        if (!in_array($existing['status'], ['Pending', 'Approved'])) {
            Response::error('Only pending or approved reservations can be rescheduled.', 422);
        }

        // The customer page hides the Move button once a booking's end_time
        // has passed, but that is a courtesy only (isPastEnd() in
        // reservations.js) — without this a stale tab or a direct API call
        // could still file a move request against a booking that already
        // happened.
        if (strtotime($existing['end_time']) <= time()) {
            Response::error('This booking has already passed and can no longer be moved.', 422);
        }

        // At most one open Move Request per reservation. The card hides the
        // button once one is pending, but that is a courtesy only — without
        // this a stale tab or a direct API call stacks duplicates and leaves
        // staff holding two competing proposals for the same booking.
        if ($this->reservations->hasPendingMoveRequest($reservationId)) {
            Response::error('A move request for this booking is already awaiting review.', 422);
        }

        $body = $this->jsonBody();
        $startTime = trim($body['requested_start_time'] ?? '');
        $endTime = trim($body['requested_end_time'] ?? '');

        if ($startTime === '' || $endTime === '') {
            Response::error('requested_start_time and requested_end_time are required.', 422);
        }

        // Previously nothing checked these at all: garbage reached the INSERT and came back as a 500.
        $startTime = DateTimeHelper::toMysqlDateTime($startTime);
        $endTime   = DateTimeHelper::toMysqlDateTime($endTime);
        if ($startTime === null || $endTime === null) {
            Response::error('requested_start_time and requested_end_time must be valid timestamps.', 422);
        }

        // end <= start would trip the table's CHECK constraint and surface as a 500.
        if (strtotime($endTime) <= strtotime($startTime)) {
            Response::error('The requested end time must be after the start time.', 422);
        }

        if (strtotime($startTime) <= time()) {
            Response::error('The requested start time must be in the future.', 422);
        }

        // Check the requested range now, not only when staff approve it, so the
        // requester hears about a clash with a class or another booking
        // immediately. The reservation being moved is excluded so it doesn't
        // collide with its own current slot. Approval re-runs the same check.
        $error = ReservationValidator::check(
            $existing['room_id'],
            $startTime,
            $endTime,
            $reservationId
        );
        if ($error !== null) {
            $startDate  = substr($startTime, 0, 10);
            $endDate    = substr($endTime, 0, 10);
            $dailyStart = substr($startTime, 11);
            $dailyEnd   = substr($endTime, 11);

            $conflict = ReservationValidator::findConflictingReservation($existing['room_id'], $startDate, $endDate, $dailyStart, $dailyEnd);
            // Overridable only if it's another user's reservation and general rules (hours, closed days, holidays, classes) pass
            $isOverridable = ($conflict !== null 
                && $conflict['customer_id'] !== Auth::userId() 
                && ReservationValidator::checkRange($existing['room_id'], $startDate, $endDate, $dailyStart, $dailyEnd, [$reservationId], []) === null);

            Response::error($error, 409, [
                'override_eligible' => $isOverridable,
                'conflict'          => $conflict ? [
                    'reservation_id' => $conflict['reservation_id'],
                    'start_time'     => $conflict['start_time'],
                    'end_time'       => $conflict['end_time'],
                    'status'         => $conflict['status']
                ] : null,
            ]);
        }

        $request = $this->reservations->createApprovedMove(
            $reservationId,
            $startTime,
            $endTime,
            Auth::userId(),
            'Auto-approved (No scheduling conflict)'
        );

        Response::json([
            'auto_approved' => true,
            'message'       => 'Reservation successfully moved to the new schedule (Auto-approved).',
            'start_time'    => $startTime,
            'end_time'      => $endTime,
            'move_request'  => $request,
        ], 200);
    }

    public function getMoveRequests(): never
    {
        Auth::requireRole(['Staff', 'Admin']);
        $status = $_GET['status'] ?? null;
        $list = $this->reservations->findMoveRequests($status);
        Response::json($list);
    }

    public function resolveMoveRequest(string $requestId): never
    {
        Auth::requireRole(['Staff', 'Admin']);

        $body = $this->jsonBody();
        $status = trim($body['status'] ?? '');
        // Accept either key name; the staff queue historically posted "comment".
        $staffComment = trim($body['staff_comment'] ?? $body['comment'] ?? '');

        if (!in_array($status, ['Approved', 'Rejected'], true)) {
            Response::error('status must be Approved or Rejected', 422);
        }

        $existing = $this->reservations->findMoveRequestById($requestId);
        if ($existing === null) {
            Response::error('Move request not found.', 404);
        }

        if ($existing['status'] !== 'Pending') {
            Response::error('Move request is already resolved.', 422);
        }

        // Art. IX Sec. 1(c): a rejection leaves the original booking standing,
        // so the requester is owed the reason. The staff form already demands
        // one; this makes it the rule rather than a client-side courtesy, and
        // matches the Cancellation Request flow.
        if ($status === 'Rejected' && $staffComment === '') {
            Response::error('A comment is required when rejecting a move request.', 422);
        }

        if ($status === 'Approved') {
            // Run validator
            $error = ReservationValidator::check(
                $existing['room_id'],
                $existing['requested_start_time'],
                $existing['requested_end_time'],
                $existing['reservation_id']
            );
            if ($error !== null) {
                Response::error($error, 409);
            }

            // Update actual reservation times
            $this->reservations->updateTimes(
                $existing['reservation_id'],
                $existing['requested_start_time'],
                $existing['requested_end_time']
            );
        }

        $request = $this->reservations->updateMoveRequestStatus(
            $requestId,
            $status,
            Auth::userId(),
            $staffComment === '' ? null : $staffComment
        );

        $this->reservations->insertLog(
            Auth::userId(),
            "Move request {$status}",
            $existing['reservation_id']
        );

        // A move staff proposed for a conflict override: now book (or not) the requester.
        $overrideNote = $this->settleOverrideAfterMove($requestId, $status, $staffComment === '' ? null : $staffComment);
        if ($overrideNote !== null && is_array($request)) {
            $request['override_note'] = $overrideNote;
        }

        Response::json($request);
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    /**
     * Decide how a clean new booking enters the system: [status, approval_type].
     *
     *  - 'special' — the room is flagged requires_approval: always Pending, so
     *                Staff / Admin sign it off (and can see WHY it is queued).
     *  - 'manual'  — a hold longer than 3 days waits for a human decision.
     *  - 'auto'    — everything else is Approved immediately, no queue.
     *
     * If the requires_approval lookup fails (e.g. migration not applied yet) we
     * fail SAFE: the booking goes to the Pending queue rather than being
     * approved unreviewed.
     *
     * @return array{0:string,1:string}
     */
    private function approvalOutcome(string $roomId, int $dayCount): array
    {
        try {
            if ((new RoomRepository())->requiresApproval($roomId)) {
                return ['Pending', 'special'];
            }
        } catch (\Throwable $e) {
            error_log('[ReservationController] requiresApproval lookup failed: ' . $e->getMessage());
            return ['Pending', 'manual'];
        }

        if ($dayCount > 3) {
            return ['Pending', 'manual'];
        }

        return ['Approved', 'auto'];
    }

    /**
     * Write the "Auto-approved" audit entry on each row of a booking approved at
     * submission. A no-op for bookings that entered the Pending queue.
     *
     * @param string[] $reservationIds
     */
    private function logAutoApproval(string $status, string $approvalType, array $reservationIds): void
    {
        if ($status !== 'Approved' || $approvalType !== 'auto') {
            return;
        }
        foreach ($reservationIds as $id) {
            $this->reservations->insertLog(Auth::userId(), 'Auto-approved: no conflicts found', $id);
        }
    }

    protected function jsonBody(): array
    {
        $raw  = file_get_contents('php://input');
        $body = json_decode($raw ?: '{}', true);
        if (!is_array($body)) {
            Response::error('Request body must be valid JSON.', 400);
        }
        return $body;
    }
}
