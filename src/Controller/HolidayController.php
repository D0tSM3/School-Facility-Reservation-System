<?php

declare(strict_types=1);

namespace CampusRoom\Controller;

use CampusRoom\Core\Auth;
use CampusRoom\Core\DateTimeHelper;
use CampusRoom\Core\Response;
use CampusRoom\Repository\HolidayRepository;
use CampusRoom\Repository\ReservationRepository;

class HolidayController
{
    /** The holiday_type enum, verbatim. */
    private const TYPES = ['Regular', 'Special Non-Working'];

    private HolidayRepository $repo;

    public function __construct()
    {
        $this->repo = new HolidayRepository();
    }

    public function index(): never
    {
        Auth::requireRole(['Admin']);
        $holidays = $this->repo->findAll();
        Response::json($holidays);
    }

    public function store(): never
    {
        Auth::requireRole(['Admin']);

        $raw  = file_get_contents('php://input');
        $body = json_decode($raw ?: '{}', true);

        if (!is_array($body)) {
            Response::error('Request body must be valid JSON.', 400);
        }

        $date = trim((string) ($body['holiday_date'] ?? ''));
        $name = trim((string) ($body['name'] ?? ''));
        $type = trim((string) ($body['type'] ?? ''));

        if (!$date || !$name || !$type) {
            Response::error('holiday_date, name, and type are required.', 422);
        }

        // Checked here rather than left to the database, which would answer a
        // bad date, an unknown type or a second holiday on one date with a 500.
        if (DateTimeHelper::toMysqlDate($date) === null) {
            Response::error('holiday_date must be a real date (YYYY-MM-DD).', 422);
        }
        if (!in_array($type, self::TYPES, true)) {
            Response::error('type must be one of: ' . implode(', ', self::TYPES) . '.', 422);
        }
        if (mb_strlen($name) > 100) {
            Response::error('name must be 100 characters or fewer.', 422);
        }
        if ($this->repo->findByDate($date) !== null) {
            Response::error("There is already a holiday on {$date}.", 409);
        }

        $this->repo->create($date, $name, $type);
        (new ReservationRepository())->insertLog(Auth::userId(), "Admin added holiday {$name} ({$date})");
        Response::json(['success' => true], 201);
    }

    public function destroy(string $date): never
    {
        Auth::requireRole(['Admin']);

        if (DateTimeHelper::toMysqlDate($date) === null) {
            Response::error('Invalid date. Use YYYY-MM-DD.', 422);
        }
        $holiday = $this->repo->findByDate($date);
        if ($holiday === null) {
            Response::error('Holiday not found.', 404);
        }

        $this->repo->delete($date);
        (new ReservationRepository())->insertLog(Auth::userId(), "Admin removed holiday {$holiday['name']} ({$date})");
        Response::json(['success' => true]);
    }
}
