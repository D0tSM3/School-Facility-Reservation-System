<?php

declare(strict_types=1);

namespace CampusRoom\Core;

/**
 * Auth — session helpers and role-based access control.
 */
class Auth
{
    /**
     * Start the session exactly once.
     */
    public static function startSession(): void
    {
        if (session_status() === PHP_SESSION_NONE) {
            session_start();
        }
    }

    /**
     * Persist user identity into the session after a successful login.
     */
    public static function login(string $userId, string $role): void
    {
        self::startSession();
        // Regenerate session ID on privilege change to prevent fixation.
        session_regenerate_id(true);
        $_SESSION['user_id'] = $userId;
        $_SESSION['role']    = $role;
    }

    public static function logout(): void
    {
        self::startSession();
        session_destroy();
    }

    public static function userId(): ?string
    {
        self::startSession();
        return $_SESSION['user_id'] ?? null;
    }

    public static function role(): ?string
    {
        self::startSession();
        return $_SESSION['role'] ?? null;
    }

    /**
     * Require that the current session holds one of the allowed roles.
     * Aborts with HTTP 401 if not authenticated, HTTP 403 if wrong role.
     *
     * @param string[] $roles  e.g. ['Admin', 'Staff']
     */
    public static function requireRole(array $roles): void
    {
        self::startSession();

        if (empty($_SESSION['user_id'])) {
            Response::error('Unauthenticated. Please log in.', 401);
        }

        if (!in_array($_SESSION['role'], $roles, true)) {
            Response::error('Forbidden. Insufficient permissions.', 403);
        }
    }
}
