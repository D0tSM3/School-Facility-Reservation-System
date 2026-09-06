<?php

declare(strict_types=1);

namespace CampusRoom\Controller;

use CampusRoom\Core\Auth;
use CampusRoom\Core\Response;
use CampusRoom\Repository\UserRepository;
use PDOException;

/**
 * AuthController — handles register and login.
 */
class AuthController
{
    private UserRepository $users;

    public function __construct()
    {
        $this->users = new UserRepository();
    }

    /**
     * POST /api/auth/register
     *
     * Body: { "email": "...", "password": "..." }
     * New accounts are always Customer role.
     */
    public function register(): never
    {
        $body = $this->jsonBody();

        $email    = trim($body['email']    ?? '');
        $password = trim($body['password'] ?? '');

        if ($email === '' || $password === '') {
            Response::error('email and password are required.', 422);
        }

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            Response::error('Invalid email format.', 422);
        }

        if (strlen($password) < 8) {
            Response::error('Password must be at least 8 characters.', 422);
        }

        try {
            $hash = password_hash($password, PASSWORD_BCRYPT);
            $user = $this->users->create($email, $hash, 'Customer');
        } catch (PDOException $e) {
            // Unique-violation on email column: SQLSTATE 23505
            if (str_starts_with((string) $e->getCode(), '23')) {
                Response::error('Email already registered.', 409);
            }
            throw $e;
        }

        Response::json($user, 201);
    }

    /**
     * POST /api/auth/login
     *
     * Body: { "email": "...", "password": "..." }
     */
    public function login(): never
    {
        $body = $this->jsonBody();

        $email    = trim($body['email']    ?? '');
        $password = trim($body['password'] ?? '');

        if ($email === '' || $password === '') {
            Response::error('email and password are required.', 422);
        }

        $user = $this->users->findByEmail($email);

        if ($user === null || !password_verify($password, $user['password_hash'])) {
            Response::error('Invalid credentials.', 401);
        }

        Auth::login($user['user_id'], $user['role']);

        // Never send password_hash back to the client.
        unset($user['password_hash']);
        Response::json($user);
    }

    /**
     * POST /api/auth/logout
     */
    public function logout(): never
    {
        Auth::logout();
        Response::json(['message' => 'Logged out successfully.']);
    }

    // ---------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------

    /** Decode the request body as JSON; abort 400 on parse error. */
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
