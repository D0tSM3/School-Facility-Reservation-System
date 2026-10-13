<?php

declare(strict_types=1);

namespace CampusRoom\Controller;

use CampusRoom\Core\Mailer;
use CampusRoom\Core\PasswordPolicy;
use CampusRoom\Core\RateLimiter;
use CampusRoom\Core\Recaptcha;
use CampusRoom\Core\RequestSecurity;
use CampusRoom\Core\Response;
use CampusRoom\Core\Timing;
use CampusRoom\Repository\ActivationRepository;
use PDOException;

final class ActivationController
{
    private const STATE_KEY = '_activation_state';
    private const STATE_TTL_SECONDS = 900;
    private const RESPONSE_FLOOR_MILLISECONDS = 1500;
    private const REQUEST_MESSAGE = 'If eligible, an activation code has been sent to the email address on the school roster.';

    private ActivationRepository $activation;

    public function __construct()
    {
        $this->activation = new ActivationRepository();
    }

    public function request(): never
    {
        $startedAt = hrtime(true);
        RequestSecurity::requireProtectedJsonPost();
        $body = $this->jsonBody();

        $captchaError = Recaptcha::check(
            isset($body['recaptcha_token']) ? (string) $body['recaptcha_token'] : null,
            self::clientIp()
        );
        if ($captchaError !== null) {
            Timing::pad($startedAt, self::RESPONSE_FLOOR_MILLISECONDS);
            Response::error('Unable to process the activation request.', 400);
        }

        $schoolId = strtoupper(trim((string) ($body['student_id'] ?? '')));
        if (!self::validStudentId($schoolId)) {
            Timing::pad($startedAt, self::RESPONSE_FLOOR_MILLISECONDS);
            Response::json(['message' => self::REQUEST_MESSAGE], 202);
        }

        if (RateLimiter::isLocked('activate_request', $schoolId)) {
            Timing::pad($startedAt, self::RESPONSE_FLOOR_MILLISECONDS);
            Response::json(['message' => self::REQUEST_MESSAGE], 202);
        }
        RateLimiter::recordFailure('activate_request', $schoolId);

        $allowedDomain = strtolower(ltrim(trim((string) ($_ENV['ALLOWED_EMAIL_DOMAIN'] ?? '')), '@'));
        if ($allowedDomain === '') {
            throw new \RuntimeException('ALLOWED_EMAIL_DOMAIN must be configured.');
        }

        $otp = self::newOtp();
        $roster = $this->activation->requestOtp(
            $schoolId,
            hash('sha256', $otp),
            self::activationTtlSeconds(),
            $allowedDomain
        );

        if ($roster['eligible'] ?? false) {
            Mailer::sendOtp(
                (string) $roster['email'],
                (string) $roster['name'],
                $otp,
                self::activationTtlSeconds()
            );
        }

        Timing::pad($startedAt, self::RESPONSE_FLOOR_MILLISECONDS);
        Response::json(['message' => self::REQUEST_MESSAGE], 202);
    }

    public function verify(): never
    {
        $startedAt = hrtime(true);
        RequestSecurity::requireProtectedJsonPost();
        $body = $this->jsonBody();
        $schoolId = strtoupper(trim((string) ($body['student_id'] ?? '')));
        $code = trim((string) ($body['otp'] ?? ''));

        if (!self::validStudentId($schoolId) || !preg_match('/^\d{6}$/', $code)) {
            Timing::pad($startedAt, self::RESPONSE_FLOOR_MILLISECONDS);
            Response::error('Invalid or expired activation code.', 422);
        }

        if (RateLimiter::isLocked('activate_verify', $schoolId)) {
            Timing::pad($startedAt, self::RESPONSE_FLOOR_MILLISECONDS);
            Response::error('Invalid or expired activation code.', 422);
        }

        $result = $this->activation->verifyOtp(
            $schoolId,
            $code,
            self::activationOtpMaxAttempts()
        );

        if (!($result['verified'] ?? false)) {
            RateLimiter::recordFailure('activate_verify', $schoolId);
            Timing::pad($startedAt, self::RESPONSE_FLOOR_MILLISECONDS);
            Response::error('Invalid or expired activation code.', 422);
        }
        RateLimiter::clear('activate_verify', $schoolId);

        if (!session_regenerate_id(true)) {
            throw new \RuntimeException('Unable to regenerate session after activation verification.');
        }
        $_SESSION['_csrf_token'] = bin2hex(random_bytes(32));
        $_SESSION[self::STATE_KEY] = [
            'verified' => true,
            'school_id' => (string) $result['roster']['school_id'],
            'email' => (string) $result['roster']['email'],
            'name' => (string) $result['roster']['full_name'],
            'person_type' => (string) $result['roster']['person_type'],
            'expires_at' => time() + self::STATE_TTL_SECONDS,
        ];

        Timing::pad($startedAt, self::RESPONSE_FLOOR_MILLISECONDS);
        Response::json(['verified' => true], 200);
    }

