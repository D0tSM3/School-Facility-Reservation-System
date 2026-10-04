<?php

declare(strict_types=1);

namespace CampusRoom\Core;

use PDO;
use CampusRoom\Core\Database;

/**
 * ReservationValidator — Centralized booking validation rules.
 */
class ReservationValidator
{
    /** Longest multi-day range one request may cover, in calendar days. */
    public const MAX_RANGE_DAYS = 31;

    /**
     * Checks if a reservation time window is valid based on BPU rules.
     * Returns a string reason if invalid, or null if valid.
     *
     * One Reservations row always covers a single day: a multi-day booking is
     * stored as one row per day (see checkRange()), so a row whose start and
     * end fall on different dates is still rejected here. That keeps approvals
     * and move requests from turning a daily window into an overnight block.
     *
     * @param string $roomId
     * @param string $startTime DATETIME string
     * @param string $endTime DATETIME string
     * @param string|null $excludeReservationId Optional reservation ID to exclude from overlap checks (for moves)
     * @return string|null
     */
    public static function check(string $roomId, string $startTime, string $endTime, ?string $excludeReservationId = null): ?string
    {
        $pdo = Database::getInstance()->getPdo();

        $roomError = self::roomProblem($pdo, $roomId);
        if ($roomError !== null) {
            return $roomError;
        }

        $start = strtotime($startTime);
        $end = strtotime($endTime);

        if ($start === false || $end === false || $start >= $end) {
            return "Invalid time range.";
        }

        // Reject reservations whose start time is in the past or exactly now.
        // This guards against frontend bypass (direct API calls with past times).
        if ($start <= time()) {
            return "Reservations must start in the future.";
        }

        if (date('Y-m-d', $start) !== date('Y-m-d', $end)) {
            return "A single reservation must start and end on the same day.";
        }

        return self::dayProblem($pdo, $roomId, $start, $end, $excludeReservationId === null ? [] : [$excludeReservationId]);
    }

    /**
     * Validate a multi-day booking: the same daily window ($dailyStart to
     * $dailyEnd, 'H:i:s') on every date from $startDate to $endDate
     * ('Y-m-d', inclusive). Every day is checked for closed days, holidays,
     * business hours, class schedules and existing Pending/Approved
     * reservations. The error names the first date that fails.
     *
     * @param string[] $excludeReservationIds rows to ignore in the overlap
     *        check (a series being approved must not collide with itself)
     * @param string[] $blockingStatuses reservation statuses that count as a
     *        clash; ['Pending'] asks "would this pass if Approved bookings
     *        were moved out of the way?" (conflict override eligibility)
     */
    public static function checkRange(
        string $roomId,
        string $startDate,
        string $endDate,
        string $dailyStart,
        string $dailyEnd,
        array $excludeReservationIds = [],
        array $blockingStatuses = ['Pending', 'Approved'],
        ?array $activeDates = null
    ): ?string {
        $pdo = Database::getInstance()->getPdo();

        $roomError = self::roomProblem($pdo, $roomId);
        if ($roomError !== null) {
            return $roomError;
        }

        
        
        $days = self::datesBetween($startDate, $endDate);
        if ($activeDates !== null && count($activeDates) > 0) {
            $days = array_values(array_intersect($days, $activeDates));
        }
        if ($activeDates !== null && count($activeDates) > 0) {
            $days = array_values(array_intersect($days, $activeDates));
        }

        if ($activeDates !== null && count($activeDates) > 0) {
            $days = array_values(array_intersect($days, $activeDates));
        }

        if ($days === null) {
            return "The end date must be on or after the start date.";
        }
        if (count($days) > self::MAX_RANGE_DAYS) {
            return "A booking can cover at most " . self::MAX_RANGE_DAYS . " days.";
        }

        foreach ($days as $day) {
            $start = strtotime("$day $dailyStart");
            $end   = strtotime("$day $dailyEnd");
            if ($start === false || $end === false || $start >= $end) {
                return "Invalid time range.";
            }

            $error = self::dayProblem($pdo, $roomId, $start, $end, $excludeReservationIds, $blockingStatuses);
            if ($error !== null) {
                return date('D, M j', $start) . ": " . $error;
            }
        }

        return null;
    }

