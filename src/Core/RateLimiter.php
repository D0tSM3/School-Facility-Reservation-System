<?php

declare(strict_types=1);

namespace CampusRoom\Core;

use PDO;

/**
 * RateLimiter — manages cooldown timeouts and failed attempt thresholds
 * for sensitive authentication flows (login, registration OTP verification,
 * and forgot-password OTP reset).
 */
class RateLimiter
{
    /** Total attempts allowed before cooldown lockout */
    public const MAX_ATTEMPTS = 3;

    /** Default lockout cooldown in seconds once attempts are exhausted */
    public const DEFAULT_LOCKOUT_SECONDS = 30;

    /** Inactivity window in seconds before attempt counter resets (15 minutes) */
    public const ATTEMPT_WINDOW_SECONDS = 900;

    /**
     * Generate a canonical, normalized cache key for action + identifier.
     */
    public static function makeKey(string $action, string $identifier): string
    {
        return strtolower(trim($action)) . ':' . strtolower(trim($identifier));
    }

    /**
     * Check if an action + identifier is currently locked out.
     */
    public static function isLocked(string $action, string $identifier): bool
    {
        return self::getRemainingSeconds($action, $identifier) > 0;
    }

    /**
     * Get remaining lockout seconds for an action + identifier.
     * Returns 0 if not locked.
     */
    public static function getRemainingSeconds(string $action, string $identifier): int
    {
        $key = self::makeKey($action, $identifier);
        $pdo = Database::getInstance()->getPdo();

        $stmt = $pdo->prepare(
            'SELECT CEIL(EXTRACT(EPOCH FROM (locked_until - CURRENT_TIMESTAMP)))::int AS remaining
             FROM auth_rate_limits
             WHERE rate_key = :key AND locked_until > CURRENT_TIMESTAMP'
        );
        $stmt->execute([':key' => $key]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return $row !== false ? max(0, (int) $row['remaining']) : 0;
    }

    /**
     * Get total recorded failed attempt count for an action + identifier.
     * Returns 0 if no record exists or if lockout/window has expired.
     */
    public static function getAttempts(string $action, string $identifier): int
    {
        $key = self::makeKey($action, $identifier);
        $pdo = Database::getInstance()->getPdo();

        $stmt = $pdo->prepare('SELECT failed_attempts, locked_until, updated_at FROM auth_rate_limits WHERE rate_key = :key');
        $stmt->execute([':key' => $key]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($row === false) {
            return 0;
        }

        $now = time();
        $lockedUntil = strtotime($row['locked_until']);
        $updatedAt = strtotime($row['updated_at']);

        // If previously locked out and lockout expired, or inactivity > 15m, attempts are reset
        if (($lockedUntil > $updatedAt && $now >= $lockedUntil) || ($now - $updatedAt > self::ATTEMPT_WINDOW_SECONDS)) {
            return 0;
        }

        return max(0, (int) $row['failed_attempts']);
    }

    /**
     * Get remaining attempts before lockout for an action + identifier.
     * Returns MAX_ATTEMPTS (3) if no failures recorded.
     */
    public static function getRemainingAttempts(string $action, string $identifier): int
    {
        $used = self::getAttempts($action, $identifier);
        return max(0, self::MAX_ATTEMPTS - $used);
    }

    /**
     * Record a failed attempt.
     * - Attempt 1 -> 2 remaining, no timer.
     * - Attempt 2 -> 1 remaining, no timer.
     * - Attempt 3 -> 0 remaining, 30s cooldown timer begins.
     *
     * @param string $action         Action name (e.g. 'login', 'verify_otp', 'reset_otp')
     * @param string $identifier     Target user email or IP
     * @param int    $maxAttempts    Maximum attempts allowed (default 3)
     * @param int    $lockoutSeconds Cooldown duration once exhausted (default 30)
     * @return array Status array with attempts, remaining_attempts, is_locked, and retry_after
     */
    public static function recordFailure(
        string $action,
        string $identifier,
        int $maxAttempts = self::MAX_ATTEMPTS,
        int $lockoutSeconds = self::DEFAULT_LOCKOUT_SECONDS
    ): array {
        $key = self::makeKey($action, $identifier);
        $pdo = Database::getInstance()->getPdo();

        $stmt = $pdo->prepare('SELECT failed_attempts, locked_until, updated_at FROM auth_rate_limits WHERE rate_key = :key');
        $stmt->execute([':key' => $key]);
        $existing = $stmt->fetch(PDO::FETCH_ASSOC);

        $now = time();
        $attempts = 1;

        if ($existing !== false) {
            $lockedUntil = strtotime($existing['locked_until']);
            $updatedAt = strtotime($existing['updated_at']);
            $wasLocked = $lockedUntil > $updatedAt;

            // If user previously completed a lockout period, or was inactive for > 15 mins,
            // this new failure begins a brand new attempt cycle.
            if (($wasLocked && $now >= $lockedUntil) || ($now - $updatedAt > self::ATTEMPT_WINDOW_SECONDS)) {
                $attempts = 1;
            } else {
                $attempts = (int) $existing['failed_attempts'] + 1;
            }
        }

        $isLocked = ($attempts >= $maxAttempts);
        $remainingAttempts = max(0, $maxAttempts - $attempts);

        if ($isLocked) {
            $sql = "INSERT INTO auth_rate_limits (rate_key, action, identifier, failed_attempts, locked_until, updated_at)
                    VALUES (:key, :action, :identifier, :attempts, CURRENT_TIMESTAMP + (:seconds * INTERVAL '1 second'), CURRENT_TIMESTAMP)
                    ON CONFLICT (rate_key) DO UPDATE
                    SET failed_attempts = :attempts,
                        locked_until = CURRENT_TIMESTAMP + (:seconds * INTERVAL '1 second'),
                        updated_at = CURRENT_TIMESTAMP
                    RETURNING CEIL(EXTRACT(EPOCH FROM (locked_until - CURRENT_TIMESTAMP)))::int AS remaining";
            $stmt = $pdo->prepare($sql);
            $stmt->execute([
                ':key'        => $key,
                ':action'     => $action,
                ':identifier' => $identifier,
                ':attempts'   => $attempts,
                ':seconds'    => $lockoutSeconds,
            ]);
            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            $remainingCooldown = $row !== false ? max(1, (int) $row['remaining']) : $lockoutSeconds;
        } else {
            $sql = "INSERT INTO auth_rate_limits (rate_key, action, identifier, failed_attempts, locked_until, updated_at)
                    VALUES (:key, :action, :identifier, :attempts, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    ON CONFLICT (rate_key) DO UPDATE
                    SET failed_attempts = :attempts,
                        locked_until = CURRENT_TIMESTAMP,
                        updated_at = CURRENT_TIMESTAMP";
            $stmt = $pdo->prepare($sql);
            $stmt->execute([
                ':key'        => $key,
                ':action'     => $action,
                ':identifier' => $identifier,
                ':attempts'   => $attempts,
            ]);
            $remainingCooldown = 0;
        }

        return [
            'attempts'           => $attempts,
            'remaining_attempts' => $remainingAttempts,
            'is_locked'          => $isLocked,
            'remaining'          => $remainingCooldown,
            'retry_after'        => $remainingCooldown,
            'max_attempts'       => $maxAttempts,
        ];
    }

    /**
     * Clear all recorded failed attempts and lockouts for an action + identifier
     * (called upon successful authentication or OTP verification).
     */
    public static function clear(string $action, string $identifier): void
    {
        $key = self::makeKey($action, $identifier);
        $pdo = Database::getInstance()->getPdo();

        $stmt = $pdo->prepare('DELETE FROM auth_rate_limits WHERE rate_key = :key');
        $stmt->execute([':key' => $key]);
    }
}
