<?php

declare(strict_types=1);

namespace CampusRoom\Controller;

use CampusRoom\Core\Auth;
use CampusRoom\Core\Mailer;
use CampusRoom\Core\RateLimiter;
use CampusRoom\Core\Recaptcha;
use CampusRoom\Core\Response;
use CampusRoom\Repository\ReservationRepository;
use CampusRoom\Repository\UserRepository;
use PDOException;

/**
 * AuthController — handles email/password auth and OTP verification.
 * Google OAuth has been removed in favour of a native signup/login flow.
 *
 * The three unauthenticated routes here — register, login and resend-otp —
 * are the system's only doors that open without a session, so each one runs a
 * reCAPTCHA check first. Everything else in the application sits behind
 * Auth::requireRole(), where the session is the gate.
 */
class AuthController
{
    private UserRepository $users;

    public function __construct()
    {
        $this->users = new UserRepository();
    }

    /** Start the session and record the login in the audit log. */
    private function startSession(array $user): void
    {
        Auth::login($user['user_id'], $user['role']);
        (new ReservationRepository())->insertLog($user['user_id'], "{$user['role']} logged in");
    }

    /**
     * Run the bot check, or end the request with 400.
     *
     * 400 rather than 422 on purpose: 422 means "your fields are wrong" here
     * and the client maps it to field-level messages. A failed bot check is
     * not a field error.
     *
     * $failOpen applies ONLY to Google being unreachable, never to a rejected
     * token. See Recaptcha::check().
     */
    private function requireHuman(array $body, bool $failOpen = false): void
    {
        $error = Recaptcha::check(
            $body['recaptcha_token'] ?? null,
            $_SERVER['REMOTE_ADDR'] ?? null,
            $failOpen
        );
        if ($error !== null) {
            Response::error($error, 400);
        }
    }

    // ---------------------------------------------------------------
    // GET /api/config — public bootstrap values for the login screen
    //
    // Exists so the site key has exactly one home (.env). index.html is static
    // and cannot render it server-side, and hardcoding it in the markup would
    // mean two places to change it. Only ever returns PUBLIC values.
    // ---------------------------------------------------------------

    public function config(): never
    {
        Response::json([
            'recaptcha_enabled'  => Recaptcha::enabled(),
            'recaptcha_site_key' => Recaptcha::enabled() ? Recaptcha::siteKey() : '',
        ]);
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

        // Before any validation, hashing or database work — the point is to
        // turn a bot away cheaply. Fails CLOSED: creating accounts is costly
        // enough that a Google outage is the better thing to lose.
        $this->requireHuman($body);

        $name     = trim((string) ($body['name']     ?? ''));
        $email    = strtolower(trim((string) ($body['email'] ?? '')));
        $password = (string) ($body['password'] ?? '');

        if ($name === '' || $email === '' || $password === '') {
            Response::error('name, email and password are required.', 422);
        }
        if (mb_strlen($name) > 150) {
            Response::error('Name must be 150 characters or fewer.', 422);
        }
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 255) {
            Response::error('Please enter a valid email address.', 422);
        }

        // Optional institutional-domain lock. Set ALLOWED_EMAIL_DOMAIN=bpu.edu.ph
        // in .env to restrict signup; leave it blank to allow any address.
        $domain = strtolower(trim($_ENV['ALLOWED_EMAIL_DOMAIN'] ?? ''));
        if ($domain !== '' && !str_ends_with($email, '@' . ltrim($domain, '@'))) {
            Response::error('Please register with your @' . ltrim($domain, '@') . ' email address.', 422);
        }

        if (strlen($password) < 8 || strlen($password) > 72) {
            Response::error('Password must be between 8 and 72 characters.', 422);
        }
        if (!preg_match('/[A-Z]/', $password) || !preg_match('/[a-z]/', $password) || !preg_match('/[0-9]/', $password) || !preg_match('/[^A-Za-z0-9]/', $password)) {
            Response::error('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character.', 422);
        }

        if ($this->users->findByEmail($email) !== null) {
            Response::error('An account with this email already exists.', 409);
        }

        try {
            // Role is fixed: the request body never chooses it.
            $user = $this->users->create($name, $email, password_hash($password, PASSWORD_DEFAULT), 'Customer');
        } catch (PDOException $e) {
            // Lost the race between findByEmail() and INSERT (UNIQUE on email).
            // Postgres's unique_violation SQLSTATE is always '23505' (a fixed
            // standard code, unlike the double-booking trigger's custom one) —
            // '23000' is the MySQL/MariaDB code and never fires here.
            if ($e->getCode() === '23505') {
                Response::error('An account with this email already exists.', 409);
            }
            throw $e;
        }

        $otp  = $this->issueOtp($user['user_id']);
        $sent = Mailer::sendOtp($email, $user['name'], $otp);

        $payload = [
            'email'   => $email,
            'message' => 'Account created. Enter the verification code we sent to your email.',
        ];

        if (!$sent || empty($_ENV['SMTP_HOST'] ?? '') || empty($_ENV['SMTP_USER'] ?? '')) {
            $payload['dev_otp']  = $otp;
            $payload['dev_note'] = 'SMTP not configured — OTP returned for development use only.';
        }

