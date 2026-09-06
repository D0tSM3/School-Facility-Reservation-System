<?php

declare(strict_types=1);

namespace CampusRoom\Controller;

use CampusRoom\Core\Auth;
use CampusRoom\Core\Response;
use CampusRoom\Repository\RoomRepository;
use CampusRoom\Repository\ReservationRepository;

/**
 * RoomController — Customer and Admin room endpoints.
 */
class RoomController
{
    private RoomRepository $rooms;
    private ReservationRepository $reservations;

    public function __construct()
    {
        $this->rooms        = new RoomRepository();
        $this->reservations = new ReservationRepository();
    }

    // ---------------------------------------------------------------
    // Customer: GET /api/rooms
    // ---------------------------------------------------------------

    public function index(): never
    {
        Auth::requireRole(['Customer', 'Staff', 'Admin']);

        $rooms = $this->rooms->findAllActive();
        Response::json($rooms);
    }

    // ---------------------------------------------------------------
    // Admin: POST /api/rooms
    // ---------------------------------------------------------------

    public function store(): never
    {
        Auth::requireRole(['Admin']);

        $body = $this->jsonBody();

        $name     = trim($body['name']     ?? '');
        $capacity = $body['capacity']       ?? null;
        $status   = trim($body['status']   ?? 'Available');

        if ($name === '') {
            Response::error('name is required.', 422);
        }
        if (!is_numeric($capacity) || (int) $capacity <= 0) {
            Response::error('capacity must be a positive integer.', 422);
        }
        if (!in_array($status, ['Available', 'Maintenance'], true)) {
            Response::error('status must be Available or Maintenance.', 422);
        }

        $room = $this->rooms->create($name, (int) $capacity, $status);

        // Audit log
        $this->reservations->insertLog(
            Auth::userId(),
            "Admin created room '{$room['name']}' (ID: {$room['room_id']})"
        );

        Response::json($room, 201);
    }

    // ---------------------------------------------------------------
    // Admin: PATCH /api/rooms/{id}
    // ---------------------------------------------------------------

    public function update(string $roomId): never
    {
        Auth::requireRole(['Admin']);

        $body = $this->jsonBody();

        $status   = isset($body['status'])    ? trim($body['status'])   : null;
        $isActive = isset($body['is_active'])  ? (bool) $body['is_active'] : null;

        if ($status !== null && !in_array($status, ['Available', 'Maintenance'], true)) {
            Response::error('status must be Available or Maintenance.', 422);
        }

        if (!$this->rooms->findById($roomId)) {
            Response::error('Room not found.', 404);
        }

        $room = $this->rooms->update($roomId, $status, $isActive);
        if ($room === null) {
            Response::error('Room not found.', 404);
        }

        // Audit log
        $changes = http_build_query(array_filter([
            'status'    => $status,
            'is_active' => $isActive !== null ? ($isActive ? 'true' : 'false') : null,
        ]));
        $this->reservations->insertLog(
            Auth::userId(),
            "Admin updated room ID {$roomId}: {$changes}"
        );

        Response::json($room);
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    private function jsonBody(): array
    {
        $raw  = file_get_contents('php://input');
        $body = json_decode($raw ?: '{}', true);
        if (!is_array($body)) {
            Response::error('Request body must be valid JSON.', 400);
        }
        return $body;
    }
}
