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
    /**
     * Checks if a reservation time window is valid based on BPU rules.
     * Returns a string reason if invalid, or null if valid.
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

        // 0. Room availability check — a room flagged Maintenance or
        // deactivated should never be bookable, no matter how clean the
        // requested time window is. This used to be missing entirely, so
        // ReservationValidator::check() would happily approve a booking
        // for a room nobody can actually use.
        $stmtRoom = $pdo->prepare('SELECT status, is_active FROM Rooms WHERE room_id = ?');
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

        $start = strtotime($startTime);
        $end = strtotime($endTime);

        if ($start === false || $end === false || $start >= $end) {
            return "Invalid time range.";
        }

        $startDate = date('Y-m-d', $start);
        $endDate = date('Y-m-d', $end);

        // 1. Same Day Check
        if ($startDate !== $endDate) {
            return "Reservations cannot span multiple calendar days.";
        }

        // 2. Sunday Check
        $dayOfWeek = date('l', $start);
        if ($dayOfWeek === 'Sunday') {
            return "BPU is closed on Sundays.";
        }

        // 3. Business Hours Check (07:30 - 21:00)
        $startOfDay = strtotime($startDate . ' 07:30:00');
        $endOfDay = strtotime($startDate . ' 21:00:00');

        if ($start < $startOfDay || $end > $endOfDay) {
            return "Reservations must be within business hours (07:30 - 21:00).";
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
              AND day_of_week = ?
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
        $sql = "
            SELECT 1 
            FROM Reservations 
            WHERE room_id = ? 
              AND status IN ('Pending', 'Approved')
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
            $startSql, $startSql,
            $endSql, $endSql,
            $startSql, $endSql
        ];

        if ($excludeReservationId !== null) {
            $sql .= " AND reservation_id != ?";
            $params[] = $excludeReservationId;
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
