<?php

declare(strict_types=1);

namespace CampusRoom\Controller;

use CampusRoom\Core\Auth;
use CampusRoom\Core\DateTimeHelper;
use CampusRoom\Core\Response;
use CampusRoom\Core\ReservationValidator;
use CampusRoom\Repository\FacilitySuggestionRepository;
use CampusRoom\Repository\ReservationRepository;
use CampusRoom\Repository\RoomRepository;
use PDOException;

/**
 * FacilitySuggestionController — staff propose moving one conflicting day of a
 * booking to a free, matching room; the customer accepts or declines.
 */
class FacilitySuggestionController
{
    private FacilitySuggestionRepository $suggestions;
    private ReservationRepository $reservations;
    private RoomRepository $rooms;

    public function __construct()
    {
        $this->suggestions  = new FacilitySuggestionRepository();
        $this->reservations = new ReservationRepository();
        $this->rooms        = new RoomRepository();
    }

    // ---------------------------------------------------------------
    // Staff/Admin: GET /api/facility-suggestions/alternatives
    //   ?reservation_id=...&affected_date=YYYY-MM-DD
    // Rooms matching the booking's criteria (same type, >= capacity) that are
    // free at the booking's time on that date, plus why the day conflicts now.
    // ---------------------------------------------------------------

    public function alternatives(): never
    {
        Auth::requireRole(['Staff', 'Admin']);

        $reservationId = trim((string) ($_GET['reservation_id'] ?? ''));
        $reservation   = $reservationId !== '' ? $this->reservations->findById($reservationId) : null;
        if ($reservation === null) {
            Response::error('Reservation not found.', 404);
        }

        $day        = substr($reservation['start_time'], 0, 10);
        $dailyStart = substr($reservation['start_time'], 11); // 'HH:MM:SS'
        $dailyEnd   = substr($reservation['end_time'], 11);

        // affected_date is optional; when given it must be this booking's day
        // (one row = one day), so a stale card can't target the wrong date.
        $affected = trim((string) ($_GET['affected_date'] ?? ''));
        if ($affected !== '' && substr($affected, 0, 10) !== $day) {
            Response::error('affected_date does not match this booking.', 422);
        }

        $original = $this->rooms->findById($reservation['room_id']);
        if ($original === null) {
            Response::error('The original room no longer exists.', 404);
        }

        // Same type, enough seats — the original booking's criteria. A null
        // room_type (legacy rooms) means "no type filter".
        $candidates = $this->rooms->findBookableByCriteria(
            (int) $original['capacity'],
            $original['room_type'] !== null && $original['room_type'] !== '' ? (string) $original['room_type'] : null,
            null
        );

        $free = [];
        foreach ($candidates as $room) {
            if ($room['room_id'] === $reservation['room_id']) {
                continue; // the room it's already in is no alternative
            }
            if (ReservationValidator::checkRange($room['room_id'], $day, $day, $dailyStart, $dailyEnd) === null) {
                $free[] = [
                    'room_id'   => $room['room_id'],
                    'name'      => $room['name'],
                    'capacity'  => $room['capacity'],
                    'room_type' => $room['room_type'],
                    'floor'     => $room['floor'],
                ];
            }
        }

        // Why this day currently can't be approved (shown to staff).
        $conflictReason = ReservationValidator::check(
            $reservation['room_id'], $reservation['start_time'], $reservation['end_time'], $reservationId
        );

        Response::json([
            'reservation_id'  => $reservationId,
            'affected_date'   => $day,
            'original_room'   => ['room_id' => $original['room_id'], 'name' => $original['name']],
            'conflict_reason' => $conflictReason,
            'alternatives'    => $free,
        ]);
    }

    // ---------------------------------------------------------------
    // Staff/Admin: POST /api/facility-suggestions
    //   { reservation_id, suggested_room_id, affected_date, reason }
    // ---------------------------------------------------------------

