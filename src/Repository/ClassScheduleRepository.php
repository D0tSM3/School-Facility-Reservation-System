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

    /**
     * Active class schedules: those for the current or a future semester
     * (semester_end today or later). Expired classes stay in the table for
     * history but are no longer treated as active schedules. A NULL semester_end
     * (legacy row) is treated as always-active.
     */
    public function findAll(): array
    {
        $stmt = $this->db->query(
            "SELECT cs.*, r.name AS room_name
               FROM ClassSchedules cs
               JOIN Rooms r ON cs.room_id = r.room_id
              WHERE COALESCE(cs.semester_end, DATE '9999-12-31') >= CURRENT_DATE
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
    public function findOverlappingClasses(string $roomId, string $day, string $start, string $end, ?string $excludeScheduleId = null): array
    {
        $sql = "SELECT course_code, section, start_time, end_time
                  FROM ClassSchedules
                 WHERE room_id = :room_id
                   AND day_of_week = :day
                   AND :start < end_time
                   AND :end   > start_time
                   AND COALESCE(semester_end, DATE '9999-12-31') >= CURRENT_DATE";
        $params = [
            ':room_id' => $roomId,
            ':day'     => $day,
            ':start'   => $start,
            ':end'     => $end,
        ];
        // When a class is being rescheduled/relocated, it must not count as
        // overlapping its own (about to change) placement.
        if ($excludeScheduleId !== null) {
            $sql .= " AND schedule_id <> :exclude";
            $params[':exclude'] = $excludeScheduleId;
        }
        $sql .= " ORDER BY start_time";
        return $this->db->query($sql, $params)->fetchAll();
    }

    /**
     * Pending/Approved reservations that have not ended yet, in this room, on
     * a date that falls on this weekday, whose time-of-day range shares any
     * minute with [start, end). A class repeats every week, so it would run
     * into each of these. Past bookings are ignored: they can't be disturbed.
     * (Reservations never span midnight, so comparing time-of-day is enough.)
     */
    public function findOverlappingReservations(string $roomId, string $day, string $start, string $end, ?string $semesterStart = null, ?string $semesterEnd = null): array
    {
        // PostgreSQL: trim(to_char(ts,'Day')) gives the weekday name ('Friday')
        // and ::time the time-of-day. (DAYNAME()/TIME() are MySQL-only.)
        // A class only runs during its semester, so only reservations whose DATE
        // falls inside [semester_start, semester_end] can collide with it.
        $stmt = $this->db->query(
            "SELECT reservation_id, status, start_time, end_time
               FROM Reservations
              WHERE room_id = :room_id
                AND status IN ('Pending', 'Approved')
                AND end_time > NOW()
                AND trim(to_char(start_time, 'Day')) = :day
                AND start_time::time < :end
                AND end_time::time   > :start
                AND start_time::date >= COALESCE(:sem_start::date, DATE '0001-01-01')
                AND start_time::date <= COALESCE(:sem_end::date,   DATE '9999-12-31')
           ORDER BY start_time",
            [
                ':room_id'   => $roomId,
                ':day'       => $day,
                ':start'     => $start,
                ':end'       => $end,
                ':sem_start' => $semesterStart,
                ':sem_end'   => $semesterEnd,
            ]
        );
        return $stmt->fetchAll();
    }

    /** @return string the new schedule_id */
    public function create(string $roomId, string $courseCode, string $section, string $dayOfWeek, string $startTime, string $endTime, ?string $semesterStart = null, ?string $semesterEnd = null): string
    {
        $scheduleId = self::uuidv4();
        $this->db->query(
            "INSERT INTO ClassSchedules (schedule_id, room_id, course_code, section, day_of_week, start_time, end_time, semester_start, semester_end)
             VALUES (:schedule_id, :room_id, :course_code, :section, :day_of_week, :start_time, :end_time, :semester_start, :semester_end)",
            [
                ':schedule_id'    => $scheduleId,
                ':room_id'        => $roomId,
                ':course_code'    => $courseCode,
                ':section'        => $section,
                ':day_of_week'    => $dayOfWeek,
                ':start_time'     => $startTime,
                ':end_time'       => $endTime,
                ':semester_start' => $semesterStart,
                ':semester_end'   => $semesterEnd,
            ]
        );
        return $scheduleId;
    }

    /** @return array|null the deleted row, or null if there was none */
    public function delete(string $scheduleId): ?array
    {
        $stmt = $this->db->query(
            "DELETE FROM ClassSchedules WHERE schedule_id = :schedule_id
             RETURNING course_code, section, day_of_week",
            [':schedule_id' => $scheduleId]
        );
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /** One class schedule by id, or null. */
    public function findById(string $scheduleId): ?array
    {
        $stmt = $this->db->query(
            "SELECT schedule_id, room_id, course_code, section, day_of_week, start_time, end_time
               FROM ClassSchedules WHERE schedule_id = :schedule_id LIMIT 1",
            [':schedule_id' => $scheduleId]
        );
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /** Relocate a class to another room, keeping its weekday and time window. */
    public function updateRoom(string $scheduleId, string $newRoomId): void
    {
        $this->db->query(
            "UPDATE ClassSchedules SET room_id = :room_id WHERE schedule_id = :schedule_id",
            [':room_id' => $newRoomId, ':schedule_id' => $scheduleId]
        );
    }

    /** Move a class to a new room and/or weekday/time in one update. */
    public function updatePlacement(string $scheduleId, string $roomId, string $day, string $start, string $end): void
    {
        $this->db->query(
            "UPDATE ClassSchedules
                SET room_id = :room_id, day_of_week = :day, start_time = :start, end_time = :end
              WHERE schedule_id = :schedule_id",
            [
                ':room_id'     => $roomId,
                ':day'         => $day,
                ':start'       => $start,
                ':end'         => $end,
                ':schedule_id' => $scheduleId,
            ]
        );
    }
}
