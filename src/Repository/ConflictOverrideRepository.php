<?php

declare(strict_types=1);

namespace CampusRoom\Repository;

use CampusRoom\Core\Database;

/**
 * ConflictOverrideRepository — all SQL that touches ConflictOverrideRequests.
 */
class ConflictOverrideRepository
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /** File a new Pending override request; returns the stored row. */
    public function create(
        string $requestedBy,
        string $roomId,
        string $startTime,
        string $endTime,
        string $purpose,
        string $category,
        ?string $equipmentNotes,
        string $reason,
        string $conflictingReservationId,
        ?string $requestType = null,
        ?string $altStartTime = null,
        ?string $altEndTime = null,
        ?string $additionalInfo = null
    ): array {
        $stmt = $this->db->query(
            'INSERT INTO ConflictOverrideRequests
                    (requested_by, room_id, start_time, end_time, purpose, category,
                     equipment_notes, reason, conflicting_reservation_id, request_type, alt_start_time, alt_end_time, additional_info)
             VALUES (:requested_by, :room_id, :start_time, :end_time, :purpose, :category,
                     :equipment_notes, :reason, :conflicting_reservation_id, :request_type, :alt_start_time, :alt_end_time, :additional_info)
             RETURNING request_id',
            [
                ':requested_by'               => $requestedBy,
                ':room_id'                    => $roomId,
                ':start_time'                 => $startTime,
                ':end_time'                   => $endTime,
                ':purpose'                    => $purpose,
                ':category'                   => $category,
                ':equipment_notes'            => $equipmentNotes,
                ':reason'                     => $reason,
                ':conflicting_reservation_id' => $conflictingReservationId,
                ':request_type'               => $requestType,
                ':alt_start_time'             => $altStartTime,
                ':alt_end_time'               => $altEndTime,
                ':additional_info'            => $additionalInfo,
            ]
        );
        return $this->findById((string) $stmt->fetchColumn()) ?? [];
    }

    public function findById(string $requestId): ?array
    {
        $stmt = $this->db->query(
            'SELECT * FROM ConflictOverrideRequests WHERE request_id = :request_id',
            [':request_id' => $requestId]
        );
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /** Does this customer already have an open request against that booking? */
    public function hasPendingFor(string $requestedBy, string $conflictingReservationId): bool
    {
        $stmt = $this->db->query(
            "SELECT 1 FROM ConflictOverrideRequests
              WHERE requested_by = :requested_by
                AND conflicting_reservation_id = :conflicting_reservation_id
                AND status = 'Pending'
              LIMIT 1",
            [':requested_by' => $requestedBy, ':conflicting_reservation_id' => $conflictingReservationId]
        );
        return (bool) $stmt->fetchColumn();
    }

    /**
     * A customer's own override requests, newest first, with the room name.
     * Deliberately nothing about the conflicting booking's owner.
     */
    public function findByRequester(string $requestedBy): array
    {
        $stmt = $this->db->query(
            'SELECT o.request_id, o.room_id, r.name AS room_name, o.start_time, o.end_time,
                    o.purpose, o.category, o.reason, o.status, o.staff_comment,
                    o.outcome, o.outcome_note, o.created_reservation_id,
                    o.processed_at, o.created_at, o.request_type, o.alt_start_time, o.alt_end_time,
                    o.additional_info, o.equipment_notes, o.conflicting_reservation_id
               FROM ConflictOverrideRequests o
               JOIN Rooms r ON r.room_id = o.room_id
              WHERE o.requested_by = :requested_by
           ORDER BY o.created_at DESC',
            [':requested_by' => $requestedBy]
        );
        return $stmt->fetchAll();
    }

    /** Delete/withdraw a customer's override request. */
    public function delete(string $requestId): bool
    {
        $stmt = $this->db->query(
            'DELETE FROM ConflictOverrideRequests WHERE request_id = :request_id',
            [':request_id' => $requestId]
        );
        return $stmt->rowCount() > 0;
    }

    /**
     * The staff queue: who is asking and why, the requested slot, and the
     * conflicting booking's time and status — but not who holds it, the
     * same thing the requester was never told. Oldest first.
     */
    public function findAll(?string $status = null): array
    {
        $sql = 'SELECT o.request_id, o.requested_by, u.name AS requester_name, u.email AS requester_email,
                       o.room_id, rm.name AS room_name, rm.room_type, rm.floor, rm.capacity,
                       o.start_time, o.end_time, o.purpose, o.category, o.equipment_notes, o.reason,
                       o.status, o.staff_comment, o.outcome, o.outcome_note,
                       o.move_request_id, o.created_reservation_id, o.processed_at, o.created_at,
                       o.conflicting_reservation_id,
                       c.start_time AS conflict_start_time, c.end_time AS conflict_end_time,
                       c.status AS conflict_status
                  FROM ConflictOverrideRequests o
                  JOIN Users u         ON u.user_id = o.requested_by
                  JOIN Rooms rm        ON rm.room_id = o.room_id
                  JOIN Reservations c  ON c.reservation_id = o.conflicting_reservation_id';
        $params = [];
        if ($status !== null) {
            $sql .= ' WHERE o.status = :status';
            $params[':status'] = $status;
        }
        $sql .= ' ORDER BY o.created_at ASC';
        return $this->db->query($sql, $params)->fetchAll();
    }

    /** The override request (if any) waiting on this move request. */
    public function findAwaitingMove(string $moveRequestId): ?array
    {
        $stmt = $this->db->query(
            "SELECT * FROM ConflictOverrideRequests
              WHERE move_request_id = :move_request_id AND outcome = 'Awaiting move'
              LIMIT 1",
            [':move_request_id' => $moveRequestId]
        );
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /** Record the staff decision (Approved / Rejected) on a Pending request. */
    public function decide(
        string $requestId,
        string $status,
        string $processedBy,
        ?string $staffComment,
        ?string $moveRequestId = null,
        ?string $outcome = null
    ): ?array {
        $this->db->query(
            "UPDATE ConflictOverrideRequests
                SET status = :status, processed_by = :processed_by, processed_at = NOW(),
                    staff_comment = :staff_comment, move_request_id = :move_request_id, outcome = :outcome
              WHERE request_id = :request_id AND status = 'Pending'",
            [
                ':status'          => $status,
                ':processed_by'    => $processedBy,
                ':staff_comment'   => $staffComment,
                ':move_request_id' => $moveRequestId,
                ':outcome'         => $outcome,
                ':request_id'      => $requestId,
            ]
        );
        return $this->findById($requestId);
    }

    /** How an approved request ended: 'Booked', 'Move rejected' or 'Booking failed'. */
    public function setOutcome(string $requestId, string $outcome, ?string $note = null, ?string $createdReservationId = null): void
    {
        $this->db->query(
            'UPDATE ConflictOverrideRequests
                SET outcome = :outcome, outcome_note = :note,
                    created_reservation_id = COALESCE(CAST(:created_reservation_id AS UUID), created_reservation_id)
              WHERE request_id = :request_id',
            [
                ':outcome'                => $outcome,
                ':note'                   => $note,
                ':created_reservation_id' => $createdReservationId,
                ':request_id'             => $requestId,
            ]
        );
    }
}