    public function store(): never
    {
        Auth::requireRole(['Staff', 'Admin']);

        $body            = $this->jsonBody();
        $reservationId   = trim((string) ($body['reservation_id']   ?? ''));
        $suggestedRoomId = trim((string) ($body['suggested_room_id'] ?? ''));
        $affectedDate    = trim((string) ($body['affected_date']     ?? ''));
        $reason          = trim((string) ($body['reason']            ?? ''));

        if ($reservationId === '' || $suggestedRoomId === '') {
            Response::error('reservation_id and suggested_room_id are required.', 422);
        }
        if ($reason === '') {
            Response::error('Please give the customer a reason for the move.', 422);
        }
        if (mb_strlen($reason) > 500) {
            Response::error('reason must be 500 characters or fewer.', 422);
        }

        $reservation = $this->reservations->findById($reservationId);
        if ($reservation === null) {
            Response::error('Reservation not found.', 404);
        }
        if (!in_array($reservation['status'], ['Pending', 'Approved'], true)) {
            Response::error("This booking is {$reservation['status']} and can no longer be moved.", 422);
        }

        $day = substr($reservation['start_time'], 0, 10);
        // affected_date is optional in the body; when sent it must be the booking's day.
        $normalisedDate = $affectedDate !== '' ? DateTimeHelper::toMysqlDate($affectedDate) : $day;
        if ($normalisedDate === null || substr($normalisedDate, 0, 10) !== $day) {
            Response::error('affected_date must be the date of this booking.', 422);
        }

        if ($suggestedRoomId === $reservation['room_id']) {
            Response::error('The suggested room is the one the booking is already in.', 422);
        }
        $suggestedRoom = $this->rooms->findById($suggestedRoomId);
        if ($suggestedRoom === null) {
            Response::error('Suggested room not found.', 404);
        }

        // At most one open suggestion per booking day.
        if ($this->suggestions->hasPendingFor($reservationId)) {
            Response::error('This booking already has a suggestion awaiting the customer\'s answer.', 409);
        }

        // Never trust the client: the suggested room must actually be free for
        // this booking's window on that day, right now.
        $error = ReservationValidator::checkRange(
            $suggestedRoomId, $day, $day,
            substr($reservation['start_time'], 11), substr($reservation['end_time'], 11)
        );
        if ($error !== null) {
            Response::error("That room isn't free for this slot: {$error}", 409);
        }

        $suggestion = $this->suggestions->create(
            $reservationId,
            $reservation['room_id'],
            $suggestedRoomId,
            $day,
            $reason,
            Auth::userId()
        );

        $this->reservations->insertLog(
            Auth::userId(),
            "Staff suggested moving this booking to {$suggestedRoom['name']}",
            $reservationId
        );

        Response::json($suggestion, 201);
    }

    // ---------------------------------------------------------------
    // Customer: GET /api/facility-suggestions/mine[?status=Pending]
    // ---------------------------------------------------------------

    public function mine(): never
    {
        Auth::requireRole(['Customer']);

        $status = $_GET['status'] ?? null;
        if ($status !== null && !in_array($status, ['Pending', 'Accepted', 'Declined'], true)) {
            Response::error('status must be one of: Pending, Accepted, Declined', 422);
        }

        Response::json($this->suggestions->findForCustomer(Auth::userId(), $status));
    }

    // ---------------------------------------------------------------
    // Staff/Admin: GET /api/facility-suggestions[?status=Pending]
    // ---------------------------------------------------------------

    public function index(): never
    {
        Auth::requireRole(['Staff', 'Admin']);

        $status = $_GET['status'] ?? null;
        if ($status !== null && !in_array($status, ['Pending', 'Accepted', 'Declined'], true)) {
            Response::error('status must be one of: Pending, Accepted, Declined', 422);
        }

        Response::json($this->suggestions->findAll($status));
    }

    // ---------------------------------------------------------------
    // Customer: PATCH /api/facility-suggestions/{id}  { status }
    //   Accept  -> move that day's reservation to the suggested room
    //   Decline -> leave it as-is (staff decide next)
    // ---------------------------------------------------------------

    public function respond(string $suggestionId): never
    {
        Auth::requireRole(['Customer']);

        $body   = $this->jsonBody();
        $status = trim((string) ($body['status'] ?? ''));
        if (!in_array($status, ['Accepted', 'Declined'], true)) {
            Response::error('status must be Accepted or Declined.', 422);
        }

        $suggestion = $this->suggestions->findById($suggestionId);
        if ($suggestion === null) {
            Response::error('Suggestion not found.', 404);
        }
        // Ownership: the suggestion is attached to the customer's own booking.
        if ($suggestion['customer_id'] !== Auth::userId()) {
            Response::error('Forbidden.', 403);
        }
        if ($suggestion['status'] !== 'Pending') {
            Response::error("This suggestion is already {$suggestion['status']}.", 422);
        }

        if ($status === 'Declined') {
            $updated = $this->suggestions->updateStatus($suggestionId, 'Declined');
            $this->reservations->insertLog(
                Auth::userId(),
                "Customer declined the suggested move to {$suggestion['suggested_room_name']}",
                $suggestion['reservation_id']
            );
            Response::json($updated);
        }

        // --- Accept: move that day's booking to the suggested room ---
        $reservation = $this->reservations->findById($suggestion['reservation_id']);
        if ($reservation === null) {
            Response::error('The booking this suggestion refers to no longer exists.', 404);
        }

        // The room may have been taken since staff proposed it: re-check, and
        // exclude this reservation so it can't collide with its own old slot.
        $error = ReservationValidator::check(
            $suggestion['suggested_room_id'],
            $reservation['start_time'],
            $reservation['end_time'],
            $reservation['reservation_id']
        );
        if ($error !== null) {
            Response::error("That room is no longer free: {$error} Please decline and ask staff for another option.", 409);
        }

        try {
            $this->reservations->updateRoom($suggestion['reservation_id'], $suggestion['suggested_room_id']);
        } catch (PDOException $e) {
            if ($e->getCode() === '45000') {
                Response::error('That room was just taken. Please decline and ask staff for another option.', 409);
            }
            throw $e;
        }

        $updated = $this->suggestions->updateStatus($suggestionId, 'Accepted');
        $this->reservations->insertLog(
            Auth::userId(),
            "Customer accepted the move from {$suggestion['original_room_name']} to {$suggestion['suggested_room_name']}",
            $suggestion['reservation_id']
        );

        Response::json($updated);
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
