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
    // Staff/Admin: GET /api/logs
    //   ?reservation_id= &user_id= &from=YYYY-MM-DD &to=YYYY-MM-DD &q=
    //   ?limit= (1..500, default 100) &offset= (>= 0)
    // Returns { items, total, limit, offset }.
    // ---------------------------------------------------------------

    public function logs(): never
    {
        // Staff export the audit dispatch log from the approval queue.
        Auth::requireRole(['Staff', 'Admin']);

        $limit  = isset($_GET['limit'])  && ctype_digit((string) $_GET['limit'])  ? (int) $_GET['limit']  : 100;
        $offset = isset($_GET['offset']) && ctype_digit((string) $_GET['offset']) ? (int) $_GET['offset'] : 0;
        $limit  = max(1, min(500, $limit));

        $filters = [];

        foreach (['reservation_id', 'user_id'] as $key) {
            $value = self::queryString($key);
            if ($value !== '') {
                $filters[$key] = $value;
            }
        }

        $q = self::queryString('q');
        if (mb_strlen($q) > 100) {
            Response::error('q must be 100 characters or fewer.', 422);
        }
        if ($q !== '') {
            $filters['q'] = $q;
        }

        foreach (['from', 'to'] as $key) {
            $value = self::queryString($key);
            if ($value === '') {
                continue;
            }
            if (!self::isValidDate($value)) {
                Response::error("{$key} must be a date in YYYY-MM-DD format.", 422);
            }
            $filters[$key] = $value;
        }

        // Both are validated Y-m-d strings, so a string compare is a date compare.
        if (isset($filters['from'], $filters['to']) && $filters['from'] > $filters['to']) {
            Response::error('from must not be after to.', 422);
        }

        Response::json([
            'items'  => $this->reservations->findLogs($filters, $limit, $offset),
            'total'  => $this->reservations->countLogs($filters),
            'limit'  => $limit,
            'offset' => $offset,
        ]);
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    /** A query-string value as a trimmed string; '' if absent or not a plain string (e.g. ?q[]=x). */
    private static function queryString(string $key): string
    {
        $value = $_GET[$key] ?? '';
        return is_string($value) ? trim($value) : '';
    }

    private static function isValidDate(string $value): bool
    {
        return preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) === 1
            && checkdate((int) substr($value, 5, 2), (int) substr($value, 8, 2), (int) substr($value, 0, 4));
    }

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
