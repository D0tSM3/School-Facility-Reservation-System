<?php

declare(strict_types=1);

namespace CampusRoom\Controller;

use CampusRoom\Core\Auth;
use CampusRoom\Core\Response;
use CampusRoom\Repository\ReservationRepository;
use PDOException;

/**
 * ReservationController — Customer, Staff, and Admin reservation endpoints.
 */
class ReservationController
{
    private ReservationRepository $reservations;

    public function __construct()
    {
        $this->reservations = new ReservationRepository();
    }

    // ---------------------------------------------------------------
    // Customer: GET /api/reservations/mine
    // ---------------------------------------------------------------

    public function mine(): never
    {
        Auth::requireRole(['Customer']);

        $list = $this->reservations->findByCustomer(Auth::userId());
        Response::json($list);
    }

    // ---------------------------------------------------------------
    // Staff: GET /api/reservations[?status=Pending]
    // ---------------------------------------------------------------

    public function index(): never
    {
        Auth::requireRole(['Staff', 'Admin']);

        $status = $_GET['status'] ?? null;

        // Whitelist allowed status values to avoid feeding arbitrary strings
        // into the query even though they are parameterised.
        $allowed = ['Pending', 'Approved', 'Rejected', 'Completed'];
        if ($status !== null && !in_array($status, $allowed, true)) {
            Response::error('status must be one of: ' . implode(', ', $allowed), 422);
        }

        $list = $this->reservations->findAll($status);
        Response::json($list);
    }

    // ---------------------------------------------------------------
    // Customer: POST /api/reservations
    // ---------------------------------------------------------------

    public function store(): never
    {
        Auth::requireRole(['Customer']);

        $body = $this->jsonBody();

        $roomId    = trim($body['room_id']    ?? '');
        $startTime = trim($body['start_time'] ?? '');
        $endTime   = trim($body['end_time']   ?? '');

        if ($roomId === '' || $startTime === '' || $endTime === '') {
            Response::error('room_id, start_time, and end_time are required.', 422);
        }

        // Basic timestamp sanity — Postgres will enforce the constraint too.
        if (strtotime($startTime) === false || strtotime($endTime) === false) {
            Response::error('start_time and end_time must be valid timestamps.', 422);
        }
        if (strtotime($startTime) >= strtotime($endTime)) {
            Response::error('end_time must be after start_time.', 422);
        }

        try {
            $reservation = $this->reservations->create(
                Auth::userId(),
                $roomId,
                $startTime,
                $endTime
            );
        } catch (PDOException $e) {
            // SQLSTATE P0001 = PL/pgSQL RAISE EXCEPTION (our trigger)
            if ($e->getCode() === 'P0001') {
                Response::error(
                    'Scheduling Collision: Room is already booked or pending during this time window.',
                    409
                );
            }
            throw $e;
        }

        Response::json($reservation, 201);
    }

    // ---------------------------------------------------------------
    // Staff: PATCH /api/reservations/{id}
    // ---------------------------------------------------------------

    public function update(string $reservationId): never
    {
        Auth::requireRole(['Staff', 'Admin']);

        $body   = $this->jsonBody();
        $status = trim($body['status'] ?? '');

        $allowed = ['Approved', 'Rejected', 'Completed'];
        if (!in_array($status, $allowed, true)) {
            Response::error('status must be one of: ' . implode(', ', $allowed), 422);
        }

        $existing = $this->reservations->findById($reservationId);
        if ($existing === null) {
            Response::error('Reservation not found.', 404);
        }

        try {
            $reservation = $this->reservations->updateStatus(
                $reservationId,
                $status,
                Auth::userId()
            );
        } catch (PDOException $e) {
            if ($e->getCode() === 'P0001') {
                Response::error(
                    'Scheduling Collision: Room is already booked or pending during this time window.',
                    409
                );
            }
            throw $e;
        }

        if ($reservation === null) {
            Response::error('Reservation not found.', 404);
        }

        // Audit log for every status change.
        $this->reservations->insertLog(
            Auth::userId(),
            "Reservation {$reservationId} status changed to {$status}"
        );

        Response::json($reservation);
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
