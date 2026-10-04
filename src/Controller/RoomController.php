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
    /** Maximum allowed seating/person capacity for any campus facility */
    public const MAX_CAPACITY = 1000;

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

        $role = (string) Auth::role();

        // Staff/Admin manage the room inventory, so they need to see
        // decommissioned rooms too (otherwise there's no way back short of
        // a direct DB edit). Customers only ever see bookable rooms.
        $rooms = in_array($role, ['Staff', 'Admin'], true)
            ? $this->rooms->findAllForManagement()
            : $this->rooms->findAllActive();

        foreach ($rooms as &$room) {
            $room['next_available'] = $this->reservations->getNextAvailableSlot($room['room_id']);
        }
        unset($room);
        
        Response::json($rooms);
    }

    // ---------------------------------------------------------------
    // Admin: POST /api/rooms
    // ---------------------------------------------------------------

    public function store(): never
    {
        Auth::requireRole(['Admin']);

        $body = $this->jsonBody();

        $name     = trim($body['name']     ?? '');
        $capacity = $body['capacity']       ?? null;
        $status   = trim($body['status']   ?? 'Available');
        $floor    = $body['floor']          ?? null;
        $roomType = trim((string) ($body['room_type'] ?? ''));

        if ($name === '') {
            Response::error('name is required.', 422);
        }
        if (!is_numeric($capacity) || (int) $capacity <= 0 || (int) $capacity > self::MAX_CAPACITY) {
            Response::error('Capacity must be between 1 and ' . number_format(self::MAX_CAPACITY) . ' persons.', 422);
        }
        if (!in_array($status, ['Available', 'Maintenance'], true)) {
            Response::error('status must be Available or Maintenance.', 422);
        }
        if ($floor === null || $floor === '' || !is_numeric($floor)) {
            Response::error('floor is required.', 422);
        }
        if ($roomType === '') {
            Response::error('room_type is required.', 422);
        }

        $room = $this->rooms->create($name, (int) $capacity, $status, (int) $floor, $roomType);

        // Audit log
        $this->reservations->insertLog(
            Auth::userId(),
            "Admin created room '{$room['name']}' (ID: {$room['room_id']})"
        );

        Response::json($room, 201);
    }

    // ---------------------------------------------------------------
    // Staff/Admin: PATCH /api/rooms/{id}
    //   status    (Available|Maintenance)             -> Staff or Admin
    //   is_active (decommission)                      -> Admin only
    //   name, capacity, floor, room_type (details)    -> Admin only
    // ---------------------------------------------------------------

    public function update(string $roomId): never
    {
        Auth::requireRole(['Staff', 'Admin']);

        $role = (string) Auth::role();
        $body = $this->jsonBody();

        $details = $this->roomDetails($body);
        if ($details !== [] && $role !== 'Admin') {
            Response::error('Only an Admin can edit room details.', 403);
        }

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

        $room = $this->rooms->update($roomId, $status, $isActive, $details);
        if ($room === null) {
            Response::error('Room not found.', 404);
        }

        // Audit log: actual actor role + room NAME (the log archive shows this verbatim).
        $parts = [];
        $changed = [];
        foreach ($details as $field => $value) {
            if ((string) $before[$field] !== (string) $value) {
                $changed[] = "{$field} {$before[$field]} → {$value}";
            }
        }
        if ($changed !== []) {
            $parts[] = "{$role} edited {$before['name']}: " . implode(', ', $changed);
        }
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
    // Admin: DELETE /api/rooms/{id}
    // ---------------------------------------------------------------

    public function destroy(string $roomId): never
    {
        Auth::requireRole(['Admin']);

        $room = $this->rooms->findById($roomId);
        if ($room === null) {
            Response::error('Room not found.', 404);
        }

        $userId = Auth::userId();
        $summary = "Facility: {$room['name']} ({$room['room_type']}) - Floor {$room['floor']}, {$room['capacity']} Seats";

        // Institutional 30-day archival policy
        try {
            (new \CampusRoom\Repository\ArchiveRepository())->archive(
                'rooms',
                $roomId,
                $summary,
                $room,
                $userId,
                'Admin deleted facility'
            );
        } catch (\Throwable $e) {
            error_log('[RoomController] Failed to archive deleted room: ' . $e->getMessage());
        }

        $deleted = $this->rooms->delete($roomId);

        // Audit log
        $this->reservations->insertLog(
            $userId,
            "Admin archived and deleted facility '{$room['name']}' (ID: {$roomId}) — retained in archive for 30 days"
        );

        Response::json([
            'success' => true,
            'message' => "Facility '{$room['name']}' has been deleted and archived for 30 days.",
            'deleted' => $deleted,
        ]);
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
            $start = $start ?: date('Y-m-d');
            $end   = $end   ?: date('Y-m-d', strtotime('+30 days'));
        }

        // The repository appends 00:00:00 / 23:59:59 to these, so they must be
        // real plain dates (strtotime() also let "2026-02-30" and "tomorrow" through).
        $start = is_string($start) ? DateTimeHelper::toMysqlDate($start) : null;
        $end   = is_string($end)   ? DateTimeHelper::toMysqlDate($end)   : null;
        if ($start === null || $end === null) {
            Response::error('Invalid date format. Use YYYY-MM-DD.', 400);
        }

        // Removed findById() check to save a network roundtrip to the remote database (~250ms latency).
        // Invalid room IDs will simply return an empty schedule, which is safe for this read-only endpoint.

        $calendarData = $this->rooms->getRoomCalendar($roomId, $start, $end);
        // Expose 'classes' alias for frontend compatibility
        $calendarData['classes'] = $calendarData['class_schedules'] ?? [];

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

    /**
     * The room-detail fields present in a PATCH body, validated with the same
     * rules as store(). Absent fields are left out; an invalid one ends the
     * request with 422.
     *
     * @return array<string, string|int>
     */
    private function roomDetails(array $body): array
    {
        $details = [];

        if (array_key_exists('name', $body)) {
            $name = trim((string) $body['name']);
            if ($name === '') {
                Response::error('name cannot be empty.', 422);
            }
            $details['name'] = $name;
        }
        if (array_key_exists('capacity', $body)) {
            if (!is_numeric($body['capacity']) || (int) $body['capacity'] <= 0 || (int) $body['capacity'] > self::MAX_CAPACITY) {
                Response::error('Capacity must be between 1 and ' . number_format(self::MAX_CAPACITY) . ' persons.', 422);
            }
            $details['capacity'] = (int) $body['capacity'];
        }
        if (array_key_exists('floor', $body)) {
            if ($body['floor'] === '' || !is_numeric($body['floor'])) {
                Response::error('floor must be a number.', 422);
            }
            $details['floor'] = (int) $body['floor'];
        }
        if (array_key_exists('room_type', $body)) {
            $roomType = trim((string) $body['room_type']);
            if ($roomType === '') {
                Response::error('room_type cannot be empty.', 422);
            }
            $details['room_type'] = $roomType;
        }

        return $details;
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
