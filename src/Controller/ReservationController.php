<?php

declare(strict_types=1);

namespace CampusRoom\Controller;

use CampusRoom\Core\Auth;
use CampusRoom\Core\DateTimeHelper;
use CampusRoom\Core\Response;
use CampusRoom\Core\ReservationValidator;
use CampusRoom\Repository\ConflictOverrideRepository;
use CampusRoom\Repository\ReservationRepository;
use CampusRoom\Repository\RoomRepository;
use CampusRoom\Repository\UserRepository;
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
    // Staff/Admin: GET /api/reservations/conflicts
    // The Pending bookings that currently fail validation (a class or another
    // booking landed on them since they were filed). Drives the "Conflict"
    // badge and the "Find alternative" tool on the staff queue, so staff can
    // resolve one day of a range instead of rejecting the whole booking.
    // ---------------------------------------------------------------

    public function conflicts(): never
    {
        Auth::requireRole(['Staff', 'Admin']);

        $out = [];
        foreach ($this->reservations->findAll('Pending', 500, 0) as $row) {
            $reason = ReservationValidator::check(
                $row['room_id'], $row['start_time'], $row['end_time'], $row['reservation_id']
            );
            if ($reason !== null) {
                $out[] = [
                    'reservation_id' => $row['reservation_id'],
                    'reason'         => $reason,
                ];
            }
        }

        Response::json($out);
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
    // Customer/Staff: POST /api/reservations
    // ---------------------------------------------------------------

    public function store(): never
    {
        Auth::requireRole(['Customer', 'Staff']);
        $body = $this->jsonBody();
        $isStaffSubmission = Auth::role() === 'Staff';
        $requesterId = Auth::userId();
        if ($requesterId === null) {
            Response::error('Unauthenticated.', 401);
        }

        if ($isStaffSubmission) {
            $requesterIdentifier = trim((string) ($body['requester_identifier'] ?? ''));
            if ($requesterIdentifier === '') {
                Response::error('A customer email address or user ID is required.', 422);
            }

            $users = new UserRepository();
            if (filter_var($requesterIdentifier, FILTER_VALIDATE_EMAIL)) {
                $requester = $users->findByEmail(strtolower($requesterIdentifier));
            } elseif (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $requesterIdentifier)) {
                $requester = $users->findById($requesterIdentifier);
            } else {
                Response::error('Enter a valid customer email address or user ID.', 422);
            }

            if (!$requester || $requester['role'] !== 'Customer' || (int) $requester['is_verified'] !== 1) {
                Response::error('No verified Customer account matches that email address or user ID.', 422);
            }
            $requesterId = (string) $requester['user_id'];
        }

        // "Assign any available room matching my criteria": the customer gives
        // filters instead of a specific room, and the server picks a free room
        // for them — per day, so each day of a range can land in a different
        // room when no single room is free throughout.
        if (!empty($body['auto_assign'])) {
            if ($isStaffSubmission) {
                Response::error('Staff must select a room from the Rooms Directory.', 422);
            }
            $this->storeAutoAssigned($body);
        }
        [
            'room_id' => $roomId, 'purpose' => $purpose, 'category' => $category,
            'equipment_notes' => $equipmentNotes, 'start_time' => $startTime, 'end_time' => $endTime,
        ] = $this->bookingRequest($body);

        // "Specific days" feature: optionally filter which days in a range to
        // actually book. Comes as an array of 'Y-m-d' strings from the client.
        $activeDates = isset($body['active_dates']) && is_array($body['active_dates'])
            ? $body['active_dates']
            : null;

        // Different dates = a multi-day booking: start_time's date to
        // end_time's date, using start_time's clock to end_time's clock as the
        // window on every one of those days.
        $activeDates = $body['active_dates'] ?? null; if (substr($startTime, 0, 10) !== substr($endTime, 0, 10)) {
            $this->storeSeries($roomId, $purpose, $category, $equipmentNotes, $startTime, $endTime, $activeDates, $requesterId, $isStaffSubmission);
        }

        $error = ReservationValidator::check($roomId, $startTime, $endTime);
        if ($error !== null) {
            $this->conflictError($error, $roomId, $startTime, $endTime);
        }

        // A clean single-day booking is approved on the spot unless the room
        // asks for Staff review. A multi-day range is handled by storeSeries()
        // above, which weighs its own length — so this is always 1 day.
        [$status, $approvalType] = $isStaffSubmission
            ? ['Pending', 'manual']
            : $this->approvalOutcome($roomId, 1);

        try {
            $reservation = $this->reservations->create(
                $requesterId,
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
        $this->reservations->insertLog(
            Auth::userId(),
            $isStaffSubmission
                ? 'Reservation submitted by staff on behalf of customer'
                : 'Reservation submitted by requester',
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
     * @param bool $requireRoom false for the "any available facility" flow,
     *        where the server assigns the room and the client sends none.
     * @return array{room_id: string, purpose: string, category: string, equipment_notes: string, start_time: string, end_time: string}
     */
    private function bookingRequest(array $body, bool $requireRoom = true): array
    {
        $roomId    = trim((string) ($body['room_id']    ?? ''));
        $purpose   = trim((string) ($body['purpose']    ?? ''));
        $startTime = trim((string) ($body['start_time'] ?? ''));
        $endTime   = trim((string) ($body['end_time']   ?? ''));
        $category  = trim((string) ($body['category']   ?? ''));
        $equipmentNotes = trim((string) ($body['equipment_notes'] ?? ''));

        if ($requireRoom && $roomId === '') {
            Response::error('room_id is required.', 422);
        }
        if ($purpose === '' || $startTime === '' || $endTime === '') {
            Response::error('purpose, start_time, and end_time are required.', 422);
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
    private function overridableConflict(string $roomId, string $startTime, string $endTime, ?array $activeDates = null): ?array {
        $startDate  = substr($startTime, 0, 10);
        $endDate    = substr($endTime, 0, 10);
        $dailyStart = substr($startTime, 11);
        $dailyEnd   = substr($endTime, 11);

        if (ReservationValidator::checkRange($roomId, $startDate, $endDate, $dailyStart, $dailyEnd, [], ['Pending'], $activeDates) !== null) {
            return null;
        }
        $conflict = ReservationValidator::findApprovedConflict($roomId, $startDate, $endDate, $dailyStart, $dailyEnd, $activeDates);

        // Nobody overrides their own booking; they'd move it instead.
        if ($conflict === null || $conflict['customer_id'] === Auth::userId()) {
            return null;
        }
        return $conflict;
    }

    /**
     * End a booking request with 409, telling the client whether the customer
     * may file a conflict override request instead. Only the clashing time is
     * shared, never whose booking it is.
     */
    private function conflictError(string $error, string $roomId, string $startTime, string $endTime, ?array $activeDates = null): never
    {
        $conflict = $this->overridableConflict($roomId, $startTime, $endTime, $activeDates);
        Response::error($error, 409, [
            'override_eligible' => $conflict !== null,
            'conflict'          => $conflict === null ? null : [
                'start_time' => $conflict['start_time'],
                'end_time'   => $conflict['end_time'],
            ],
        ]);
    }

    // ---------------------------------------------------------------
    // Customer: POST /api/conflict-override-requests
    // Same body as POST /api/reservations plus `reason`. Accepted only when
    // the slot is blocked solely by another customer's Approved booking.
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

        $startDate = substr($request['start_time'], 0, 10);
        $endDate   = substr($request['end_time'], 0, 10);
        $error     = ReservationValidator::checkRange(
            $request['room_id'], $startDate, $endDate,
            substr($request['start_time'], 11), substr($request['end_time'], 11)
        );
        if ($error === null) {
            Response::error('This slot is free. Submit a normal reservation request instead.', 422);
        }

        // The conflicting booking is worked out here, never taken from the client.
        $conflict = $this->overridableConflict($request['room_id'], $request['start_time'], $request['end_time']);
        if ($conflict === null) {
            Response::error("An override can't resolve this: {$error}", 409);
        }

        $overrides = new ConflictOverrideRepository();
        if ($overrides->hasPendingFor(Auth::userId(), $conflict['reservation_id'])) {
            Response::error('You already have an override request awaiting review for this slot.', 409);
        }

        $override = $overrides->create(
            Auth::userId(),
            $request['room_id'],
            $request['start_time'],
            $request['end_time'],
            $request['purpose'],
            $request['category'],
            $request['equipment_notes'] !== '' ? $request['equipment_notes'] : null,
            $reason,
            $conflict['reservation_id']
        );

        // Logged against the booking it targets, so that booking's history shows it.
        $this->reservations->insertLog(
            Auth::userId(),
            'Conflict override requested by another requester',
            $conflict['reservation_id']
        );

        Response::json($override, 201);
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
        ?array $activeDates = null,
        ?string $requesterId = null,
        bool $isStaffSubmission = false
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
        // day; a range longer than the policy limit, or a room that asks for it,
        // waits as Pending (see approvalOutcome()).
        $dayCount = count(ReservationValidator::datesBetween($startDate, $endDate) ?? []);
        [$status, $approvalType] = $isStaffSubmission
            ? ['Pending', 'manual']
            : $this->approvalOutcome($roomId, $dayCount);

        try {
            $rows = $this->createBookingRows(
                $requesterId ?? Auth::userId(), $roomId, $purpose, $category,
                $equipmentNotes !== '' ? $equipmentNotes : null, $startTime, $endTime, $status, $approvalType, $activeDates
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

        $count = count($rows);
        foreach ($rows as $i => $row) {
            $this->reservations->insertLog(
                Auth::userId(),
                $isStaffSubmission
                    ? 'Reservation submitted by staff on behalf of customer (day ' . ($i + 1) . " of $count)"
                    : 'Reservation submitted by requester (day ' . ($i + 1) . " of $count)",
                $row['reservation_id']
            );
        }
        $this->logAutoApproval($status, $approvalType, array_column($rows, 'reservation_id'));

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
        string $status = 'Pending',
        string $approvalType = 'manual',
        ?array $activeDates = null
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

    /**
     * "Assign any available room matching my criteria." The customer sends
     * optional filters (min capacity, room type, floor) instead of a room, and
     * the server books a free room for them:
     *   - single day: the first matching room with no conflict;
     *   - a range: one room for the whole range when one is free throughout,
     *     otherwise each day gets the first matching room free THAT day, so a
     *     series can span several rooms;
     *   - if any day has no free matching room, nothing is booked and the reply
     *     names the date(s) with no options.
     * Only standard rooms are considered — a requires_approval room is never
     * auto-assigned, since those are meant to be chosen deliberately.
     */
    private function storeAutoAssigned(array $body): never
    {
        // Everything but the room is validated exactly as a normal booking.
        [
            'purpose' => $purpose, 'category' => $category, 'equipment_notes' => $equipmentNotes,
            'start_time' => $startTime, 'end_time' => $endTime,
        ] = $this->bookingRequest($body, false);

        // Optional criteria. Absent / blank means "no preference".
        $filters     = is_array($body['filters'] ?? null) ? $body['filters'] : [];
        $minCapacity = isset($filters['min_capacity']) && ctype_digit((string) $filters['min_capacity']) && (int) $filters['min_capacity'] > 0
            ? (int) $filters['min_capacity'] : null;
        $roomType    = trim((string) ($filters['room_type'] ?? ''));
        $roomType    = $roomType !== '' ? $roomType : null;
        $floor       = isset($filters['floor']) && $filters['floor'] !== '' && is_numeric($filters['floor'])
            ? (int) $filters['floor'] : null;

        $candidates = (new RoomRepository())->findBookableByCriteria($minCapacity, $roomType, $floor);
        if ($candidates === []) {
            Response::error('No active room matches your criteria. Try a smaller capacity, a different type, or any floor.', 422);
        }

        $startDate  = substr($startTime, 0, 10);
        $endDate    = substr($endTime, 0, 10);
        $dailyStart = substr($startTime, 11); // 'HH:MM:SS'
        $dailyEnd   = substr($endTime, 11);

        $days = ReservationValidator::datesBetween($startDate, $endDate);
        if ($days === null) {
            Response::error('The end date must be on or after the start date.', 422);
        }
        if (count($days) > ReservationValidator::MAX_RANGE_DAYS) {
            Response::error('A booking can cover at most ' . ReservationValidator::MAX_RANGE_DAYS . ' days.', 422);
        }

        // 1. Prefer ONE room free on every day of the range (nicer for the
        //    customer, and the only option when it's a single day).
        $wholeRange = null;
        foreach ($candidates as $room) {
            $freeAllDays = true;
            foreach ($days as $day) {
                if (ReservationValidator::checkRange($room['room_id'], $day, $day, $dailyStart, $dailyEnd) !== null) {
                    $freeAllDays = false;
                    break;
                }
            }
            if ($freeAllDays) {
                $wholeRange = $room;
                break;
            }
        }

        // dayRoom maps each 'Y-m-d' to the room assoc chosen for it.
        $dayRoom     = [];
        $unavailable = [];
        if ($wholeRange !== null) {
            foreach ($days as $day) {
                $dayRoom[$day] = $wholeRange;
            }
        } else {
            // 2. Per-day fallback: first matching room free on that specific day.
            foreach ($days as $day) {
                $chosen = null;
                foreach ($candidates as $room) {
                    if (ReservationValidator::checkRange($room['room_id'], $day, $day, $dailyStart, $dailyEnd) === null) {
                        $chosen = $room;
                        break;
                    }
                }
                if ($chosen === null) {
                    $unavailable[] = $day;
                } else {
                    $dayRoom[$day] = $chosen;
                }
            }
        }

        if ($unavailable !== []) {
            $human = implode(', ', array_map(static fn(string $d): string => date('D, M j', (int) strtotime($d)), $unavailable));
            Response::error(
                "No room matching your criteria is free on: {$human}. Pick a different time, widen your criteria, or book the remaining days separately.",
                409
            );
        }

        // Every candidate is a standard room, so the only thing that can still
        // hold the booking back is the long-range policy (approvalOutcome()).
        [$status, $approvalType] = $this->approvalOutcome($dayRoom[$days[0]]['room_id'], count($days));

        try {
            $rows = $this->createAssignedRows(
                Auth::userId(), $purpose, $category,
                $equipmentNotes !== '' ? $equipmentNotes : null,
                $dailyStart, $dailyEnd, $dayRoom, $status, $approvalType
            );
        } catch (PDOException $e) {
            if ($e->getCode() === '45000') {
                Response::error('A matching room was taken while we were assigning it. Please submit again.', 409);
            }
            throw $e;
        }

        $count = count($rows);
        foreach ($rows as $i => $row) {
            $this->reservations->insertLog(
                Auth::userId(),
                $count > 1
                    ? 'Reservation submitted by requester (auto-assigned room, day ' . ($i + 1) . " of $count)"
                    : 'Reservation submitted by requester (auto-assigned room)',
                $row['reservation_id']
            );
        }
        $this->logAutoApproval($status, $approvalType, array_column($rows, 'reservation_id'));

        // Per-day room breakdown so the client can show which room(s) it got.
        $assignments = [];
        foreach ($days as $day) {
            $assignments[] = [
                'date'      => $day,
                'room_id'   => $dayRoom[$day]['room_id'],
                'room_name' => $dayRoom[$day]['name'],
            ];
        }

        $response = $rows[0] + ['auto_assigned' => true, 'assignments' => $assignments];
        if ($count > 1) {
            $response['series'] = $rows;
        }
        Response::json($response, 201);
    }

    /**
     * Insert the row(s) for an auto-assigned booking, each day carrying its own
     * assigned room. One row (no series) for a single day; otherwise one row per
     * day sharing a series_id, all in one transaction. Validation is the
     * caller's job. $dayRoom maps 'Y-m-d' => room assoc (needs 'room_id').
     *
     * @param array<string, array<string, mixed>> $dayRoom
     * @return array[] the created rows, earliest day first
     */
    private function createAssignedRows(
        string $customerId,
        string $purpose,
        string $category,
        ?string $equipmentNotes,
        string $dailyStart,
        string $dailyEnd,
        array $dayRoom,
        string $status,
        string $approvalType
    ): array {
        $days = array_keys($dayRoom);

        if (count($days) === 1) {
            $day = $days[0];
            return [$this->reservations->create(
                $customerId, $dayRoom[$day]['room_id'], $purpose,
                "$day $dailyStart", "$day $dailyEnd",
                $equipmentNotes, $category, null, $status, $approvalType
            )];
        }

        $seriesId = $this->reservations->newSeriesId();
        return $this->reservations->transaction(function () use ($days, $dayRoom, $customerId, $purpose, $category, $equipmentNotes, $dailyStart, $dailyEnd, $seriesId, $status, $approvalType): array {
            $rows = [];
            foreach ($days as $day) {
                $rows[] = $this->reservations->create(
                    $customerId, $dayRoom[$day]['room_id'], $purpose,
                    "$day $dailyStart", "$day $dailyEnd",
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

        // --- Approve: propose moving the conflicting booking out of the way ---
        $conflict = $this->reservations->findById($conflictId);
        if ($conflict === null || $conflict['status'] !== 'Approved') {
            Response::error(
                'The conflicting booking is no longer approved' . ($conflict ? " ({$conflict['status']})" : '')
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
                    $override['equipment_notes'], $override['start_time'], $override['end_time']
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
        return 'The override requester\'s booking was created and is now in the Pending queue.';
    }

    private static function isUuid(string $value): bool
    {
        return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value) === 1;
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

        if (Auth::role() === 'Staff' && (string) $existing['customer_id'] === Auth::userId()) {
            Response::error('You cannot review your own reservation. Another staff member must decide it.', 403);
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

        // Once a booking is Approved the room is committed and staff have
        // planned around it, so its customer can no longer cancel unilaterally
        // — they file a cancellation request and staff decide. Staff and Admin
        // keep the direct route, which is what approving such a request uses.
        if ($role === 'Customer' && $existing['status'] === 'Approved') {
            Response::error(
                'An approved booking cannot be cancelled directly. Please submit a cancellation request for staff to review.',
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

        // Approved is excluded on purpose: the room is committed, so it goes
        // through a cancellation request. Completed is excluded because it is
        // the record of a room actually being used.
        $removable = ['Pending', 'Rejected', 'Cancelled'];
        if (!in_array($existing['status'], $removable, true)) {
            $hint = $existing['status'] === 'Approved'
                ? ' Submit a cancellation request instead.'
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
            Response::error($error, 409);
        }

        $request = $this->reservations->createMoveRequest($reservationId, $startTime, $endTime);
        
        $this->reservations->insertLog(
            Auth::userId(),
            'Move request submitted',
            $reservationId
        );

        Response::json($request, 201);
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
     * How a freshly submitted booking should land. The caller has already
     * confirmed there are zero conflicts (validator returned null), so the
     * only questions left are policy ones:
     *   - a room flagged requires_approval always goes to Staff (auditoriums,
     *     specialised labs): Pending with approval_type 'special';
     *   - a range longer than 3 days is a sizeable hold — a human signs it off.
     * Anything else is approved immediately.
     *
     * @return array{0: string, 1: string} [status, approval_type]
     */
    private function approvalOutcome(string $roomId, int $dayCount): array
    {
        // Some rooms always need Staff eyes, however clean the schedule is. The
        // 'special' label is what tells the queue WHY this booking landed there.
        if ((new RoomRepository())->requiresApproval($roomId)) {
            return ['Pending', 'special'];
        }

        // A week-long room hold deserves human eyes, even with no conflict.
        if ($dayCount > 3) {
            return ['Pending', 'manual'];
        }

        return ['Approved', 'auto'];
    }

    /**
     * Write the "Auto-approved" audit entry on each row of a booking that was
     * approved at submission, so Staff and Admin can see it happened without a
     * human. A no-op for bookings that entered the Pending queue.
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

    private function jsonBody(): array
    {
        $raw  = file_get_contents('php://input');
        $body = json_decode($raw ?: '{}', true);
        if (!is_array($body)) {
            Response::error('Request body must be valid JSON.', 400);
        }
        return $body;
    }
}
