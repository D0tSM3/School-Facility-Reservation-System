<?php

declare(strict_types=1);

namespace CampusRoom\Core;

use PDO;

final class RateLimiter
{
    public const MAX_ATTEMPTS = 5;
    public const DEFAULT_LOCKOUT_SECONDS = 300;
    public const ATTEMPT_WINDOW_SECONDS = 900;

    public static function resolveIdentifier(?string $identifier = null): string
    {
        $ip = self::clientIp();
        $normalizedIdentifier = strtolower(trim((string) $identifier));
        $identifierHash = $normalizedIdentifier === ''
            ? 'none'
            : hash('sha256', $normalizedIdentifier);
        return 'ip:' . $ip . ':id:' . $identifierHash;
    }

    public static function makeKey(string $action, ?string $identifier = null): string
    {
        return strtolower(trim($action)) . ':' . hash('sha256', self::resolveIdentifier($identifier));
    }

    public static function isLocked(string $action, ?string $identifier = null): bool
    {
        return self::getRemainingSeconds($action, $identifier) > 0;
    }

    public static function getRemainingSeconds(string $action, ?string $identifier = null): int
    {
        $stmt = Database::getInstance()->getPdo()->prepare(
            'SELECT GREATEST(0, CEIL(EXTRACT(EPOCH FROM (locked_until - CURRENT_TIMESTAMP))))::int AS remaining
               FROM auth_rate_limits
              WHERE rate_key = :key
                AND locked_until > CURRENT_TIMESTAMP'
        );
        $stmt->execute([':key' => self::makeKey($action, $identifier)]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ? max(0, (int) $row['remaining']) : 0;
    }

    public static function getAttempts(string $action, ?string $identifier = null): int
    {
        $stmt = Database::getInstance()->getPdo()->prepare(
            "SELECT CASE
                     WHEN updated_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes' THEN 0
                     WHEN locked_until <= CURRENT_TIMESTAMP AND locked_until > updated_at THEN 0
                     ELSE failed_attempts
                   END AS attempts
               FROM auth_rate_limits
              WHERE rate_key = :key"
        );
        $stmt->execute([':key' => self::makeKey($action, $identifier)]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ? max(0, (int) $row['attempts']) : 0;
    }

    public static function getRemainingAttempts(string $action, ?string $identifier = null): int
    {
        return max(0, self::MAX_ATTEMPTS - self::getAttempts($action, $identifier));
    }

    /**
     * Rate-limit keys combine the client IP with a SHA-256 identifier hash;
     * neither session IDs nor raw account identifiers are persisted.
     *
     * @return array{attempts: int, remaining_attempts: int, is_locked: bool, remaining: int, retry_after: int, max_attempts: int}
     */
    public static function recordFailure(
        string $action,
        ?string $identifier = null,
        int $maxAttempts = self::MAX_ATTEMPTS,
        int $lockoutSeconds = self::DEFAULT_LOCKOUT_SECONDS
    ): array {
        $rateKey = self::makeKey($action, $identifier);
        $storedIdentifier = self::resolveIdentifier($identifier);
        $pdo = Database::getInstance()->getPdo();
        $stmt = $pdo->prepare(
            "INSERT INTO auth_rate_limits
                (rate_key, action, identifier, failed_attempts, locked_until, updated_at)
             VALUES
                (:key, :action, :identifier, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             ON CONFLICT (rate_key) DO UPDATE
               SET failed_attempts = CASE
                     WHEN auth_rate_limits.updated_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
                       OR (auth_rate_limits.locked_until <= CURRENT_TIMESTAMP
                           AND auth_rate_limits.locked_until > auth_rate_limits.updated_at)
                     THEN 1
                     ELSE auth_rate_limits.failed_attempts + 1
                   END,
                   locked_until = CASE
                     WHEN CASE
                       WHEN auth_rate_limits.updated_at < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
                         OR (auth_rate_limits.locked_until <= CURRENT_TIMESTAMP
                             AND auth_rate_limits.locked_until > auth_rate_limits.updated_at)
                       THEN 1
                       ELSE auth_rate_limits.failed_attempts + 1
                     END >= :max_attempts
                     THEN CURRENT_TIMESTAMP + (CAST(:lockout_seconds AS integer) * INTERVAL '1 second')
                     ELSE CURRENT_TIMESTAMP
                   END,
                   updated_at = CURRENT_TIMESTAMP
             RETURNING failed_attempts,
                       GREATEST(0, CEIL(EXTRACT(EPOCH FROM
                         (locked_until - CURRENT_TIMESTAMP))))::int AS remaining"
        );
        $stmt->execute([
            ':key' => $rateKey,
            ':action' => $action,
            ':identifier' => $storedIdentifier,
            ':max_attempts' => $maxAttempts,
            ':lockout_seconds' => $lockoutSeconds,
        ]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        $attempts = (int) ($row['failed_attempts'] ?? 1);
        $remaining = max(0, (int) ($row['remaining'] ?? 0));
        $isLocked = $attempts >= $maxAttempts && $remaining > 0;

        return [
            'attempts' => $attempts,
            'remaining_attempts' => max(0, $maxAttempts - $attempts),
            'is_locked' => $isLocked,
            'remaining' => $remaining,
            'retry_after' => $remaining,
            'max_attempts' => $maxAttempts,
        ];
    }

    public static function clear(string $action, ?string $identifier = null): void
    {
        $stmt = Database::getInstance()->getPdo()->prepare(
            'DELETE FROM auth_rate_limits WHERE rate_key = :key'
        );
        $stmt->execute([':key' => self::makeKey($action, $identifier)]);
    }

    private static function clientIp(): string
    {
        if (($_ENV['VERCEL'] ?? getenv('VERCEL') ?: '') === '1') {
            $forwarded = (string) ($_SERVER['HTTP_X_FORWARDED_FOR'] ?? '');
            $candidate = trim(explode(',', $forwarded)[0] ?? '');
            if (filter_var($candidate, FILTER_VALIDATE_IP)) {
                return $candidate;
            }
        }

        $remote = (string) ($_SERVER['REMOTE_ADDR'] ?? '127.0.0.1');
        return filter_var($remote, FILTER_VALIDATE_IP) ? $remote : '127.0.0.1';
    }
}
