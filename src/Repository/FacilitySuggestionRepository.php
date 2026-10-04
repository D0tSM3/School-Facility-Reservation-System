<?php

declare(strict_types=1);

namespace CampusRoom\Repository;

use CampusRoom\Core\Database;

/**
 * FacilitySuggestionRepository — all SQL that touches FacilitySuggestions.
 *
 * A suggestion is staff proposing that ONE conflicting day of a booking move to
 * a different (free, matching) room. The customer accepts or declines it.
 */
class FacilitySuggestionRepository
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /** File a new Pending suggestion; returns the stored row (joined). */
    public function create(
        string $reservationId,
        string $originalRoomId,
        string $suggestedRoomId,
        string $affectedDate,
        string $reason,
        string $suggestedBy
    ): array {
        $stmt = $this->db->query(
            'INSERT INTO FacilitySuggestions
                    (reservation_id, original_room_id, suggested_room_id, affected_date, reason, suggested_by)
             VALUES (:reservation_id, :original_room_id, :suggested_room_id, :affected_date, :reason, :suggested_by)
             RETURNING suggestion_id',
            [
                ':reservation_id'    => $reservationId,
                ':original_room_id'  => $originalRoomId,
                ':suggested_room_id' => $suggestedRoomId,
                ':affected_date'     => $affectedDate,
                ':reason'            => $reason,
                ':suggested_by'      => $suggestedBy,
            ]
        );
        return $this->findById((string) $stmt->fetchColumn()) ?? [];
    }

    /** One suggestion with the names of both rooms and the proposing staff. */
    public function findById(string $suggestionId): ?array
    {
        $stmt = $this->db->query(
            'SELECT fs.*,
                    orig.name AS original_room_name,
                    sug.name  AS suggested_room_name,
                    s.name    AS suggested_by_name,
                    res.customer_id,
                    res.start_time,
                    res.end_time,
                    res.status AS reservation_status
               FROM FacilitySuggestions fs
               JOIN Rooms orig ON orig.room_id = fs.original_room_id
               JOIN Rooms sug  ON sug.room_id  = fs.suggested_room_id
               JOIN Users s    ON s.user_id    = fs.suggested_by
               JOIN Reservations res ON res.reservation_id = fs.reservation_id
              WHERE fs.suggestion_id = :suggestion_id
              LIMIT 1',
            [':suggestion_id' => $suggestionId]
        );
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /** Is there already an unanswered suggestion for this booking day? */
    public function hasPendingFor(string $reservationId): bool
    {
        $stmt = $this->db->query(
            "SELECT 1 FROM FacilitySuggestions
              WHERE reservation_id = :reservation_id AND status = 'Pending'
              LIMIT 1",
            [':reservation_id' => $reservationId]
        );
        return (bool) $stmt->fetchColumn();
    }

    /**
     * Every suggestion for a given customer's bookings (newest first), with the
     * room names and the booking's time window so the card can explain itself.
     */
    public function findForCustomer(string $customerId, ?string $status = null): array
    {
        $params = [':customer_id' => $customerId];
        $where  = 'WHERE res.customer_id = :customer_id';
        if ($status !== null) {
            $where .= ' AND fs.status = :status';
            $params[':status'] = $status;
        }

        $stmt = $this->db->query(
            "SELECT fs.suggestion_id,
                    fs.reservation_id,
                    fs.affected_date,
                    fs.reason,
                    fs.status,
                    fs.responded_at,
                    fs.created_at,
                    fs.original_room_id,
                    fs.suggested_room_id,
                    orig.name AS original_room_name,
                    sug.name  AS suggested_room_name,
                    res.start_time,
                    res.end_time,
                    res.purpose,
                    res.status AS reservation_status
               FROM FacilitySuggestions fs
               JOIN Rooms orig ON orig.room_id = fs.original_room_id
               JOIN Rooms sug  ON sug.room_id  = fs.suggested_room_id
               JOIN Reservations res ON res.reservation_id = fs.reservation_id
               $where
           ORDER BY fs.created_at DESC",
            $params
        );
        return $stmt->fetchAll();
    }

    /** Staff view: all suggestions (optionally by status), newest first. */
    public function findAll(?string $status = null): array
    {
        $params = [];
        $where  = '';
        if ($status !== null) {
            $where = 'WHERE fs.status = :status';
            $params[':status'] = $status;
        }

        $stmt = $this->db->query(
            "SELECT fs.suggestion_id,
                    fs.reservation_id,
                    fs.affected_date,
                    fs.reason,
                    fs.status,
                    fs.responded_at,
                    fs.created_at,
                    orig.name AS original_room_name,
                    sug.name  AS suggested_room_name,
                    s.name    AS suggested_by_name,
                    c.name    AS customer_name
               FROM FacilitySuggestions fs
               JOIN Rooms orig ON orig.room_id = fs.original_room_id
               JOIN Rooms sug  ON sug.room_id  = fs.suggested_room_id
               JOIN Users s    ON s.user_id    = fs.suggested_by
               JOIN Reservations res ON res.reservation_id = fs.reservation_id
               JOIN Users c    ON c.user_id    = res.customer_id
               $where
           ORDER BY fs.created_at DESC",
            $params
        );
        return $stmt->fetchAll();
    }

    /** Suggestions keyed by reservation_id, for badging the staff queue. */
    public function findByReservationIds(array $reservationIds): array
    {
        if ($reservationIds === []) {
            return [];
        }
        $placeholders = implode(', ', array_fill(0, count($reservationIds), '?'));
        $stmt = $this->db->query(
            "SELECT fs.reservation_id, fs.suggestion_id, fs.status, fs.affected_date,
                    sug.name AS suggested_room_name
               FROM FacilitySuggestions fs
               JOIN Rooms sug ON sug.room_id = fs.suggested_room_id
              WHERE fs.reservation_id IN ($placeholders)
           ORDER BY fs.created_at DESC",
            array_values($reservationIds)
        );
        return $stmt->fetchAll();
    }

    /** Record the customer's answer; stamps responded_at. Returns the row. */
    public function updateStatus(string $suggestionId, string $status): ?array
    {
        $this->db->query(
            'UPDATE FacilitySuggestions
                SET status = :status, responded_at = NOW()
              WHERE suggestion_id = :suggestion_id',
            [':status' => $status, ':suggestion_id' => $suggestionId]
        );
        return $this->findById($suggestionId);
    }

    /** Open suggestions awaiting a customer answer — the Step 6 overview card. */
    public function countPending(): int
    {
        $stmt = $this->db->query("SELECT COUNT(*) FROM FacilitySuggestions WHERE status = 'Pending'");
        return (int) $stmt->fetchColumn();
    }
}
