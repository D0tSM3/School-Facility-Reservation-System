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
                error_log('[CampusRoom] Visitor summary retention failed: ' . $e->getMessage());
            }

            $secret = defined('APP_SECRET')
                ? (string) APP_SECRET
                : (string) ($_ENV['APP_SECRET'] ?? getenv('APP_SECRET') ?: '');
            if ($secret === '') {
                throw new \RuntimeException('APP_SECRET is not configured for visitor summaries.');
            }

            $ip = RateLimiter::clientIp();
            $dailyKey = hash_hmac('sha256', $day, $secret, true);
            $visitorHash = substr(hash_hmac('sha256', $ip, $dailyKey), 0, 16);
            $browserFamily = self::browserFamily((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));

            (new VisitorDayRepository())->record($day, $visitorHash, $page, $browserFamily);
        } catch (Throwable $e) {
            error_log('[CampusRoom] Visitor summary record failed: ' . $e->getMessage());
        }
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
