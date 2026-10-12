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
            $ip = RateLimiter::clientIp();
            $userAgent = self::cleanUserAgent((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));
            $normalizedIdentifier = self::normalizedIdentifier($identifier);
            $secret = self::appSecret();
            $identifierHash = $normalizedIdentifier !== null && $secret !== ''
                ? substr(hash_hmac('sha256', $normalizedIdentifier, $secret), 0, 16)
                : null;

            if (self::shouldSkipByRowCap($event, $ip)) {
                return;
            }

            if (random_int(1, 100) === 1) {
                try {
                    $pdo = Database::getInstance()->getPdo();
                    $pdo->prepare(
                        "DELETE FROM System_Logs
                          WHERE event_type IS NOT NULL
                            AND \"timestamp\" < CURRENT_TIMESTAMP - INTERVAL '90 days'"
                    )->execute();
                } catch (\Throwable $e) {
                    error_log('SecurityLog retention purge failed: ' . $e->getMessage());
                }
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
        if (preg_match('//u', $userAgent) !== 1) {
            $userAgent = self::replaceInvalidUtf8($userAgent);
        }

        $cleaned = preg_replace('/[\x00-\x1F\x7F]+/', '', $userAgent) ?? '';
        preg_match('/^.{0,200}/us', $cleaned, $match);
        return $match[0] ?? '';
    }

    private static function replaceInvalidUtf8(string $value): string
    {
        $validSequence = '/\G(?:[\xC2-\xDF][\x80-\xBF]'
            . '|\xE0[\xA0-\xBF][\x80-\xBF]'
            . '|[\xE1-\xEC\xEE-\xEF][\x80-\xBF]{2}'
            . '|\xED[\x80-\x9F][\x80-\xBF]'
            . '|\xF0[\x90-\xBF][\x80-\xBF]{2}'
            . '|[\xF1-\xF3][\x80-\xBF]{3}'
            . '|\xF4[\x80-\x8F][\x80-\xBF]{2})/';
        $cleaned = '';
        $length = strlen($value);

        for ($offset = 0; $offset < $length;) {
            $byte = ord($value[$offset]);
            if ($byte < 0x80) {
                $cleaned .= $byte < 0x20 || $byte === 0x7F ? '?' : $value[$offset];
                $offset++;
                continue;
            }

            if (preg_match($validSequence, $value, $match, 0, $offset) === 1) {
                $cleaned .= $match[0];
                $offset += strlen($match[0]);
                continue;
            }

            $cleaned .= '?';
            $offset++;
        }

        return $cleaned;
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
               FROM System_Logs
              WHERE ip_address = :ip
                AND event_type = :event
                AND \"timestamp\" >= CURRENT_TIMESTAMP - INTERVAL '15 minutes'"
        );
        $stmt->execute([
            ':ip'    => $ip,
            ':event' => $event,
        ]);

        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return (int) ($row['total'] ?? 0) >= $limit;
    }

}
