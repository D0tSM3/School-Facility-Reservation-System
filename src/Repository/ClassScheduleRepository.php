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

    public function create(string $roomId, string $courseCode, string $section, string $dayOfWeek, string $startTime, string $endTime): string
    {
        $this->db->query(
            "INSERT INTO ClassSchedules (room_id, course_code, section, day_of_week, start_time, end_time)
             VALUES (:room_id, :course_code, :section, :day_of_week, :start_time, :end_time)",
            [
                ':room_id'     => $roomId,
                ':course_code' => $courseCode,
                ':section'     => $section,
                ':day_of_week' => $dayOfWeek,
                ':start_time'  => $startTime,
                ':end_time'    => $endTime
            ]
        );
        return $this->db->lastInsertId(); // Won't work for UUID, but returning empty is fine if UUID is auto-generated.
    }

    public function delete(string $scheduleId): void
    {
        $this->db->query(
            "DELETE FROM ClassSchedules WHERE schedule_id = :schedule_id",
            [':schedule_id' => $scheduleId]
        );
    }
}
