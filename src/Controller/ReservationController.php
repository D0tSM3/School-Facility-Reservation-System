<?php

declare(strict_types=1);

namespace CampusRoom\Controller;

use CampusRoom\Core\Auth;
use CampusRoom\Core\Response;
use CampusRoom\Core\ReservationValidator;
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
        $purpose   = trim($body['purpose']    ?? '');
        $startTime = trim($body['start_time'] ?? '');
        $endTime   = trim($body['end_time']   ?? '');

        if ($roomId === '' || $purpose === '' || $startTime === '' || $endTime === '') {
            Response::error('room_id, purpose, start_time, and end_time are required.', 422);
        }

        // Basic timestamp sanity
        if (strtotime($startTime) === false || strtotime($endTime) === false) {
            Response::error('start_time and end_time must be valid timestamps.', 422);
        }

        $error = ReservationValidator::check($roomId, $startTime, $endTime);
        if ($error !== null) {
            Response::error($error, 409);
        }

        try {
            $reservation = $this->reservations->create(
                Auth::userId(),
                $roomId,
                $purpose,
                $startTime,
                $endTime
            );
        } catch (PDOException $e) {
            // Fallback in case of race condition caught by the DB trigger
            if ($e->getCode() === '45000') {
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
            if ($e->getCode() === '45000') {
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
    // Customer: PATCH /api/reservations/{id}/cancel
    // ---------------------------------------------------------------

    public function cancel(string $reservationId): never
    {
        Auth::requireRole(['Customer']);

        $existing = $this->reservations->findById($reservationId);
        if ($existing === null) {
            Response::error('Reservation not found.', 404);
        }

        // Only allow cancelling if it belongs to the user and is still Pending
        if ($existing['customer_id'] !== Auth::userId()) {
            Response::error('Forbidden.', 403);
        }

        if ($existing['status'] !== 'Pending') {
            Response::error('Only pending reservations can be cancelled.', 422);
        }

        $reservation = $this->reservations->updateStatus(
            $reservationId,
            'Cancelled',
            Auth::userId()
        );

        $this->reservations->insertLog(
            Auth::userId(),
            "Reservation {$reservationId} cancelled by customer"
        );

        Response::json($reservation);
    }

    // ---------------------------------------------------------------
    // Move Requests
    // ---------------------------------------------------------------

    public function requestMove(string $reservationId): never
    {
        Auth::requireRole(['Customer']);

        $existing = $this->reservations->findById($reservationId);
        if ($existing === null) {
            Response::error('Reservation not found.', 404);
        }

        if ($existing['customer_id'] !== Auth::userId()) {
            Response::error('Forbidden.', 403);
        }

        if (!in_array($existing['status'], ['Pending', 'Approved'])) {
            Response::error('Only pending or approved reservations can be rescheduled.', 422);
        }

        $body = $this->jsonBody();
        $startTime = trim($body['requested_start_time'] ?? '');
        $endTime = trim($body['requested_end_time'] ?? '');

        if ($startTime === '' || $endTime === '') {
            Response::error('requested_start_time and requested_end_time are required.', 422);
        }

        $request = $this->reservations->createMoveRequest($reservationId, $startTime, $endTime);
        
        $this->reservations->insertLog(
            Auth::userId(),
            "Move request submitted for reservation {$reservationId}"
        );

        Response::json($request, 201);
    }

    public function getMoveRequests(): never
    {
        Auth::requireRole(['Staff', 'Admin']);
        $status = $_GET['status'] ?? null;
        $list = $this->reservations->findMoveRequests($status);
        Response::json($list);
    }

    public function resolveMoveRequest(string $requestId): never
    {
        Auth::requireRole(['Staff', 'Admin']);

        $body = $this->jsonBody();
        $status = trim($body['status'] ?? '');
        $staffComment = trim($body['staff_comment'] ?? '');

        if (!in_array($status, ['Approved', 'Rejected'], true)) {
            Response::error('status must be Approved or Rejected', 422);
        }

        $existing = $this->reservations->findMoveRequestById($requestId);
        if ($existing === null) {
            Response::error('Move request not found.', 404);
        }

        if ($existing['status'] !== 'Pending') {
            Response::error('Move request is already resolved.', 422);
        }

        if ($status === 'Approved') {
            // Run validator
            $error = ReservationValidator::check(
                $existing['room_id'],
                $existing['requested_start_time'],
                $existing['requested_end_time'],
                $existing['reservation_id']
            );
            if ($error !== null) {
                Response::error($error, 409);
            }
            
            // Update actual reservation times
            $this->reservations->updateTimes(
                $existing['reservation_id'], 
                $existing['requested_start_time'], 
                $existing['requested_end_time']
            );
        }

        $request = $this->reservations->updateMoveRequestStatus(
            $requestId,
            $status,
            Auth::userId(),
            $staffComment === '' ? null : $staffComment
        );

        $this->reservations->insertLog(
            Auth::userId(),
            "Move request {$requestId} {$status}"
        );

        Response::json($request);
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
