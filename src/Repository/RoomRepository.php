<?php

declare(strict_types=1);

namespace CampusRoom\Repository;

use CampusRoom\Core\Database;

/**
 * RoomRepository — all SQL that touches the Rooms table.
 */
class RoomRepository
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /**
     * Generate a random UUIDv4 for explicit primary-key inserts.
     * See ReservationRepository::uuidv4() for why this replaces the
     * re-fetch-by-natural-key pattern.
     */
    private static function uuidv4(): string
    {
        $data = random_bytes(16);
        $data[6] = chr((ord($data[6]) & 0x0f) | 0x40); // version 4
        $data[8] = chr((ord($data[8]) & 0x3f) | 0x80); // variant
        $hex = bin2hex($data);
        return sprintf(
            '%s-%s-%s-%s-%s',
            substr($hex, 0, 8),
            substr($hex, 8, 4),
            substr($hex, 12, 4),
            substr($hex, 16, 4),
            substr($hex, 20, 12)
        );
    }

    /**
     * Return all active rooms (Customer-visible).
     * "Occupied" is derived at query time per the schema's design note.
     */
    public function findAllActive(): array
    {
        $stmt = $this->db->query(
            "SELECT r.room_id,
                    r.name,
                    r.floor,
                    r.room_type,
                    r.capacity,
                    r.status,
                    r.is_active::int AS is_active,
                    r.requires_approval::int AS requires_approval,
                    r.created_at,
                    CASE
                        WHEN EXISTS (
                            SELECT 1 FROM Reservations res
                             WHERE res.room_id = r.room_id
                               AND res.status = 'Approved'
                               AND NOW() BETWEEN res.start_time AND res.end_time
                        ) THEN 'Occupied'
                        ELSE r.status::text
                    END AS live_status
               FROM Rooms r
              WHERE r.is_active = true
           ORDER BY r.name"
        );
        return $stmt->fetchAll();
    }

    /**
     * Return every room regardless of is_active state (Staff/Admin-only view).
     * Customers only ever see findAllActive(); this is what lets Staff/Admin
     * find a decommissioned room again in order to reactivate it.
     */
    public function findAllForManagement(): array
    {
        $stmt = $this->db->query(
            "SELECT r.room_id,
                    r.name,
                    r.floor,
                    r.room_type,
                    r.capacity,
                    r.status,
                    r.is_active::int AS is_active,
                    r.requires_approval::int AS requires_approval,
                    r.created_at,
                    CASE
                        WHEN r.is_active = false THEN 'Decommissioned'
                        WHEN EXISTS (
                            SELECT 1 FROM Reservations res
                             WHERE res.room_id = r.room_id
                               AND res.status = 'Approved'
                               AND NOW() BETWEEN res.start_time AND res.end_time
                        ) THEN 'Occupied'
                        ELSE r.status::text
                    END AS live_status
               FROM Rooms r
           ORDER BY r.is_active DESC, r.name"
        );
        return $stmt->fetchAll();
    }

    /**
     * Rooms eligible for "assign any available room": in service, Available
     * (not under maintenance) and NOT flagged requires_approval — a special
     * room is chosen deliberately, never auto-assigned. The optional filters
     * narrow by minimum capacity, exact room type and exact floor. Ordered by
     * capacity ascending then name, so the smallest room that fits is tried
     * first and the biggest rooms are kept free for bookings that need them.
     *
     * Callers still run ReservationValidator per room/day; this only trims the
     * field to rooms that COULD be booked at all.
     *
     * @return array<int, array<string, mixed>>
     */
    public function findBookableByCriteria(?int $minCapacity, ?string $roomType, ?int $floor): array
    {
        $sql = "SELECT room_id, name, floor, room_type, capacity
                  FROM Rooms
                 WHERE is_active = true
                   AND status = 'Available'
                   AND requires_approval = false";
        $params = [];

        if ($minCapacity !== null) {
            $sql .= ' AND capacity >= :min_capacity';
            $params[':min_capacity'] = $minCapacity;
        }
        if ($roomType !== null && $roomType !== '') {
            $sql .= ' AND room_type = :room_type';
            $params[':room_type'] = $roomType;
        }
        if ($floor !== null) {
            $sql .= ' AND floor = :floor';
            $params[':floor'] = $floor;
        }

        $sql .= ' ORDER BY capacity ASC, name ASC';

        return $this->db->query($sql, $params)->fetchAll();
    }

    /** Find a room by primary key. */
    public function findById(string $roomId): ?array
    {
        $stmt = $this->db->query(
            'SELECT room_id, name, floor, room_type, capacity, status, is_active::int AS is_active,
                    requires_approval::int AS requires_approval, created_at
               FROM Rooms
              WHERE room_id = :room_id
              LIMIT 1',
            [':room_id' => $roomId]
        );
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /**
     * Whether a room always needs Staff sign-off, whatever the schedule says.
     * Drives ReservationController::approvalOutcome() — a true here forces a
     * Pending / 'special' booking instead of auto-approval.
     */
    public function requiresApproval(string $roomId): bool
    {
        $stmt = $this->db->query(
            'SELECT requires_approval FROM Rooms WHERE room_id = :room_id LIMIT 1',
            [':room_id' => $roomId]
        );
        return (bool) $stmt->fetchColumn();
    }

    /**
     * Create a new room (Admin-only).
     */
    public function create(string $name, int $capacity, string $status = 'Available', ?int $floor = null, ?string $roomType = null): array
    {
        $roomId = self::uuidv4();
        $this->db->query(
            'INSERT INTO Rooms (room_id, name, floor, room_type, capacity, status)
             VALUES (:room_id, :name, :floor, :room_type, :capacity, :status)',
            [
                ':room_id'   => $roomId,
                ':name'      => $name,
                ':floor'     => $floor,
                ':room_type' => $roomType,
                ':capacity'  => $capacity,
                ':status'    => $status,
            ]
        );
        return $this->findById($roomId) ?? [];
    }

    /** Find a room by name (used after INSERT to retrieve UUID PK). */
    public function findByName(string $name): ?array
    {
        $stmt = $this->db->query(
            'SELECT room_id, name, floor, room_type, capacity, status, is_active::int AS is_active, created_at
               FROM Rooms
              WHERE name = :name
              LIMIT 1',
            [':name' => $name]
        );
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /**
     * Update room status and/or is_active flag (Admin-only).
     * Only non-null values are applied.
     *
     * @return array|null Updated row, or null if not found.
     */
    public function update(string $roomId, ?string $status, ?bool $isActive, array $details = [], ?bool $requiresApproval = null): ?array
    {
        $sets   = [];
        $params = [':room_id' => $roomId];

        // Admin-edited details. Keys are fixed here, never taken from input.
        foreach (['name', 'capacity', 'floor', 'room_type'] as $column) {
            if (array_key_exists($column, $details)) {
                $sets[]              = "{$column} = :{$column}";
                $params[":{$column}"] = $details[$column];
            }
        }

        if ($status !== null) {
            $sets[]           = 'status = :status';
            $params[':status'] = $status;
        }
        // Booleans are bound as 0/1, not PHP true/false. With emulated prepares
        // off, PDO sends a PHP false as an empty string, which PostgreSQL rejects
        // for a boolean column ("invalid input syntax for type boolean: """);
        // '1'/'0' cast cleanly. (This also fixes room DEACTIVATION, which hit the
        // same bug the moment is_active was set to false.)
        if ($isActive !== null) {
            $sets[]             = 'is_active = :is_active';
            $params[':is_active'] = $isActive ? 1 : 0;
        }
        if ($requiresApproval !== null) {
            $sets[]                      = 'requires_approval = :requires_approval';
            $params[':requires_approval'] = $requiresApproval ? 1 : 0;
        }

        if (empty($sets)) {
            return $this->findById($roomId);
        }

        $sql = 'UPDATE Rooms SET ' . implode(', ', $sets)
             . ' WHERE room_id = :room_id';

        $this->db->query($sql, $params);
        return $this->findById($roomId);
    }

    /**
     * Count Pending/Approved reservations that have not ended yet.
     * Used to warn the operator when a room is taken out of service.
     */
    public function countUpcomingActiveReservations(string $roomId): int
    {
        $stmt = $this->db->query(
            "SELECT COUNT(*)
               FROM Reservations
              WHERE room_id = :room_id
                AND status IN ('Pending', 'Approved')
                AND end_time > NOW()",
            [':room_id' => $roomId]
        );
        return (int) $stmt->fetchColumn();
    }

    /**
     * Get the calendar data for a room in a specific date range.
     * Includes Reservations, ClassSchedules, and Holidays.
     */
    public function getRoomCalendar(string $roomId, string $startDate, string $endDate): array
    {
        // 1. Fetch Reservations (Pending and Approved only, overlapping the date range)
        $reservationsStmt = $this->db->query(
            "SELECT r.reservation_id,
                    r.customer_id,
                    u.name AS customer_name,
                    r.purpose, r.start_time, r.end_time, r.series_id, r.status
               FROM Reservations r
               JOIN Users u ON u.user_id = r.customer_id
              WHERE r.room_id = :room_id
                AND r.status IN ('Pending', 'Approved')
                AND r.start_time < :end_date
                AND r.end_time > :start_date
              ORDER BY r.start_time",
            [
                ':room_id'    => $roomId,
                ':start_date' => $startDate . ' 00:00:00',
                ':end_date'   => $endDate . ' 23:59:59'
            ]
        );
        $reservations = $reservationsStmt->fetchAll();

        // 2. Fetch Class Schedules (All recurring for this room)
        $classSchedulesStmt = $this->db->query(
            "SELECT schedule_id, course_code, section, day_of_week, start_time, end_time
               FROM ClassSchedules
              WHERE room_id = :room_id",
            [':room_id' => $roomId]
        );
        $classSchedules = $classSchedulesStmt->fetchAll();

        // 3. Fetch Holidays in the range
        $holidaysStmt = $this->db->query(
            "SELECT holiday_date, name, type
               FROM Holidays
              WHERE holiday_date >= :start_date
                AND holiday_date <= :end_date",
            [
                ':start_date' => $startDate,
                ':end_date'   => $endDate
            ]
        );
        $holidays = $holidaysStmt->fetchAll();

        return [
            'reservations'    => $reservations,
            'class_schedules' => $classSchedules,
            'holidays'        => $holidays
        ];
    }
}
