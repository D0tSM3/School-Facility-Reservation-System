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
     * Generate a random UUIDv4. Used to assign the primary key in PHP at
     * INSERT time instead of relying on the schema's DEFAULT (UUID()) and
     * re-fetching by natural key — the re-fetch approach is tie-prone
     * whenever more than one row can share the same natural key (e.g. the
     * same customer re-booking the same room/time after a rejection).
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
     * Create a new reservation for a customer.
     * The prevent_double_booking_insert MySQL trigger fires here;
     * callers must catch PDOException with SQLSTATE 45000.
     */
    public function create(
        string $customerId,
        string $roomId,
        string $purpose,
        string $startTime,
        string $endTime,
        ?string $equipmentNotes = null,
        string $category = 'Academic Lecture'
    ): array {
        $reservationId = self::uuidv4();
        $this->db->query(
            'INSERT INTO Reservations (reservation_id, customer_id, room_id, purpose, category, equipment_notes, start_time, end_time)
             VALUES (:reservation_id, :customer_id, :room_id, :purpose, :category, :equipment_notes, :start_time, :end_time)',
            [
                ':reservation_id'  => $reservationId,
                ':customer_id'     => $customerId,
                ':room_id'         => $roomId,
                ':purpose'         => $purpose,
                ':category'        => $category,
                ':equipment_notes' => $equipmentNotes,
                ':start_time'      => $startTime,
                ':end_time'        => $endTime,
            ]
        );
        // Fetch by primary key — no more re-fetch-by-natural-key ambiguity.
        return $this->findById($reservationId) ?? [];
    }

    /**
     * The "latest move request per reservation" derived table, shared by
     * findByCustomer() and findAll() so there is exactly one idiom in this file.
     */
    private const LATEST_MOVE_JOIN = '
               LEFT JOIN (
                   SELECT m1.* FROM ReservationMoveRequests m1
                    WHERE m1.created_at = (SELECT MAX(created_at) FROM ReservationMoveRequests m2 WHERE m2.reservation_id = m1.reservation_id)
               ) mr ON mr.reservation_id = res.reservation_id';

    /**
     * The same idiom for cancellation requests: the newest one per reservation.
     * Drives the customer's "Cancellation request pending review" badge and
     * stops the UI offering a second request while one is still open.
     */
    private const LATEST_CANCEL_JOIN = '
               LEFT JOIN (
                   SELECT c1.* FROM ReservationCancellationRequests c1
                    WHERE c1.created_at = (SELECT MAX(created_at) FROM ReservationCancellationRequests c2 WHERE c2.reservation_id = c1.reservation_id)
               ) cr ON cr.reservation_id = res.reservation_id';

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
                    r.floor         AS floor,
                    r.room_type     AS room_type,
                    r.capacity      AS capacity,
                    res.purpose,
                    res.category,
                    res.start_time,
                    res.end_time,
                    res.status,
                    res.processed_by,
                    p.name          AS processed_by_name,
                    res.created_at,
                    mr.status AS move_status,
                    mr.staff_comment AS move_comment,
                    cr.status AS cancel_status,
                    cr.staff_comment AS cancel_comment,
                    cr.reason AS cancel_reason
               FROM Reservations res
               JOIN Rooms r ON r.room_id = res.room_id
          LEFT JOIN Users p ON p.user_id = res.processed_by'
               . self::LATEST_MOVE_JOIN
               . self::LATEST_CANCEL_JOIN . '
              WHERE res.customer_id = :customer_id
                AND res.customer_hidden = 0
           ORDER BY res.created_at DESC',
            [':customer_id' => $customerId]
        );
        return $stmt->fetchAll();
    }

    /**
     * The customer's "Remove": drop the booking out of their list without
     * deleting anything. Staff, the room calendar and the audit log are
     * unaffected, so the row can still be explained later.
     *
     * Removing something still Pending must CANCEL it first (the caller does
     * that) or the room would stay blocked by a booking nobody can see.
     */
    public function hideFromCustomer(string $reservationId): void
    {
        $this->db->query(
            'UPDATE Reservations SET customer_hidden = 1 WHERE reservation_id = :reservation_id',
            [':reservation_id' => $reservationId]
        );
    }

    /**
     * All reservations, optionally filtered by status (Staff/Admin).
     * Paginated: $limit is clamped to 1..500, $offset to >= 0.
     */
    public function findAll(?string $status = null, int $limit = 200, int $offset = 0): array
    {
        $params = [];
        $where  = '';

        if ($status !== null) {
            $where             = 'WHERE res.status = :status';
            $params[':status'] = $status;
        }

        // LIMIT/OFFSET are cast to int and inlined: with native prepares PDO would
        // bind them as strings, which MySQL rejects in a LIMIT clause.
        $limit  = max(1, min(500, $limit));
        $offset = max(0, $offset);

        $stmt = $this->db->query(
            "SELECT res.reservation_id,
                    res.customer_id,
                    u.name          AS customer_name,
                    u.email         AS customer_email,
                    res.room_id,
                    r.name          AS room_name,
                    r.floor         AS floor,
                    r.room_type     AS room_type,
                    r.capacity      AS capacity,
                    r.status        AS room_status,
                    res.purpose,
                    res.category,
                    res.start_time,
                    res.end_time,
                    res.status,
                    res.processed_by,
                    res.processed_at,
                    p.name          AS processed_by_name,
                    res.created_at,
                    mr.status       AS move_status,
                    mr.requested_start_time,
                    mr.requested_end_time,
                    cr.status       AS cancel_status
               FROM Reservations res
               JOIN Users u ON u.user_id = res.customer_id
               JOIN Rooms r ON r.room_id = res.room_id
          LEFT JOIN Users p ON p.user_id = res.processed_by"
               . self::LATEST_MOVE_JOIN
               . self::LATEST_CANCEL_JOIN . "
               $where
           ORDER BY res.created_at DESC, res.reservation_id DESC
              LIMIT $limit OFFSET $offset",
            $params
        );
        return $stmt->fetchAll();
    }

    /**
     * One reservation with every joined field the confirmation slip needs
     * (same column set as findAll()), plus its full move-request history
     * (newest first) under `move_requests`.
     */
    public function findByIdDetailed(string $reservationId): ?array
    {
        $stmt = $this->db->query(
            'SELECT res.reservation_id,
                    res.customer_id,
                    u.name          AS customer_name,
                    u.email         AS customer_email,
                    res.room_id,
                    r.name          AS room_name,
                    r.floor         AS floor,
                    r.room_type     AS room_type,
                    r.capacity      AS capacity,
                    r.status        AS room_status,
                    res.purpose,
                    res.category,
                    res.equipment_notes,
                    res.start_time,
                    res.end_time,
                    res.status,
                    res.processed_by,
                    p.name          AS processed_by_name,
                    res.cancellation_reason,
                    res.cancelled_by,
                    res.created_at,
                    mr.status       AS move_status,
                    mr.requested_start_time,
                    mr.requested_end_time
               FROM Reservations res
               JOIN Users u ON u.user_id = res.customer_id
               JOIN Rooms r ON r.room_id = res.room_id
          LEFT JOIN Users p ON p.user_id = res.processed_by'
               . self::LATEST_MOVE_JOIN . '
              WHERE res.reservation_id = :reservation_id
              LIMIT 1',
            [':reservation_id' => $reservationId]
        );
        $row = $stmt->fetch();
        if (!$row) {
            return null;
        }

        $moves = $this->db->query(
            'SELECT m.request_id,
                    m.requested_start_time,
                    m.requested_end_time,
                    m.status,
                    m.staff_comment,
                    m.processed_by,
                    p.name AS processed_by_name,
                    m.created_at
               FROM ReservationMoveRequests m
          LEFT JOIN Users p ON p.user_id = m.processed_by
              WHERE m.reservation_id = :reservation_id
           ORDER BY m.created_at DESC, m.request_id DESC',
            [':reservation_id' => $reservationId]
        );
        $row['move_requests'] = $moves->fetchAll();

        return $row;
    }

    /**
     * Find a single reservation by ID.
     */
    public function findById(string $reservationId): ?array
    {
        $stmt = $this->db->query(
            'SELECT reservation_id, customer_id, room_id, purpose, category, equipment_notes,
                    start_time, end_time, status, processed_by, processed_at,
                    cancellation_reason, cancelled_by, created_at
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
     * Stamps processed_at = NOW() so "processed today" KPIs (e.g. Staff
     * Queue's "Approved for Today") measure when the action happened,
     * not the booking's start_time.
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
                    processed_by = :processed_by,
                    processed_at = NOW()
              WHERE reservation_id = :reservation_id',
            [
                ':status'         => $status,
                ':processed_by'   => $processedBy,
                ':reservation_id' => $reservationId,
            ]
        );
        return $this->findById($reservationId);
    }

    /**
     * Cancel a reservation. Sets status='Cancelled', records who cancelled
     * it and (optionally) why, and deliberately leaves `processed_by`
     * untouched — that column means "the staff member who approved or
     * rejected this", and cancelling must not overload it.
     *
     * The prevent_double_booking_update trigger only re-checks overlap when
     * NEW.status IN ('Pending','Approved'); 'Cancelled' is not in that set,
     * so this never fires the collision check.
     *
     * @return array|null Updated row, or null if not found.
     */
    public function cancel(
        string $reservationId,
        string $cancelledBy,
        ?string $reason
    ): ?array {
        $this->db->query(
            'UPDATE Reservations
                SET status              = \'Cancelled\',
                    cancellation_reason = :reason,
                    cancelled_by        = :cancelled_by
              WHERE reservation_id = :reservation_id',
            [
                ':reason'          => $reason,
                ':cancelled_by'    => $cancelledBy,
                ':reservation_id'  => $reservationId,
            ]
        );
        return $this->findById($reservationId);
    }

    // ---------------------------------------------------------------
    // Queries
    // ---------------------------------------------------------------

    /**
     * Get the end_time of the first upcoming or currently blocking reservation.
     * Returns "Available now" if there is no such reservation.
     */
    public function getNextAvailableSlot(string $roomId): string
    {
        $stmt = $this->db->query(
            "SELECT end_time
               FROM Reservations
              WHERE room_id = :room_id
                AND status IN ('Pending', 'Approved')
                AND end_time > NOW()
           ORDER BY start_time ASC
              LIMIT 1",
            [':room_id' => $roomId]
        );
        $row = $stmt->fetch();
        return $row ? $row['end_time'] : 'Available now';
    }

    // ---------------------------------------------------------------
    // System_Logs
    // ---------------------------------------------------------------

    /**
     * Insert an audit log entry.
     *
     * $reservationId ties the row to a booking so its history can be queried
     * by column instead of by scanning free text. Pass null for events that
     * are not about one booking (room maintenance, role changes).
     *
     * Returns nothing on purpose. The old version re-read "the latest row for
     * this user + action string", which can hand back another request's row
     * when identical actions land in the same second (batch approve), and
     * nothing used the return value anyway.
     */
    public function insertLog(string $userId, string $actionType, ?string $reservationId = null): void
    {
        // action_type is VARCHAR(255). Some messages carry user-supplied text
        // (a cancellation reason), so trim to fit rather than let an
        // over-long value turn an already-committed action into a 500.
        if (mb_strlen($actionType) > 255) {
            $actionType = mb_substr($actionType, 0, 252) . '...';
        }

        $this->db->query(
            'INSERT INTO System_Logs (user_id, reservation_id, action_type)
             VALUES (:user_id, :reservation_id, :action_type)',
            [
                ':user_id'        => $userId,
                ':reservation_id' => $reservationId,
                ':action_type'    => $actionType,
            ]
        );
    }

    /**
     * Turn a Y-m-d string into "Y-m-d 00:00:00", or null if it is not a real
     * calendar date.
     */
    private static function dayStart(string $date): ?string
    {
        $dt = \DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        if ($dt === false || $dt->format('Y-m-d') !== $date) {
            return null;
        }
        return $dt->format('Y-m-d H:i:s');
    }

    /**
     * Build the WHERE clause for log queries from a fixed whitelist of filters.
     * Only the keys named below are ever read from $filters, and every value
     * goes in as a bound parameter, so a caller can never smuggle in a column
     * name or SQL fragment.
     *
     * Supported: reservation_id, user_id, from (Y-m-d, inclusive),
     * to (Y-m-d, inclusive of that whole day), q (substring of action_type).
     *
     * @param  array<string, mixed> $filters
     * @return array{0: string, 1: array<string, string>}  [where_sql, params]
     */
    private static function buildLogWhere(array $filters): array
    {
        $where  = [];
        $params = [];

        if (isset($filters['reservation_id']) && $filters['reservation_id'] !== '') {
            $where[]                   = 'sl.reservation_id = :reservation_id';
            $params[':reservation_id'] = (string) $filters['reservation_id'];
        }

        if (isset($filters['user_id']) && $filters['user_id'] !== '') {
            $where[]            = 'sl.user_id = :user_id';
            $params[':user_id'] = (string) $filters['user_id'];
        }

        if (isset($filters['from']) && $filters['from'] !== '') {
            $start = self::dayStart((string) $filters['from']);
            if ($start === null) {
                $where[] = '1 = 0'; // unparseable date: match nothing rather than everything
            } else {
                $where[]            = 'sl.timestamp >= :from_ts';
                $params[':from_ts'] = $start;
            }
        }

        if (isset($filters['to']) && $filters['to'] !== '') {
            $start = self::dayStart((string) $filters['to']);
            if ($start === null) {
                $where[] = '1 = 0';
            } else {
                // Exclusive upper bound = midnight after the "to" day.
                $next             = (new \DateTimeImmutable($start))->modify('+1 day');
                $where[]          = 'sl.timestamp < :to_ts';
                $params[':to_ts'] = $next->format('Y-m-d H:i:s');
            }
        }

        if (isset($filters['q']) && $filters['q'] !== '') {
            // '|' is the LIKE escape character so this does not depend on the
            // server's backslash handling; user-typed % and _ stay literal.
            $where[]      = "sl.action_type LIKE :q ESCAPE '|'";
            $params[':q'] = '%' . str_replace(['|', '%', '_'], ['||', '|%', '|_'], (string) $filters['q']) . '%';
        }

        return [$where ? 'WHERE ' . implode(' AND ', $where) : '', $params];
    }

    /**
     * Audit log entries, newest first, optionally filtered and paged.
     * Replaces the old unbounded findAllLogs().
     *
     * LEFT JOINs throughout: reservation_id is nullable (room and role events
     * have none) and a deleted user must not make a row vanish.
     *
     * @param  array<string, mixed> $filters see buildLogWhere()
     * @return array<int, array<string, mixed>>
     */
    public function findLogs(array $filters = [], int $limit = 100, int $offset = 0): array
    {
        [$where, $params] = self::buildLogWhere($filters);

        // LIMIT/OFFSET are cast to int and inlined: with native prepares PDO
        // would bind them as strings, which MySQL rejects in a LIMIT clause.
        $limit  = max(1, min(500, $limit));
        $offset = max(0, $offset);

        $stmt = $this->db->query(
            "SELECT sl.log_id,
                    sl.user_id,
                    sl.reservation_id,
                    u.name          AS actor_name,
                    u.email         AS actor_email,
                    u.role          AS actor_role,
                    rm.name         AS room_name,
                    res.purpose     AS purpose,
                    sl.action_type,
                    sl.timestamp
               FROM System_Logs sl
          LEFT JOIN Users        u   ON u.user_id         = sl.user_id
          LEFT JOIN Reservations res ON res.reservation_id = sl.reservation_id
          LEFT JOIN Rooms        rm  ON rm.room_id        = res.room_id
               $where
           ORDER BY sl.timestamp DESC, sl.log_id DESC
              LIMIT $limit OFFSET $offset",
            $params
        );
        return $stmt->fetchAll();
    }

    /**
     * Total rows matching the same filters as findLogs(), ignoring paging,
     * so the frontend can render page controls.
     *
     * @param array<string, mixed> $filters see buildLogWhere()
     */
    public function countLogs(array $filters = []): int
    {
        [$where, $params] = self::buildLogWhere($filters);

        $stmt = $this->db->query("SELECT COUNT(*) FROM System_Logs sl $where", $params);
        return (int) $stmt->fetchColumn();
    }

    // ---------------------------------------------------------------
    // Move Requests
    // ---------------------------------------------------------------

    public function createMoveRequest(string $reservationId, string $requestedStart, string $requestedEnd): array
    {
        $requestId = self::uuidv4();
        $this->db->query(
            'INSERT INTO ReservationMoveRequests (request_id, reservation_id, requested_start_time, requested_end_time)
             VALUES (:request_id, :reservation_id, :requested_start_time, :requested_end_time)',
            [
                ':request_id'           => $requestId,
                ':reservation_id'       => $reservationId,
                ':requested_start_time' => $requestedStart,
                ':requested_end_time'   => $requestedEnd,
            ]
        );

        $stmt = $this->db->query(
            'SELECT * FROM ReservationMoveRequests WHERE request_id = :request_id LIMIT 1',
            [':request_id' => $requestId]
        );
        return $stmt->fetch() ?: [];
    }

    /**
     * True while this booking has a move request still awaiting staff.
     *
     * Business rule: a reservation may have at most one open Move Request.
     * The customer's card hides the button, but that is a courtesy — a stale
     * tab or a direct API call would otherwise stack duplicates, leaving staff
     * with two competing proposals for the same booking.
     */
    public function hasPendingMoveRequest(string $reservationId): bool
    {
        $stmt = $this->db->query(
            "SELECT 1 FROM ReservationMoveRequests
              WHERE reservation_id = :reservation_id AND status = 'Pending'
              LIMIT 1",
            [':reservation_id' => $reservationId]
        );
        return (bool) $stmt->fetchColumn();
    }

    public function findMoveRequests(?string $status = null): array
    {
        $sql = "
            SELECT mr.*, 
                   r.customer_id, r.room_id, r.start_time AS original_start_time, r.end_time AS original_end_time,
                   rm.name AS room_name,
                   c.name AS customer_name, c.email AS customer_email
              FROM ReservationMoveRequests mr
              JOIN Reservations r ON r.reservation_id = mr.reservation_id
              JOIN Rooms rm ON rm.room_id = r.room_id
              JOIN Users c ON c.user_id = r.customer_id
        ";
        
        $params = [];
        if ($status !== null) {
            $sql .= " WHERE mr.status = :status";
            $params[':status'] = $status;
        }
        
        $sql .= " ORDER BY mr.created_at ASC";
        
        $stmt = $this->db->query($sql, $params);
        return $stmt->fetchAll();
    }

    public function findMoveRequestById(string $requestId): ?array
    {
        $stmt = $this->db->query(
            "SELECT mr.*, r.room_id, r.customer_id
               FROM ReservationMoveRequests mr
               JOIN Reservations r ON r.reservation_id = mr.reservation_id
              WHERE mr.request_id = :request_id
              LIMIT 1",
            [':request_id' => $requestId]
        );
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function updateMoveRequestStatus(string $requestId, string $status, string $processedBy, ?string $staffComment): ?array
    {
        $this->db->query(
            'UPDATE ReservationMoveRequests
                SET status = :status,
                    processed_by = :processed_by,
                    staff_comment = :staff_comment
              WHERE request_id = :request_id',
            [
                ':status'        => $status,
                ':processed_by'  => $processedBy,
                ':staff_comment' => $staffComment,
                ':request_id'    => $requestId,
            ]
        );
        return $this->findMoveRequestById($requestId);
    }
    
    // ---------------------------------------------------------------
    // Cancellation Requests
    //
    // An Approved booking is not cancelled by its customer directly. They file
    // a request with a reason; approving it is what performs the cancellation.
    // Same shape as the move-request methods above.
    // ---------------------------------------------------------------

    public function createCancelRequest(string $reservationId, string $reason): array
    {
        $requestId = self::uuidv4();
        $this->db->query(
            'INSERT INTO ReservationCancellationRequests (request_id, reservation_id, reason)
             VALUES (:request_id, :reservation_id, :reason)',
            [
                ':request_id'     => $requestId,
                ':reservation_id' => $reservationId,
                ':reason'         => $reason,
            ]
        );

        $stmt = $this->db->query(
            'SELECT * FROM ReservationCancellationRequests WHERE request_id = :request_id LIMIT 1',
            [':request_id' => $requestId]
        );
        return $stmt->fetch() ?: [];
    }

    /** True while this booking has a cancellation request still awaiting staff. */
    public function hasPendingCancelRequest(string $reservationId): bool
    {
        $stmt = $this->db->query(
            "SELECT 1 FROM ReservationCancellationRequests
              WHERE reservation_id = :reservation_id AND status = 'Pending'
              LIMIT 1",
            [':reservation_id' => $reservationId]
        );
        return (bool) $stmt->fetchColumn();
    }

    /** The staff queue's cancellation tab. Oldest first, like findMoveRequests(). */
    public function findCancelRequests(?string $status = null): array
    {
        $sql = "
            SELECT cr.*,
                   r.customer_id, r.room_id, r.purpose,
                   r.start_time, r.end_time, r.status AS reservation_status,
                   rm.name AS room_name,
                   c.name  AS customer_name, c.email AS customer_email,
                   p.name  AS processed_by_name
              FROM ReservationCancellationRequests cr
              JOIN Reservations r ON r.reservation_id = cr.reservation_id
              JOIN Rooms rm ON rm.room_id = r.room_id
              JOIN Users c ON c.user_id = r.customer_id
         LEFT JOIN Users p ON p.user_id = cr.processed_by
        ";

        $params = [];
        if ($status !== null) {
            $sql .= ' WHERE cr.status = :status';
            $params[':status'] = $status;
        }

        $sql .= ' ORDER BY cr.created_at ASC';

        return $this->db->query($sql, $params)->fetchAll();
    }

    public function findCancelRequestById(string $requestId): ?array
    {
        $stmt = $this->db->query(
            'SELECT cr.*, r.room_id, r.customer_id, r.status AS reservation_status
               FROM ReservationCancellationRequests cr
               JOIN Reservations r ON r.reservation_id = cr.reservation_id
              WHERE cr.request_id = :request_id
              LIMIT 1',
            [':request_id' => $requestId]
        );
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function updateCancelRequestStatus(string $requestId, string $status, string $processedBy, ?string $staffComment): ?array
    {
        $this->db->query(
            'UPDATE ReservationCancellationRequests
                SET status = :status,
                    processed_by = :processed_by,
                    staff_comment = :staff_comment
              WHERE request_id = :request_id',
            [
                ':status'        => $status,
                ':processed_by'  => $processedBy,
                ':staff_comment' => $staffComment,
                ':request_id'    => $requestId,
            ]
        );
        return $this->findCancelRequestById($requestId);
    }

    public function updateTimes(string $reservationId, string $startTime, string $endTime): void
    {
        $this->db->query(
            'UPDATE Reservations
                SET start_time = :start_time,
                    end_time = :end_time
              WHERE reservation_id = :reservation_id',
            [
                ':start_time'     => $startTime,
                ':end_time'       => $endTime,
                ':reservation_id' => $reservationId,
            ]
        );
    }
}
