<?php

declare(strict_types=1);

namespace CampusRoom\Controller;

use CampusRoom\Core\Auth;
use CampusRoom\Core\DateTimeHelper;
use CampusRoom\Core\Response;
use CampusRoom\Repository\RoomRepository;
use CampusRoom\Repository\ReservationRepository;

/**
 * RoomController — Customer, Staff and Admin room endpoints.
 */
class RoomController
{
    private RoomRepository $rooms;
    private ReservationRepository $reservations;

    public function __construct()
    {
        $this->rooms        = new RoomRepository();
        $this->reservations = new ReservationRepository();
    }

    // ---------------------------------------------------------------
    // Customer: GET /api/rooms
    // ---------------------------------------------------------------

    public function index(): never
    {
        Auth::requireRole(['Customer', 'Staff', 'Admin']);

        $rooms = $this->rooms->findAllActive();
        foreach ($rooms as &$room) {
            $room['next_available'] = $this->reservations->getNextAvailableSlot($room['room_id']);
        }
        unset($room);
        
        Response::json($rooms);
    }

    // ---------------------------------------------------------------
    // Staff/Admin: PATCH /api/rooms/{id}
    //   status    (Available|Maintenance) -> Staff or Admin
    //   is_active (decommission)          -> Admin only
    // ---------------------------------------------------------------

    public function update(string $roomId): never
    {
        Auth::requireRole(['Staff', 'Admin']);

        $role = (string) Auth::role();
        $body = $this->jsonBody();

        $status = isset($body['status']) ? trim((string) $body['status']) : null;

        $isActive = null;
        if (array_key_exists('is_active', $body)) {
            $isActive = filter_var($body['is_active'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
            if ($isActive === null) {
                Response::error('is_active must be true or false.', 422);
            }
        }

        // Decommissioning a room is an Admin-only act.
        if ($isActive !== null && $role !== 'Admin') {
            Response::error('Only an Admin can activate or deactivate a room.', 403);
        }

        if ($status !== null && !in_array($status, ['Available', 'Maintenance'], true)) {
            Response::error('status must be Available or Maintenance.', 422);
        }

        $before = $this->rooms->findById($roomId);
        if (!$before) {
            Response::error('Room not found.', 404);
        }

        $room = $this->rooms->update($roomId, $status, $isActive);
        if ($room === null) {
            Response::error('Room not found.', 404);
        }

        // Audit log: actual actor role + room NAME (the log archive shows this verbatim).
        $parts = [];
        if ($status !== null) {
            $parts[] = "{$role} set {$room['name']} to {$status}";
        }
        if ($isActive !== null) {
            $parts[] = "{$role} " . ($isActive ? 'reactivated' : 'deactivated') . " {$room['name']}";
        }
        foreach ($parts as $line) {
            $this->reservations->insertLog(Auth::userId(), $line);
        }

        // Warn the operator about bookings stranded by this change. Nothing is auto-cancelled.
        $room['affected_reservations'] = $this->rooms->countUpcomingActiveReservations($roomId);

        Response::json($room);
    }

    // ---------------------------------------------------------------
    // Customer: GET /api/rooms/{id}/calendar
    // ---------------------------------------------------------------

    public function getCalendar(string $roomId): never
    {
        // Allow any logged-in role to view the calendar
        Auth::requireRole(['Customer', 'Staff', 'Admin']);
        
        $start = $_GET['start'] ?? null;
        $end   = $_GET['end']   ?? null;
        
        if (!$start || !$end) {
            Response::error('start and end query parameters are required.', 400);
        }

        // The repository appends 00:00:00 / 23:59:59 to these, so they must be
        // real plain dates (strtotime() also let "2026-02-30" and "tomorrow" through).
        $start = is_string($start) ? DateTimeHelper::toMysqlDate($start) : null;
        $end   = is_string($end)   ? DateTimeHelper::toMysqlDate($end)   : null;
        if ($start === null || $end === null) {
            Response::error('Invalid date format. Use YYYY-MM-DD.', 400);
        }

        if (!$this->rooms->findById($roomId)) {
            Response::error('Room not found.', 404);
        }

        $calendarData = $this->rooms->getRoomCalendar($roomId, $start, $end);

        // Fix Guide 4.3: a student can see who has booked what, and why, in
        // every room via this endpoint. Redact other students' identity and
        // purpose; staff/admin still see everything for scheduling purposes.
        if (Auth::role() === 'Customer') {
            $me = Auth::userId();
            foreach ($calendarData['reservations'] as &$reservation) {
                if ($reservation['customer_id'] !== $me) {
                    $reservation['purpose']       = 'Reserved';
                    $reservation['customer_name'] = '';
                }
                unset($reservation['customer_id']);
            }
            unset($reservation);
        }

        Response::json($calendarData);
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

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
