<?php

declare(strict_types=1);

namespace CampusRoom\Controller;

use CampusRoom\Core\Auth;
use CampusRoom\Core\Response;
use CampusRoom\Repository\ClassScheduleRepository;

class ClassScheduleController
{
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

        $roomId = trim($body['room_id'] ?? '');
        $courseCode = trim($body['course_code'] ?? '');
        $section = trim($body['section'] ?? '');
        $dayOfWeek = trim($body['day_of_week'] ?? '');
        $startTime = trim($body['start_time'] ?? '');
        $endTime = trim($body['end_time'] ?? '');

        if (!$roomId || !$courseCode || !$section || !$dayOfWeek || !$startTime || !$endTime) {
            Response::error('All fields are required.', 422);
        }

        $this->repo->create($roomId, $courseCode, $section, $dayOfWeek, $startTime, $endTime);
        Response::json(['success' => true], 201);
    }

    public function destroy(string $id): never
    {
        Auth::requireRole(['Admin']);
        $this->repo->delete($id);
        Response::json(['success' => true]);
    }
}
