<?php

declare(strict_types=1);

namespace CampusRoom\Controller;

use CampusRoom\Core\Auth;
use CampusRoom\Core\Mailer;
use CampusRoom\Core\PasswordPolicy;
use CampusRoom\Core\RateLimiter;
use CampusRoom\Core\Recaptcha;
use CampusRoom\Core\RequestSecurity;
use CampusRoom\Core\Response;
use CampusRoom\Core\Timing;
use CampusRoom\Repository\ReservationRepository;
use CampusRoom\Repository\UserRepository;
use PDOException;

/**
 * AuthController — handles password login, login OTP verification, and recovery.
 *
 * Roster activation is handled separately by ActivationController. Protected
 * operations use Auth::requireRole(), where the session is the gate.
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
    // POST /api/auth/login
    // ---------------------------------------------------------------

    public function login(): never
    {
        $startedAt = hrtime(true);
        RequestSecurity::requireProtectedJsonPost();
        $body = $this->jsonBody();

        // Fails OPEN: if Google is unreachable, a password is still required,
        // and locking every student out of the system over someone else's
        // outage is the worse failure. A token that is present and REJECTED
        // still fails here.
        $this->requireHuman($body, true);

        $email    = strtolower(trim((string) ($body['email'] ?? '')));
        $password = (string) ($body['password'] ?? '');

        if ($email === '' || $password === '') {
            Response::error('email and password are required.', 422);
        }

        if (strlen($email) > 255) {
            Response::error('Email must be 255 characters or fewer.', 422);
        }

        if (strlen($password) > 128) {
            Response::error('Invalid email or password.', 401);
        }

        if (self::isStudentId($email)) {
            if (!self::validStudentId($email)) {
                Response::error('Invalid email or password.', 401);
            }
            $email = $this->users->emailBySchoolId($email) ?? $email;
        }
        if (!self::allowedEmail($email)) {
            Response::error('Invalid email or password.', 401);
        }

        $rateId = strtolower($email);
        if (RateLimiter::isLocked('login', $rateId)) {
            Response::error('Invalid email or password.', 401);
        }

        $user = $this->users->findByEmailFull($email);
        $hash = (string) ($user['password_hash'] ?? self::dummyPasswordHash());
        $passwordValid = password_verify($password, $hash);
        if ($user === null || !$passwordValid || empty($user['is_active'])) {
            RateLimiter::recordFailure('login', $rateId, 5, 300);
            Timing::pad($startedAt, 1500);
            Response::error('Invalid email or password.', 401);
        }

        if (password_needs_rehash($user['password_hash'], PASSWORD_ARGON2ID)) {
            $this->users->updatePasswordHash(
                $user['user_id'],
                password_hash($password, PASSWORD_ARGON2ID)
            );
        }
        RateLimiter::clear('login', $rateId);

        // Two-factor authentication: every active account receives a fresh
        // one-time code, and a session is created only after it is confirmed.
        $otp  = $this->issueOtp($user['user_id']);
        $sent = Mailer::sendOtp($email, $user['name'], $otp);

        $payload = [
            'message' => (bool)$user['is_verified']
                ? 'A login verification code has been sent to your email.'
                : 'Please verify your email address — a code has been sent to continue.',
            'email' => $email,
            'requires_verification' => true,
        ];

        Response::json($payload, 403);
    }

    // ---------------------------------------------------------------
    // POST /api/auth/verify-otp
    // ---------------------------------------------------------------

    public function verifyOtp(): never
    {
        RequestSecurity::requireProtectedJsonPost();
        $body  = $this->jsonBody();
        $email = trim($body['email'] ?? '');
        $code  = trim($body['otp']   ?? '');

        if ($email === '' || $code === '') {
            Response::error('email and otp are required.', 422);
        }

        if (RateLimiter::isLocked('verify_otp', $email)) {
            Response::error('Invalid or expired verification code.', 422);
        }

        $user = $this->users->findByEmailFull($email);
        if ($user === null) {
            RateLimiter::recordFailure('verify_otp', $email);
            Response::error('Invalid or expired verification code.', 422);
        }

        if ((int) $user['is_active'] !== 1) {
            RateLimiter::recordFailure('verify_otp', $email);
            Response::error('Invalid or expired verification code.', 422);
        }

        // A code must be outstanding (incoming's replay fix). It is cleared the
        // instant one is consumed (markVerified below), so a replayed or codeless
        // request — including a double submit after a successful login — lands
        // here instead of silently opening a second session. This is what makes
        // the login challenge a real second factor rather than a skippable step.
        if (empty($user['otp_code'])) {
            Response::error('Invalid or expired verification code.', 422);
        }

        if ($code !== $user['otp_code']) {
            RateLimiter::recordFailure('verify_otp', $email);
            Response::error('Invalid or expired verification code.', 422);
        }

        // Check expiry
        $expiresAt = strtotime($user['otp_expires_at'] ?? '1970-01-01');
        if (time() > $expiresAt) {
            Response::error('Invalid or expired verification code.', 422);
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
        RequestSecurity::requireProtectedJsonPost();
        $body = $this->jsonBody();

        // Fails CLOSED. Sending email consumes institutional quota and
        // could be abused to spam inboxes without verification.
        $this->requireHuman($body);

        $email = trim($body['email'] ?? '');

        if ($email === '') {
            Response::error('Email is required.', 422);
        }

        $payload = [
            'email' => $email,
            'message' => 'If an account exists with this email, a verification code has been dispatched.',
        ];
        if (RateLimiter::isLocked('forgot_password', $email)) {
            Response::json($payload);
        }
        RateLimiter::recordFailure('forgot_password', $email);

        $user = $this->users->findByEmailFull($email);
        if ($user === null || (int) $user['is_active'] !== 1) {
            Response::json($payload);
        }

        $otp  = $this->issueOtp($user['user_id']);
        Mailer::sendOtp((string) $user['email'], (string) $user['name'], $otp);

        Response::json($payload);
    }

    // ---------------------------------------------------------------
    // POST /api/auth/reset-password
    // ---------------------------------------------------------------

    public function resetPassword(): never
    {
        RequestSecurity::requireProtectedJsonPost();
        $body  = $this->jsonBody();
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        $otp   = trim((string) ($body['otp'] ?? ''));
        $password = (string) ($body['password'] ?? '');

        if ($email === '' || $otp === '' || $password === '') {
            Response::error('Email, verification code, and new password are required.', 422);
        }

        $passwordError = PasswordPolicy::validate($password);
        if ($passwordError !== null) {
            Response::error($passwordError, 422);
        }

        if (RateLimiter::isLocked('reset_otp', $email)) {
            Response::error('Invalid or expired verification code.', 422);
        }

        $user = $this->users->findByEmailFull($email);
        if ($user === null || (int) $user['is_active'] !== 1) {
            Response::error('Invalid or expired verification code.', 422);
        }

        // Validate OTP
        if ($user['otp_code'] === null || $otp !== $user['otp_code']) {
            RateLimiter::recordFailure('reset_otp', $email);
            Response::error('Invalid or expired verification code.', 422);
        }

        // Check expiry
        $expiresAt = strtotime($user['otp_expires_at'] ?? '1970-01-01');
        if (time() > $expiresAt) {
            Response::error('Invalid or expired verification code.', 422);
        }

        // Clear rate limit on successful password reset
        RateLimiter::clear('reset_otp', $email);

        // Update password and clear OTP
        $passwordHash = password_hash($password, PASSWORD_ARGON2ID);
        if ($passwordHash === false) {
            throw new \RuntimeException('Unable to hash reset password.');
        }
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
        RequestSecurity::requireProtectedJsonPost();
        $body = $this->jsonBody();

        // No reCAPTCHA here by product decision: the caller already cleared the
        // challenge on the sign-in screen before reaching the OTP step, and we
        // don't want a second checkbox. Throttling is the 30-second cooldown on
        // verify.html plus the auth_rate_limits table.
        $email = trim($body['email'] ?? '');

        if ($email === '') {
            Response::error('email is required.', 422);
        }

        if (RateLimiter::isLocked('resend_otp', $email)) {
            Response::json(['message' => 'If an account is eligible, a verification code has been sent.']);
        }
        RateLimiter::recordFailure('resend_otp', $email);

        $user = $this->users->findByEmailFull($email);
        if ($user === null || (int) $user['is_active'] !== 1) {
            Response::json(['message' => 'If an account is eligible, a verification code has been sent.']);
        }

        // No "already verified" short-circuit: a verified account still needs a
        // fresh code for every login (two-factor), so Resend must work for it.
        $otp  = $this->issueOtp($user['user_id']);
        Mailer::sendOtp((string) $user['email'], (string) $user['name'], $otp);
        Response::json(['message' => 'If an account is eligible, a verification code has been sent.']);
    }

    // ---------------------------------------------------------------
    // POST /api/auth/logout
    // ---------------------------------------------------------------

    public function logout(): never
    {
        RequestSecurity::requireProtectedJsonPost();
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

    private static function isStudentId(string $value): bool
    {
        return preg_match('/^(19|20)\d{6}$/', $value) === 1;
    }

    private static function validStudentId(string $value): bool
    {
        return self::isStudentId($value)
            && (int) substr($value, 0, 4) <= (int) date('Y');
    }

    private static function allowedEmail(string $email): bool
    {
        $domain = strtolower(ltrim(trim((string) ($_ENV['ALLOWED_EMAIL_DOMAIN'] ?? '')), '@'));
        $at = strrpos($email, '@');
        return $domain !== ''
            && $at !== false
            && hash_equals($domain, strtolower(substr($email, $at + 1)));
    }

    private static function dummyPasswordHash(): string
    {
        return '$argon2id$v=19$m=65536,t=4,p=1$a3dIdGgwMkZBT28zTVVTTA$Gr29UnKQ9EswvnK7cKlN058wArNEsjxbco3Sy92zCbI';
    }
}