    /**
     * The first Approved reservation in this room that overlaps the daily
     * window on any date of the range, or null. Returns reservation_id,
     * customer_id, start_time and end_time.
     */
    public static function findApprovedConflict(
        string $roomId,
        string $startDate,
        string $endDate,
        string $dailyStart,
        string $dailyEnd,
        ?array $activeDates = null
    ): ?array {
        $pdo  = Database::getInstance()->getPdo();
        $stmt = $pdo->prepare("
            SELECT reservation_id, customer_id, start_time, end_time
              FROM Reservations
             WHERE room_id = ?
               AND status = 'Approved'
               AND start_time < ?
               AND end_time > ?
             ORDER BY start_time
             LIMIT 1
        ");

        foreach (self::datesBetween($startDate, $endDate) ?? [] as $day) {
            $stmt->execute([$roomId, "$day $dailyEnd", "$day $dailyStart"]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($row !== false) {
                return $row;
            }
        }
        return null;
    }

    /**
     * Every 'Y-m-d' from $startDate to $endDate inclusive, or null if the
     * range is backwards or either date is malformed.
     *
     * @return string[]|null
     */
    public static function datesBetween(string $startDate, string $endDate): ?array
    {
        $from = \DateTimeImmutable::createFromFormat('!Y-m-d', $startDate);
        $to   = \DateTimeImmutable::createFromFormat('!Y-m-d', $endDate);
        if ($from === false || $to === false || $to < $from) {
            return null;
        }

        $days = [];
        // Stop one past the cap so the caller can report "too long" without
        // this loop walking a years-long range day by day.
        for ($d = $from; $d <= $to && count($days) <= self::MAX_RANGE_DAYS; $d = $d->modify('+1 day')) {
            $days[] = $d->format('Y-m-d');
        }
        return $days;
    }

    /** Room-level reasons a booking can't happen at all, whatever the dates. */
    private static function roomProblem(PDO $pdo, string $roomId): ?string
    {
        // 0. Room availability check — a room flagged Maintenance or
        // deactivated should never be bookable, no matter how clean the
        // requested time window is. This used to be missing entirely, so
        // ReservationValidator::check() would happily approve a booking
        // for a room nobody can actually use.
        $stmtRoom = $pdo->prepare('SELECT status, is_active::int AS is_active FROM Rooms WHERE room_id = ?');
        $stmtRoom->execute([$roomId]);
        $room = $stmtRoom->fetch(PDO::FETCH_ASSOC);

        if ($room === false) {
            return "The selected room does not exist.";
        }
        if ((int) $room['is_active'] === 0) {
            return "This room is no longer in service.";
        }
        if ($room['status'] === 'Maintenance') {
            return "This room is currently under maintenance and cannot be booked.";
        }

        return null;
    }

    /**
     * The per-day rules for one window [$start, $end) that lies within a
     * single date (timestamps).
     *
     * @param string[] $excludeReservationIds
     * @param string[] $blockingStatuses
     */
    private static function dayProblem(
        PDO $pdo,
        string $roomId,
        int $start,
        int $end,
        array $excludeReservationIds,
        array $blockingStatuses = ['Pending', 'Approved']
    ): ?string {
        $startDate = date('Y-m-d', $start);

        // 2. Closed Day Check (System Configuration)
        $dayOfWeek = date('l', $start);
        if (in_array($dayOfWeek, Settings::closedDays(), true)) {
            return "BPU is closed on {$dayOfWeek}s.";
        }

        // 3. Business Hours Check (System Configuration)
        $opens  = Settings::businessHoursStart();
        $closes = Settings::businessHoursEnd();
        $startOfDay = strtotime("{$startDate} {$opens}:00");
        $endOfDay   = strtotime("{$startDate} {$closes}:00");

        if ($start < $startOfDay || $end > $endOfDay) {
            return "Reservations must be within business hours ({$opens} - {$closes}).";
        }

        // 4. Holiday Check
        $stmt = $pdo->prepare("SELECT name FROM Holidays WHERE holiday_date = ?");
        $stmt->execute([$startDate]);
        $holiday = $stmt->fetchColumn();

        if ($holiday) {
            return "The requested date falls on a holiday: {$holiday}.";
        }

        // 5. Class Schedule Overlap Check
        // Extract time parts for comparison against TIME columns
        $timeStart = date('H:i:s', $start);
        $timeEnd = date('H:i:s', $end);

        $stmtClass = $pdo->prepare("
            SELECT course_code, section 
            FROM ClassSchedules 
            WHERE room_id = ? 
              AND day_of_week::text = ?
              AND (
                (? >= start_time AND ? < end_time) OR
                (? > start_time AND ? <= end_time) OR
                (? <= start_time AND ? >= end_time)
              )
            LIMIT 1
        ");
        $stmtClass->execute([
            $roomId, $dayOfWeek,
            $timeStart, $timeStart,
            $timeEnd, $timeEnd,
            $timeStart, $timeEnd
        ]);
        $class = $stmtClass->fetch(PDO::FETCH_ASSOC);

        if ($class) {
            return "Scheduling Collision: Overlaps with an official class schedule ({$class['course_code']} - {$class['section']}).";
        }

        // 6. Existing Reservation Overlap Check
        if ($blockingStatuses === []) {
            return null;
        }
        $statusPlaceholders = implode(', ', array_fill(0, count($blockingStatuses), '?'));
        $sql = "
            SELECT 1
            FROM Reservations
            WHERE room_id = ?
              AND status IN ({$statusPlaceholders})
              AND (
                (? >= start_time AND ? < end_time) OR
                (? > start_time AND ? <= end_time) OR
                (? <= start_time AND ? >= end_time)
              )
        ";

        // Canonical strings built from the timestamps parsed above, so this
        // query never depends on which shape the caller happened to pass in.
        $startSql = date('Y-m-d H:i:s', $start);
        $endSql   = date('Y-m-d H:i:s', $end);

        $params = [
            $roomId,
            ...array_values($blockingStatuses),
            $startSql, $startSql,
            $endSql, $endSql,
            $startSql, $endSql
        ];

        foreach ($excludeReservationIds as $excludeId) {
            $sql .= " AND reservation_id != ?";
            $params[] = $excludeId;
        }

        $sql .= " LIMIT 1";

        $stmtRes = $pdo->prepare($sql);
        $stmtRes->execute($params);
        $hasOverlap = $stmtRes->fetchColumn();

        if ($hasOverlap) {
            return "Scheduling Collision: Room is already booked or pending during this time window.";
        }

        return null; // Valid!
    }
}
