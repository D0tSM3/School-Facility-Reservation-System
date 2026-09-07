<?php

declare(strict_types=1);

namespace CampusRoom\Repository;

use CampusRoom\Core\Database;

/**
 * ReservationRepository — all SQL that touches Reservations and System_Logs.
 */
class ReservationRepository
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /**
     * Create a new reservation for a customer.
     * The prevent_double_booking_insert MySQL trigger fires here;
     * callers must catch PDOException with SQLSTATE 45000.
     */
    public function create(string $customerId, string $roomId, string $startTime, string $endTime): array
    {
        $this->db->query(
            'INSERT INTO Reservations (customer_id, room_id, start_time, end_time)
             VALUES (:customer_id, :room_id, :start_time, :end_time)',
            [
                ':customer_id' => $customerId,
                ':room_id'     => $roomId,
                ':start_time'  => $startTime,
                ':end_time'    => $endTime,
            ]
        );
        // UUID PK — re-fetch the latest reservation for this customer+room+time.
        $stmt = $this->db->query(
            'SELECT reservation_id, customer_id, room_id,
                    start_time, end_time, status, processed_by, created_at
               FROM Reservations
              WHERE customer_id = :customer_id
                AND room_id     = :room_id
                AND start_time  = :start_time
              LIMIT 1',
            [
                ':customer_id' => $customerId,
                ':room_id'     => $roomId,
                ':start_time'  => $startTime,
            ]
        );
        return $stmt->fetch();
    }

    /**
     * All reservations belonging to a specific customer.
     */
    public function findByCustomer(string $customerId): array
    {
        $stmt = $this->db->query(
            'SELECT res.reservation_id,
                    res.customer_id,
                    res.room_id,
                    r.name          AS room_name,
                    res.start_time,
                    res.end_time,
                    res.status,
                    res.processed_by,
                    res.created_at
               FROM Reservations res
               JOIN Rooms r ON r.room_id = res.room_id
              WHERE res.customer_id = :customer_id
           ORDER BY res.created_at DESC',
            [':customer_id' => $customerId]
        );
        return $stmt->fetchAll();
    }

    /**
     * All reservations, optionally filtered by status (Staff/Admin).
     */
    public function findAll(?string $status = null): array
    {
        $params = [];
        $where  = '';

        if ($status !== null) {
            $where           = 'WHERE res.status = :status';
            $params[':status'] = $status;
        }

        $stmt = $this->db->query(
            "SELECT res.reservation_id,
                    res.customer_id,
                    u.email         AS customer_email,
                    res.room_id,
                    r.name          AS room_name,
                    res.start_time,
                    res.end_time,
                    res.status,
                    res.processed_by,
                    res.created_at
               FROM Reservations res
               JOIN Users u ON u.user_id = res.customer_id
               JOIN Rooms r ON r.room_id = res.room_id
               $where
           ORDER BY res.created_at DESC",
            $params
        );
        return $stmt->fetchAll();
    }

    /**
     * Find a single reservation by ID.
     */
    public function findById(string $reservationId): ?array
    {
        $stmt = $this->db->query(
            'SELECT reservation_id, customer_id, room_id,
                    start_time, end_time, status, processed_by, created_at
               FROM Reservations
              WHERE reservation_id = :reservation_id
              LIMIT 1',
            [':reservation_id' => $reservationId]
        );
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /**
     * Update a reservation's status (Approved / Rejected / Completed).
     * The trigger fires again on UPDATE so overlap is rechecked.
     *
     * @return array|null Updated row, or null if not found.
     */
    public function updateStatus(
        string $reservationId,
        string $status,
        string $processedBy
    ): ?array {
        $this->db->query(
            'UPDATE Reservations
                SET status       = :status,
                    processed_by = :processed_by
              WHERE reservation_id = :reservation_id',
            [
                ':status'         => $status,
                ':processed_by'   => $processedBy,
                ':reservation_id' => $reservationId,
            ]
        );
        return $this->findById($reservationId);
    }

    // ---------------------------------------------------------------
    // System_Logs
    // ---------------------------------------------------------------

    /**
     * Insert an audit log entry.
     */
    public function insertLog(string $userId, string $actionType): array
    {
        $this->db->query(
            'INSERT INTO System_Logs (user_id, action_type)
             VALUES (:user_id, :action_type)',
            [
                ':user_id'     => $userId,
                ':action_type' => $actionType,
            ]
        );
        // Re-fetch the just-inserted log by user_id + action_type (latest).
        $stmt = $this->db->query(
            'SELECT log_id, user_id, action_type, timestamp
               FROM System_Logs
              WHERE user_id     = :user_id
                AND action_type = :action_type
           ORDER BY timestamp DESC
              LIMIT 1',
            [
                ':user_id'     => $userId,
                ':action_type' => $actionType,
            ]
        );
        return $stmt->fetch();
    }

    /**
     * Return all audit log entries (Admin-only).
     */
    public function findAllLogs(): array
    {
        $stmt = $this->db->query(
            'SELECT sl.log_id,
                    sl.user_id,
                    u.email     AS actor_email,
                    sl.action_type,
                    sl.timestamp
               FROM System_Logs sl
          LEFT JOIN Users u ON u.user_id = sl.user_id
           ORDER BY sl.timestamp DESC'
        );
        return $stmt->fetchAll();
    }
}