        Response::json($payload, 201);
    }

    // ---------------------------------------------------------------
    // POST /api/auth/login
    // ---------------------------------------------------------------

    public function login(): never
    {
        $body = $this->jsonBody();

        // Fails OPEN: if Google is unreachable, a password is still required,
        // and locking every student out of the system over someone else's
        // outage is the worse failure. A token that is present and REJECTED
        // still fails here.
        $this->requireHuman($body, true);

        $email    = trim($body['email']    ?? '');
        $password = trim($body['password'] ?? '');

        if ($email === '' || $password === '') {
            Response::error('email and password are required.', 422);
        }

        if (strlen($email) > 255) {
            Response::error('Email must be 255 characters or fewer.', 422);
        }

        if (strlen($password) > 72) {
            Response::error('Invalid email or password.', 401);
        }

        if (RateLimiter::isLocked('login', $email)) {
            $remaining = RateLimiter::getRemainingSeconds('login', $email);
            Response::json([
                'error' => "Too many failed attempts. Please wait {$remaining}s before trying again.",
                'retry_after' => $remaining,
                'remaining_attempts' => 0,
                'attempts' => RateLimiter::MAX_ATTEMPTS,
            ], 429);
            exit;
        }

        $user = $this->users->findByEmailFull($email);

        if ($user === null || empty($user['password_hash']) || !password_verify($password, $user['password_hash'])) {
            $failure = RateLimiter::recordFailure('login', $email, RateLimiter::MAX_ATTEMPTS, 30);
            if ($failure['is_locked']) {
                Response::json([
                    'error' => "Too many failed attempts. Please wait {$failure['retry_after']}s before trying again.",
                    'retry_after' => $failure['retry_after'],
                    'remaining_attempts' => 0,
                    'attempts' => $failure['attempts'],
                ], 401);
            } else {
                $word = $failure['remaining_attempts'] === 1 ? 'attempt' : 'attempts';
                Response::json([
                    'error' => "Invalid email or password. {$failure['remaining_attempts']} {$word} remaining.",
                    'retry_after' => 0,
                    'remaining_attempts' => $failure['remaining_attempts'],
                    'attempts' => $failure['attempts'],
                ], 401);
            }
            exit;
        }

        RateLimiter::clear('login', $email);

        if (!(bool)$user['is_verified']) {
            $otp  = $this->issueOtp($user['user_id']);
            $sent = Mailer::sendOtp($email, $user['name'], $otp);

            $payload = [
                'error' => 'Please verify your email address to continue.',
                'email' => $email,
                'requires_verification' => true
            ];

            if (!$sent || empty($_ENV['SMTP_HOST'] ?? '') || empty($_ENV['SMTP_USER'] ?? '')) {
                $payload['dev_otp']  = $otp;
                $payload['dev_note'] = 'SMTP not configured — OTP returned for development use only.';
            }

            Response::json($payload, 403);
            exit;
        }

        $this->startSession($user);

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

        if (RateLimiter::isLocked('verify_otp', $email)) {
            $remaining = RateLimiter::getRemainingSeconds('verify_otp', $email);
            Response::json([
                'error' => "Too many failed attempts. Please wait {$remaining}s before trying again.",
                'retry_after' => $remaining,
                'remaining_attempts' => 0,
                'attempts' => RateLimiter::MAX_ATTEMPTS,
            ], 429);
            exit;
        }

        $user = $this->users->findByEmailFull($email);
        if ($user === null) {
            Response::error('Invalid verification attempt.', 404);
        }

        // Already verified — just log in (user may have submitted twice)
        if ((bool)$user['is_verified'] && empty($user['otp_code'])) {
            RateLimiter::clear('verify_otp', $email);
            $this->startSession($user);
            unset($user['password_hash'], $user['otp_code'], $user['otp_expires_at']);
            Response::json($user);
        }

        // Validate OTP
        if ($user['otp_code'] === null || $code !== $user['otp_code']) {
            $failure = RateLimiter::recordFailure('verify_otp', $email, RateLimiter::MAX_ATTEMPTS, 30);
            if ($failure['is_locked']) {
                Response::json([
                    'error' => "Too many failed attempts. Please wait {$failure['retry_after']}s before trying again.",
                    'retry_after' => $failure['retry_after'],
                    'remaining_attempts' => 0,
                    'attempts' => $failure['attempts'],
                ], 422);
            } else {
                $word = $failure['remaining_attempts'] === 1 ? 'attempt' : 'attempts';
                Response::json([
                    'error' => "Incorrect verification code. {$failure['remaining_attempts']} {$word} remaining.",
                    'retry_after' => 0,
                    'remaining_attempts' => $failure['remaining_attempts'],
                    'attempts' => $failure['attempts'],
                ], 422);
            }
            exit;
        }

        // Check expiry
        $expiresAt = strtotime($user['otp_expires_at'] ?? '1970-01-01');
        if (time() > $expiresAt) {
            Response::error('This code has expired. Please request a new one.', 422);
        }

        // Clear rate limit on successful verification
        RateLimiter::clear('verify_otp', $email);

        // Mark verified, clear OTP, and log in
        $this->users->markVerified($user['user_id']);

        $this->startSession($user);

        $fresh = $this->users->findById($user['user_id']);
        unset($fresh['password_hash'], $fresh['otp_code'], $fresh['otp_expires_at']);
        Response::json($fresh);
    }

    // ---------------------------------------------------------------
    // POST /api/auth/forgot-password
    // ---------------------------------------------------------------

    public function forgotPassword(): never
    {
        $body = $this->jsonBody();

        // Fails CLOSED. Sending email consumes institutional quota and
        // could be abused to spam inboxes without verification.
        $this->requireHuman($body);

        $email = trim($body['email'] ?? '');

        if ($email === '') {
            Response::error('Email is required.', 422);
        }

        $user = $this->users->findByEmailFull($email);
        if ($user === null) {
            // Don't leak whether the email is registered
            Response::json([
                'email'   => $email,
                'message' => 'If an account exists with this email, a verification code has been dispatched.'
            ]);
        }

        $otp  = $this->issueOtp($user['user_id']);
        $sent = Mailer::sendOtp($email, $user['name'], $otp);

        $payload = [
            'email'   => $email,
            'message' => 'If an account exists with this email, a verification code has been dispatched.'
        ];

        if (!$sent || empty($_ENV['SMTP_HOST'] ?? '') || empty($_ENV['SMTP_USER'] ?? '')) {
            $payload['dev_otp']  = $otp;
            $payload['dev_note'] = 'SMTP not configured — OTP returned for development use only.';
        }

        Response::json($payload);
    }

    // ---------------------------------------------------------------
    // POST /api/auth/reset-password
    // ---------------------------------------------------------------

    public function resetPassword(): never
    {
        $body  = $this->jsonBody();
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        $otp   = trim((string) ($body['otp'] ?? ''));
        $password = (string) ($body['password'] ?? '');

        if ($email === '' || $otp === '' || $password === '') {
            Response::error('Email, verification code, and new password are required.', 422);
        }

        if (strlen($password) < 8 || strlen($password) > 72) {
            Response::error('Password must be between 8 and 72 characters.', 422);
        }
        if (!preg_match('/[A-Z]/', $password) || !preg_match('/[a-z]/', $password) || !preg_match('/[0-9]/', $password) || !preg_match('/[^A-Za-z0-9]/', $password)) {
            Response::error('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character.', 422);
        }

        if (RateLimiter::isLocked('reset_otp', $email)) {
            $remaining = RateLimiter::getRemainingSeconds('reset_otp', $email);
            Response::json([
                'error' => "Too many failed attempts. Please wait {$remaining}s before trying again.",
                'retry_after' => $remaining,
                'remaining_attempts' => 0,
                'attempts' => RateLimiter::MAX_ATTEMPTS,
            ], 429);
            exit;
        }

        $user = $this->users->findByEmailFull($email);
        if ($user === null) {
            Response::error('Invalid password reset request.', 404);
        }

        // Validate OTP
        if ($user['otp_code'] === null || $otp !== $user['otp_code']) {
            $failure = RateLimiter::recordFailure('reset_otp', $email, RateLimiter::MAX_ATTEMPTS, 30);
            if ($failure['is_locked']) {
                Response::json([
                    'error' => "Too many failed attempts. Please wait {$failure['retry_after']}s before trying again.",
                    'retry_after' => $failure['retry_after'],
                    'remaining_attempts' => 0,
                    'attempts' => $failure['attempts'],
                ], 422);
            } else {
                $word = $failure['remaining_attempts'] === 1 ? 'attempt' : 'attempts';
                Response::json([
                    'error' => "Incorrect verification code. {$failure['remaining_attempts']} {$word} remaining.",
                    'retry_after' => 0,
                    'remaining_attempts' => $failure['remaining_attempts'],
                    'attempts' => $failure['attempts'],
                ], 422);
            }
            exit;
        }

        // Check expiry
        $expiresAt = strtotime($user['otp_expires_at'] ?? '1970-01-01');
        if (time() > $expiresAt) {
            Response::error('This verification code has expired. Please request a new one.', 422);
        }

        // Clear rate limit on successful password reset
        RateLimiter::clear('reset_otp', $email);

        // Update password and clear OTP
        $passwordHash = password_hash($password, PASSWORD_DEFAULT);
        $this->users->updatePassword($user['user_id'], $passwordHash);

        Response::json([
            'message' => 'Password reset successful! You can now sign in with your new password.'
        ]);
    }

    // ---------------------------------------------------------------
    // POST /api/auth/resend-otp
    // ---------------------------------------------------------------

    public function resendOtp(): never
    {
        $body = $this->jsonBody();

        // Fails CLOSED. This route sends a real email through the University's
        // SMTP account, so an unchecked caller can use it to mail-bomb any
        // address they know. The 30-second cooldown on verify.html is a
        // client-side courtesy and stops nobody who skips the page.
        $this->requireHuman($body);

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
