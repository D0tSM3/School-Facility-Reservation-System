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
     * Return all active rooms (Customer-visible).
     * "Occupied" is derived at query time per the schema's design note.
     */
    public function findAllActive(): array
    {
        $stmt = $this->db->query(
            "SELECT r.room_id,
                    r.name,
                    r.capacity,
                    r.status,
                    r.is_active,
                    r.created_at,
                    CASE
                        WHEN EXISTS (
                            SELECT 1 FROM Reservations res
                             WHERE res.room_id = r.room_id
                               AND res.status = 'Approved'
                               AND NOW() BETWEEN res.start_time AND res.end_time
                        ) THEN 'Occupied'
                        ELSE r.status
                    END AS live_status
               FROM Rooms r
              WHERE r.is_active = TRUE
           ORDER BY r.name"
        );
        return $stmt->fetchAll();
    }

    /** Find a room by primary key. */
    public function findById(string $roomId): ?array
    {
        $stmt = $this->db->query(
            'SELECT room_id, name, capacity, status, is_active, created_at
               FROM Rooms
              WHERE room_id = :room_id
              LIMIT 1',
            [':room_id' => $roomId]
        );
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /**
     * Create a new room (Admin-only).
     */
    public function create(string $name, int $capacity, string $status = 'Available'): array
    {
        $stmt = $this->db->query(
            'INSERT INTO Rooms (name, capacity, status)
             VALUES (:name, :capacity, :status)
             RETURNING room_id, name, capacity, status, is_active, created_at',
            [
                ':name'     => $name,
                ':capacity' => $capacity,
                ':status'   => $status,
            ]
        );
        return $stmt->fetch();
    }

    /**
     * Update room status and/or is_active flag (Admin-only).
     * Only non-null values are applied.
     *
     * @return array|null Updated row, or null if not found.
     */
    public function update(string $roomId, ?string $status, ?bool $isActive): ?array
    {
        $sets   = [];
        $params = [':room_id' => $roomId];

        if ($status !== null) {
            $sets[]           = 'status = :status';
            $params[':status'] = $status;
        }
        if ($isActive !== null) {
            $sets[]             = 'is_active = :is_active';
            $params[':is_active'] = $isActive ? 'TRUE' : 'FALSE';
        }

        if (empty($sets)) {
            return $this->findById($roomId);
        }

        $sql  = 'UPDATE Rooms SET ' . implode(', ', $sets)
              . ' WHERE room_id = :room_id'
              . ' RETURNING room_id, name, capacity, status, is_active, created_at';

        $stmt = $this->db->query($sql, $params);
        $row  = $stmt->fetch();
        return $row ?: null;
    }
}
