<?php

declare(strict_types=1);

namespace CampusRoom\Core;

final class RequestSecurity
{
    public static function csrfToken(): string
    {
        Auth::startSession();
        if (!isset($_SESSION['_csrf_token']) || !is_string($_SESSION['_csrf_token'])) {
            $_SESSION['_csrf_token'] = bin2hex(random_bytes(32));
        }
        return $_SESSION['_csrf_token'];
    }

    public static function requireProtectedJsonPost(): void
    {
        $contentType = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || $contentType !== 'application/json') {
            Response::error('Invalid request.', 400);
        }

        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        $expectedOrigin = self::expectedOrigin();
        if ($origin === '' || !hash_equals($expectedOrigin, rtrim($origin, '/'))) {
            Response::error('Invalid request origin.', 403);
        }

        $expectedToken = $_SESSION['_csrf_token'] ?? '';
        $providedToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!is_string($expectedToken) || $expectedToken === '' || !is_string($providedToken)
            || !hash_equals($expectedToken, $providedToken)) {
            Response::error('Invalid CSRF token.', 403);
        }
    }

    private static function expectedOrigin(): string
    {
        $configured = trim((string) ($_ENV['APP_ORIGIN'] ?? ''));
        if ($configured !== '') {
            return rtrim($configured, '/');
        }

        if (($_ENV['APP_ENV'] ?? 'development') === 'production') {
            throw new \RuntimeException('APP_ORIGIN must be configured in production.');
        }

        $scheme = Auth::isSecure() ? 'https' : 'http';
        $host = $_SERVER['HTTP_HOST'] ?? '';
        if ($host === '' || preg_match('/[\r\n]/', $host)) {
            throw new \RuntimeException('Cannot determine the application origin.');
        }

        return $scheme . '://' . strtolower($host);
    }
}
