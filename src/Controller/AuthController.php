<?php

declare(strict_types=1);

namespace CampusRoom\Controller;

use CampusRoom\Core\Auth;
use CampusRoom\Core\Mailer;
use CampusRoom\Core\Response;
use CampusRoom\Repository\UserRepository;
use PDOException;

/**
 * AuthController — handles email/password auth and OTP verification.
 * Google OAuth has been removed in favour of a native signup/login flow.
 */
class AuthController
{
    private UserRepository $users;

    public function __construct()
    {
        $this->users = new UserRepository();
    }

    // ---------------------------------------------------------------
    // GET /api/auth/me  — return the currently logged-in user
    // ---------------------------------------------------------------

    public function me(): never
    {
        $userId = Auth::userId();
        if (!$userId) {
            Response::error('Unauthenticated.', 401);
        }

        $user = $this->users->findById($userId);
        if ($user === null) {
            Auth::logout();
            Response::error('Unauthenticated.', 401);
        }

        unset($user['password_hash'], $user['otp_code'], $user['otp_expires_at']);
        Response::json($user);
    }

    // ---------------------------------------------------------------
    // POST /api/auth/register
    // ---------------------------------------------------------------

    public function register(): never
    {
        $body = $this->jsonBody();

        $name     = trim($body['name']     ?? '');
        $email    = trim($body['email']    ?? '');
        $password = trim($body['password'] ?? '');

        if ($name === '' || $email === '' || $password === '') {
            Response::error('name, email and password are required.', 422);
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            Response::error('Invalid email format.', 422);
        }
        if (strlen($password) < 8) {
            Response::error('Password must be at least 8 characters.', 422);
        }

        try {
            $hash = password_hash($password, PASSWORD_BCRYPT);
            // Default role is Customer. is_verified doesn't matter anymore, but we set it to 1 just in case.
            $user = $this->users->create($name, $email, $hash, 'Customer');
            $this->users->markVerified($user['user_id']); // Ensure it's 1
        } catch (PDOException $e) {
            if (str_starts_with((string) $e->getCode(), '23')) {
                Response::error('This email is already registered.', 409);
            }
            throw $e;
        }

        Auth::login($user['user_id'], $user['role']);
        unset($user['password_hash'], $user['otp_code'], $user['otp_expires_at']);
        
        Response::json([
            'message' => 'Account created successfully.',
            'user'    => $user,
            'role'    => $user['role'],
            'user_id' => $user['user_id']
        ], 201);
    }

    // ---------------------------------------------------------------
    // POST /api/auth/login
    // ---------------------------------------------------------------

    public function login(): never
    {
        $body = $this->jsonBody();

        $email    = trim($body['email']    ?? '');
        $password = trim($body['password'] ?? '');

        if ($email === '' || $password === '') {
            Response::error('email and password are required.', 422);
        }

        $user = $this->users->findByEmailFull($email);

        if ($user === null || empty($user['password_hash']) || !password_verify($password, $user['password_hash'])) {
            Response::error('Invalid email or password.', 401);
        }

        Auth::login($user['user_id'], $user['role']);

        unset($user['password_hash'], $user['otp_code'], $user['otp_expires_at']);
        Response::json($user);
    }

    // ---------------------------------------------------------------
    // POST /api/auth/verify-otp
    // ---------------------------------------------------------------

    public function verifyOtp(): never
    {
        $body  = $this->jsonBody();
        $email = trim($body['email'] ?? '');
        $code  = trim($body['otp']   ?? '');

        if ($email === '' || $code === '') {
            Response::error('email and otp are required.', 422);
        }

        $user = $this->users->findByEmailFull($email);
        if ($user === null) {
            Response::error('Invalid verification attempt.', 404);
        }

        // Already verified — just log in (user may have submitted twice)
        if ((bool)$user['is_verified'] && empty($user['otp_code'])) {
            Auth::login($user['user_id'], $user['role']);
            unset($user['password_hash'], $user['otp_code'], $user['otp_expires_at']);
            Response::json($user);
        }

        // Validate OTP
        if ($user['otp_code'] === null || $code !== $user['otp_code']) {
            Response::error('Incorrect verification code. Please try again.', 422);
        }

        // Check expiry
        $expiresAt = strtotime($user['otp_expires_at'] ?? '1970-01-01');
        if (time() > $expiresAt) {
            Response::error('This code has expired. Please request a new one.', 422);
        }

        // Mark verified, clear OTP, and log in
        $this->users->markVerified($user['user_id']);

        Auth::login($user['user_id'], $user['role']);

        $fresh = $this->users->findById($user['user_id']);
        unset($fresh['password_hash'], $fresh['otp_code'], $fresh['otp_expires_at']);
        Response::json($fresh);
    }

    // ---------------------------------------------------------------
    // POST /api/auth/resend-otp
    // ---------------------------------------------------------------

    public function resendOtp(): never
    {
        $body  = $this->jsonBody();
        $email = trim($body['email'] ?? '');

        if ($email === '') {
            Response::error('email is required.', 422);
        }

        $user = $this->users->findByEmailFull($email);
        if ($user === null) {
            // Don't reveal whether the email exists
            Response::json(['message' => 'If this email is registered, a new code has been sent.']);
        }

        if ((bool)$user['is_verified']) {
            Response::error('This account is already verified.', 409);
        }

        $otp  = $this->issueOtp($user['user_id']);
        $sent = Mailer::sendOtp($email, $user['name'], $otp);

        $payload = ['message' => 'A new verification code has been sent to your email.'];
        if (!$sent || empty($_ENV['SMTP_HOST'] ?? '') || empty($_ENV['SMTP_USER'] ?? '')) {
            $payload['dev_otp']  = $otp;
            $payload['dev_note'] = 'SMTP not configured — OTP returned for development use only.';
        }
        Response::json($payload);
    }

    // ---------------------------------------------------------------
    // POST /api/auth/logout
    // ---------------------------------------------------------------

    public function logout(): never
    {
        Auth::logout();
        Response::json(['message' => 'Logged out successfully.']);
    }

    // ---------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------

    /**
     * Generate a fresh 6-digit OTP, persist it (valid for 10 minutes), and return it.
     */
    private function issueOtp(string $userId): string
    {
        $otp       = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $expiresAt = date('Y-m-d H:i:s', time() + 600); // 10 minutes
        $this->users->saveOtp($userId, $otp, $expiresAt);
        return $otp;
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
