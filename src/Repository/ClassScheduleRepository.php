<?php

declare(strict_types=1);

namespace CampusRoom\Repository;

use CampusRoom\Core\Database;

class ClassScheduleRepository
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /**
     * Random UUIDv4 assigned in PHP so create() can return the new id without
     * re-reading the row. (Database has no lastInsertId(), and it would not
     * help for a UUID key anyway.)
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

    public function findAll(): array
    {
        $stmt = $this->db->query(
            "SELECT cs.*, r.name AS room_name
               FROM ClassSchedules cs
               JOIN Rooms r ON cs.room_id = r.room_id
              ORDER BY cs.day_of_week, cs.start_time"
        );
        return $stmt->fetchAll();
    }

    /**
     * Classes already held in this room on this weekday whose time range
     * shares any minute with [start, end). Half-open, so a class ending at
     * 10:30 does not clash with one starting at 10:30 — the same rule
     * ReservationValidator applies to bookings.
     *
     * @param string $day   'Monday'..'Saturday'
     * @param string $start 'HH:MM:SS'
     * @param string $end   'HH:MM:SS'
     */
    public function findOverlappingClasses(string $roomId, string $day, string $start, string $end): array
    {
        $stmt = $this->db->query(
            "SELECT course_code, section, start_time, end_time
               FROM ClassSchedules
              WHERE room_id = :room_id
                AND day_of_week = :day
                AND :start < end_time
                AND :end   > start_time
           ORDER BY start_time",
            [
                ':room_id' => $roomId,
                ':day'     => $day,
                ':start'   => $start,
                ':end'     => $end,
            ]
        );
        return $stmt->fetchAll();
    }

    /**
     * Pending/Approved reservations that have not ended yet, in this room, on
     * a date that falls on this weekday, whose time-of-day range shares any
     * minute with [start, end). A class repeats every week, so it would run
     * into each of these. Past bookings are ignored: they can't be disturbed.
     * (Reservations never span midnight, so comparing time-of-day is enough.)
     */
    public function findOverlappingReservations(string $roomId, string $day, string $start, string $end): array
    {
        $stmt = $this->db->query(
            "SELECT reservation_id, status, start_time, end_time
               FROM Reservations
              WHERE room_id = :room_id
                AND status IN ('Pending', 'Approved')
                AND end_time > NOW()
                AND DAYNAME(start_time) = :day
                AND TIME(start_time) < :end
                AND TIME(end_time)   > :start
           ORDER BY start_time",
            [
                ':room_id' => $roomId,
                ':day'     => $day,
                ':start'   => $start,
                ':end'     => $end,
            ]
        );
        return $stmt->fetchAll();
    }

    /** @return string the new schedule_id */
    public function create(string $roomId, string $courseCode, string $section, string $dayOfWeek, string $startTime, string $endTime): string
    {
        $scheduleId = self::uuidv4();
        $this->db->query(
            "INSERT INTO ClassSchedules (schedule_id, room_id, course_code, section, day_of_week, start_time, end_time)
             VALUES (:schedule_id, :room_id, :course_code, :section, :day_of_week, :start_time, :end_time)",
            [
                ':schedule_id' => $scheduleId,
                ':room_id'     => $roomId,
                ':course_code' => $courseCode,
                ':section'     => $section,
                ':day_of_week' => $dayOfWeek,
                ':start_time'  => $startTime,
                ':end_time'    => $endTime
            ]
        );
        return $scheduleId;
    }

    public function delete(string $scheduleId): void
    {
        $this->db->query(
            "DELETE FROM ClassSchedules WHERE schedule_id = :schedule_id",
            [':schedule_id' => $scheduleId]
        );
    }
}
