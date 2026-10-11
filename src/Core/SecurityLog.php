<?php

declare(strict_types=1);

namespace CampusRoom\Core;

use CampusRoom\Repository\ReservationRepository;
use PDO;

final class SecurityLog
{
    /**
     * Record a security event without exposing the raw identifier or breaking
     * sign-in/activation flows. The app keeps working even if the log fails.
     */
    public static function record(string $event, string $message, ?string $userId = null, ?string $identifier = null): void
    {
        try {
            $ip = self::clientIp();
            $userAgent = self::cleanUserAgent((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));
            $normalizedIdentifier = self::normalizedIdentifier($identifier);
            $identifierHash = $normalizedIdentifier === null
                ? null
                : substr(hash_hmac('sha256', $normalizedIdentifier, self::appSecret()), 0, 16);

            if (self::shouldSkipByRowCap($event, $ip)) {
                return;
            }

            if (random_int(1, 100) === 1) {
                $pdo = Database::getInstance()->getPdo();
                $pdo->prepare(
                    "DELETE FROM \"System_Logs\"
                      WHERE event_type IS NOT NULL
                        AND timestamp < CURRENT_TIMESTAMP - INTERVAL '90 days'"
                )->execute();
            }

            $repository = new ReservationRepository();
            $repository->insertLog(
                $userId,
                $message,
                null,
                $event,
                $ip,
                $identifierHash,
                $userAgent
            );
        } catch (\Throwable $e) {
            error_log('SecurityLog::record failed: ' . $e->getMessage());
        }
    }

    private static function appSecret(): string
    {
        if (defined('APP_SECRET')) {
            return (string) APP_SECRET;
        }

        return (string) ($_ENV['APP_SECRET'] ?? getenv('APP_SECRET') ?? '');
    }

    private static function normalizedIdentifier(?string $identifier): ?string
    {
        if ($identifier === null) {
            return null;
        }

        $normalized = strtolower(trim((string) $identifier));
        return $normalized === '' ? null : $normalized;
    }

    private static function cleanUserAgent(string $userAgent): string
    {
        $cleaned = str_replace(["\r", "\n"], '', $userAgent);
        $cleaned = preg_replace('/[\x00-\x1F\x7F]+/', '', $cleaned) ?? '';
        return mb_substr($cleaned, 0, 200);
    }

    private static function shouldSkipByRowCap(string $event, ?string $ip): bool
    {
        if (!is_string($ip) || $ip === '') {
            return false;
        }

        $limit = null;
        if ($event === 'login_failed') {
            $limit = 20;
        } elseif ($event === 'activation_no_match') {
            $limit = 30;
        }

        if ($limit === null) {
            return false;
        }

        $pdo = Database::getInstance()->getPdo();
        $stmt = $pdo->prepare(
            "SELECT COUNT(*) AS total
               FROM \"System_Logs\"
              WHERE ip_address = :ip
                AND event_type = :event
                AND timestamp >= CURRENT_TIMESTAMP - INTERVAL '15 minutes'"
        );
        $stmt->execute([
            ':ip'    => $ip,
            ':event' => $event,
        ]);

        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return (int) ($row['total'] ?? 0) >= $limit;
    }

    private static function clientIp(): ?string
    {
        $method = new \ReflectionMethod(RateLimiter::class, 'clientIp');
        $method->setAccessible(true);
        $ip = $method->invoke(null);
        return is_string($ip) && $ip !== '' ? $ip : null;
    }
}
