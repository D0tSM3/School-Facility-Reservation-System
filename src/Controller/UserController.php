<?php

declare(strict_types=1);

namespace CampusRoom\Controller;

use CampusRoom\Core\Auth;
use CampusRoom\Core\Response;
use CampusRoom\Repository\UserRepository;
use CampusRoom\Repository\ReservationRepository;

/**
 * UserController — Admin-only user management endpoints.
 */
class UserController
{
    private UserRepository $users;
    private ReservationRepository $reservations;

    public function __construct()
    {
        $this->users        = new UserRepository();
        $this->reservations = new ReservationRepository();
    }

    // ---------------------------------------------------------------
    // Admin: GET /api/users
    // ---------------------------------------------------------------

    public function index(): never
    {
        Auth::requireRole(['Admin']);

        $users = $this->users->findAll();
        Response::json($users);
    }

    // ---------------------------------------------------------------
    // Admin: PATCH /api/users/{id}/role
    // ---------------------------------------------------------------

    public function updateRole(string $userId): never
    {
        Auth::requireRole(['Admin']);

        $body = $this->jsonBody();
        $role = trim($body['role'] ?? '');

        $allowed = ['Admin', 'Staff', 'Customer'];
        if (!in_array($role, $allowed, true)) {
            Response::error('role must be one of: ' . implode(', ', $allowed), 422);
        }

        $existing = $this->users->findById($userId);
        if ($existing === null) {
            Response::error('User not found.', 404);
        }

        $user = $this->users->updateRole($userId, $role);
        if ($user === null) {
            Response::error('User not found.', 404);
        }

        // Audit log
        $this->reservations->insertLog(
            Auth::userId(),
            "Admin changed role of user {$userId} to {$role}"
        );

        Response::json($user);
    }

    // ---------------------------------------------------------------
    // Admin: GET /api/logs
    // ---------------------------------------------------------------

    public function logs(): never
    {
        Auth::requireRole(['Admin']);

        $logs = $this->reservations->findAllLogs();
        Response::json($logs);
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
