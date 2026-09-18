<?php

declare(strict_types=1);

namespace CampusRoom\Controller;

use CampusRoom\Core\Auth;
use CampusRoom\Core\Response;
use CampusRoom\Repository\HolidayRepository;

class HolidayController
{
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

        $date = trim($body['holiday_date'] ?? '');
        $name = trim($body['name'] ?? '');
        $type = trim($body['type'] ?? '');

        if (!$date || !$name || !$type) {
            Response::error('holiday_date, name, and type are required.', 422);
        }

        $this->repo->create($date, $name, $type);
        Response::json(['success' => true], 201);
    }

    public function destroy(string $date): never
    {
        Auth::requireRole(['Admin']);
        $this->repo->delete($date);
        Response::json(['success' => true]);
    }
}
