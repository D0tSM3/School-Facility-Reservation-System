<?php

declare(strict_types=1);

namespace CampusRoom\Controller;

use CampusRoom\Core\Auth;
use CampusRoom\Core\Response;
use CampusRoom\Repository\ClassScheduleRepository;
use CampusRoom\Repository\RoomRepository;

class ClassScheduleController
{
    private const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    private ClassScheduleRepository $repo;

    public function __construct()
    {
        $this->repo = new ClassScheduleRepository();
    }

    public function index(): never
    {
        Auth::requireRole(['Admin']);
        $classes = $this->repo->findAll();
        Response::json($classes);
    }

    public function store(): never
    {
        Auth::requireRole(['Admin']);

        $raw  = file_get_contents('php://input');
        $body = json_decode($raw ?: '{}', true);
        if (!is_array($body)) {
            Response::error('Request body must be valid JSON.', 400);
        }

        $roomId     = trim((string) ($body['room_id'] ?? ''));
        $courseCode = trim((string) ($body['course_code'] ?? ''));
        $section    = trim((string) ($body['section'] ?? ''));
        $dayOfWeek  = trim((string) ($body['day_of_week'] ?? ''));
        $startTime  = trim((string) ($body['start_time'] ?? ''));
        $endTime    = trim((string) ($body['end_time'] ?? ''));

        if ($roomId === '' || $courseCode === '' || $section === '' || $dayOfWeek === '' || $startTime === '' || $endTime === '') {
            Response::error('All fields are required.', 422);
        }

        // Column limits: ClassSchedules.course_code is VARCHAR(50), section VARCHAR(20).
        if (mb_strlen($courseCode) > 50 || mb_strlen($section) > 20) {
            Response::error('course_code must be 50 characters or fewer and section 20 or fewer.', 422);
        }

        if (!in_array($dayOfWeek, self::DAYS, true)) {
            Response::error('day_of_week must be one of: ' . implode(', ', self::DAYS) . '.', 422);
        }

        $startTime = self::normaliseTime($startTime);
        $endTime   = self::normaliseTime($endTime);
        if ($startTime === null || $endTime === null) {
            Response::error('start_time and end_time must be valid times (HH:MM).', 422);
        }
        if ($endTime <= $startTime) {   // zero-padded 'HH:MM:SS' strings compare correctly
            Response::error('end_time must be after start_time.', 422);
        }

        if ((new RoomRepository())->findById($roomId) === null) {
            Response::error('Room not found.', 404);
        }

        // 1. Another class in the same room, same weekday, sharing any minute.
        $classes = $this->repo->findOverlappingClasses($roomId, $dayOfWeek, $startTime, $endTime);
        if ($classes) {
            $c = $classes[0];
            Response::error(
                "Scheduling Collision: Overlaps an existing class in this room ({$c['course_code']} - {$c['section']}, "
                . "{$dayOfWeek} " . self::hhmm($c['start_time']) . '-' . self::hhmm($c['end_time']) . ').',
                409
            );
        }

        // 2. Upcoming reservations this weekly class would run into. Nothing is
        //    auto-cancelled: the admin has to move or cancel them first.
        $bookings = $this->repo->findOverlappingReservations($roomId, $dayOfWeek, $startTime, $endTime);
        if ($bookings) {
            $b     = $bookings[0];
            $count = count($bookings);
            Response::error(
                'Scheduling Collision: ' . ($count === 1 ? 'an upcoming reservation already occupies' : "{$count} upcoming reservations already occupy")
                . " this room during that time on {$dayOfWeek}s. The first is {$b['status']}, "
                . substr((string) $b['start_time'], 0, 10) . ' ' . self::hhmm($b['start_time']) . '-' . self::hhmm($b['end_time'])
                . '. Move or cancel it before adding the class.',
                409
            );
        }

        $id = $this->repo->create($roomId, $courseCode, $section, $dayOfWeek, $startTime, $endTime);
        Response::json(['success' => true, 'schedule_id' => $id], 201);
    }

    public function destroy(string $id): never
    {
        Auth::requireRole(['Admin']);
        $this->repo->delete($id);
        Response::json(['success' => true]);
    }

    /** 'H:MM', 'HH:MM' or 'HH:MM:SS' -> 'HH:MM:SS', or null if it is not a real time of day. */
    private static function normaliseTime(string $value): ?string
    {
        if (preg_match('/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/', $value, $m) !== 1) {
            return null;
        }
        [$h, $i, $s] = [(int) $m[1], (int) $m[2], (int) ($m[3] ?? 0)];
        if ($h > 23 || $i > 59 || $s > 59) {
            return null;
        }
        return sprintf('%02d:%02d:%02d', $h, $i, $s);
    }

    /** '2026-09-28 13:30:00' or '13:30:00' -> '13:30'. */
    private static function hhmm(string $value): string
    {
        return substr($value, -8, 5);
    }
}
