<?php

declare(strict_types=1);

namespace CampusRoom\Core;

use CampusRoom\Repository\VisitorDayRepository;
use DateTimeImmutable;
use DateTimeZone;
use Throwable;

final class VisitorLog
{
    private const RETENTION_SAMPLE_RATE = 100;

    public static function record(string $page): void
    {
        $ip = null;
        try {
            if (!in_array($page, ['landing', 'login', 'activate'], true)) {
                return;
            }

            $timezoneName = (string) ($_ENV['APP_TIMEZONE'] ?? 'Asia/Manila');
            $today = new DateTimeImmutable('now', new DateTimeZone($timezoneName));
            $day = $today->format('Y-m-d');

            try {
                if (random_int(1, self::RETENTION_SAMPLE_RATE) === 1) {
                    (new VisitorDayRepository())->purgeBefore(
                        $today->modify('-30 days')->format('Y-m-d')
                    );
                }
            } catch (Throwable $e) {
                error_log(
                    '[CampusRoom] Visitor summary retention failed: '
                    . self::redactIp($e->getMessage(), $ip)
                );
            }

            $ip = RateLimiter::clientIp();
            if (filter_var($ip, FILTER_VALIDATE_IP) === false) {
                return;
            }
            $browserFamily = self::browserFamily((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));

            (new VisitorDayRepository())->record($day, $ip, $page, $browserFamily);
        } catch (Throwable $e) {
            error_log(
                '[CampusRoom] Visitor summary record failed: '
                . self::redactIp($e->getMessage(), $ip)
            );
        }
    }

    private static function redactIp(string $message, ?string $ip): string
    {
        return $ip === null || $ip === '' ? $message : str_replace($ip, '[redacted]', $message);
    }

    private static function browserFamily(string $userAgent): string
    {
        if (preg_match('/(?:bot|crawler|spider|curl|wget|python|headless|httpclient|axios|node)/i', $userAgent)) {
            return 'script/other';
        }
        if (stripos($userAgent, 'Edg/') !== false || stripos($userAgent, 'EdgA/') !== false) {
            return 'Edge';
        }
        if (stripos($userAgent, 'Firefox/') !== false) {
            return 'Firefox';
        }
        if (stripos($userAgent, 'Chrome/') !== false || stripos($userAgent, 'CriOS/') !== false) {
            return 'Chrome';
        }
        if (stripos($userAgent, 'Safari/') !== false) {
            return 'Safari';
        }

        return 'script/other';
    }
}