    public function context(): never
    {
        $state = $this->verifiedState();
        if ($state === null) {
            Response::error('Activation verification is required.', 401);
        }

        Response::json([
            'name' => $state['name'],
            'email' => self::maskEmail($state['email']),
            'person_type' => $state['person_type'],
            'expires_in' => max(0, (int) $state['expires_at'] - time()),
            'policy' => [
                'min_length' => PasswordPolicy::MIN_LENGTH,
                'max_length' => PasswordPolicy::MAX_LENGTH,
            ],
        ]);
    }

    public function complete(): never
    {
        RequestSecurity::requireProtectedJsonPost();
        $state = $this->verifiedState();
        if ($state === null) {
            Response::error('Activation verification is required.', 401);
        }
        if (RateLimiter::isLocked('activate_complete', $state['school_id'])) {
            Response::error('Please wait before trying again.', 429);
        }

        $body = $this->jsonBody();
        $password = $body['password'] ?? null;
        if (!is_string($password)) {
            Response::error(
                'Password does not meet requirements.',
                422,
                ['codes' => ['invalid_input']]
            );
        }

        $confirmation = $body['password_confirm'] ?? null;
        $codes = PasswordPolicy::validateAll($password, [
            'school_id' => $state['school_id'],
            'full_name' => $state['name'],
            'email' => $state['email'],
        ]);
        if (!is_string($confirmation) || $password !== $confirmation) {
            $codes[] = 'mismatch';
        }
        if ($codes !== []) {
            RateLimiter::recordFailure('activate_complete', $state['school_id']);
            Response::error(
                'Password does not meet requirements.',
                422,
                ['codes' => array_values(array_unique($codes))]
            );
        }

        unset($_SESSION[self::STATE_KEY]);
        session_write_close();
        $passwordHash = password_hash($password, PASSWORD_ARGON2ID);
        if ($passwordHash === false) {
            throw new \RuntimeException('Unable to hash activation password.');
        }

        try {
            $result = $this->activation->complete(
                $state['school_id'],
                $passwordHash,
                $state['person_type'],
                $state['email']
            );
        } catch (PDOException $e) {
            if ($e->getCode() === '23505') {
                Response::error('This school account has already been activated.', 409, ['code' => 'already_activated']);
            }
            throw $e;
        }

        if (!($result['created'] ?? false)) {
            Response::error('Activation could not be completed.', 409, ['code' => 'activation_failed']);
        }

        RateLimiter::clear('activate_complete', $state['school_id']);

        Response::json($result['user'], 201);
    }

    private function verifiedState(): ?array
    {
        $state = $_SESSION[self::STATE_KEY] ?? null;
        if (!is_array($state)
            || ($state['verified'] ?? false) !== true
            || !isset($state['school_id'], $state['email'], $state['person_type'], $state['expires_at'])
            || (int) $state['expires_at'] <= time()) {
            unset($_SESSION[self::STATE_KEY]);
            return null;
        }
        return $state;
    }

    private function jsonBody(): array
    {
        $body = json_decode(file_get_contents('php://input') ?: '{}', true);
        if (!is_array($body)) {
            Response::error('Request body must be valid JSON.', 400);
        }
        return $body;
    }

    private static function validStudentId(string $studentId): bool
    {
        if (!preg_match('/^(19|20)\d{6}$/', $studentId)) {
            return false;
        }
        return (int) substr($studentId, 0, 4) <= (int) date('Y');
    }

    private static function activationTtlSeconds(): int
    {
        $ttl = filter_var($_ENV['ACTIVATION_OTP_TTL_SECONDS'] ?? '600', FILTER_VALIDATE_INT);
        if ($ttl === false || $ttl < 60 || $ttl > 3600) {
            throw new \RuntimeException('ACTIVATION_OTP_TTL_SECONDS must be from 60 to 3600.');
        }
        return $ttl;
    }

    private static function activationOtpMaxAttempts(): int
    {
        $attempts = filter_var($_ENV['ACTIVATION_OTP_MAX_ATTEMPTS'] ?? '5', FILTER_VALIDATE_INT);
        if ($attempts === false || $attempts < 1 || $attempts > 10) {
            throw new \RuntimeException('ACTIVATION_OTP_MAX_ATTEMPTS must be from 1 to 10.');
        }
        return $attempts;
    }

    private static function newOtp(): string
    {
        return str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    }

    private static function maskEmail(string $email): string
    {
        [$local, $domain] = array_pad(explode('@', $email, 2), 2, '');
        if ($local === '' || $domain === '') {
            return '';
        }
        return substr($local, 0, 1) . str_repeat('*', max(1, strlen($local) - 1)) . '@' . $domain;
    }

    private static function clientIp(): ?string
    {
        return $_SERVER['REMOTE_ADDR'] ?? null;
    }
}
