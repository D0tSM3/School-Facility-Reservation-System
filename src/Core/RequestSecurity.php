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
        if ($origin === '' && !empty($_SERVER['HTTP_REFERER'])) {
            $ref = parse_url($_SERVER['HTTP_REFERER']);
            if (!empty($ref['scheme']) && !empty($ref['host'])) {
                $origin = $ref['scheme'] . '://' . $ref['host'] . (!empty($ref['port']) ? ':' . $ref['port'] : '');
            }
        }

        if (!self::originIsValid($origin)) {
            Response::error('Invalid request origin.', 403);
        }

        $expectedToken = $_SESSION['_csrf_token'] ?? '';
        $providedToken = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!is_string($expectedToken) || $expectedToken === '' || !is_string($providedToken)
            || !hash_equals($expectedToken, $providedToken)) {
            Response::error('Invalid CSRF token.', 403);
        }
    }

    /**
     * Accept a protected POST's Origin only when it is one of our allowed
     * origins. A missing Origin, or one carrying header-injection characters,
     * is never a valid same-site browser POST and is rejected outright.
     */
    private static function originIsValid(string $origin): bool
    {
        if ($origin === '' || preg_match('/[\r\n]/', $origin)) {
            return false;
        }

        $candidate = rtrim($origin, '/');
        foreach (self::allowedOrigins() as $expected) {
            if (hash_equals($expected, $candidate)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Origins a protected POST may legitimately come from:
     *   - the configured canonical APP_ORIGIN, and
     *   - this exact request's own scheme + host (same-origin). This lets Vercel
     *     preview deployments — whose hosts carry a dynamic hash and never equal
     *     the canonical APP_ORIGIN — work without enumerating every URL. It stays
     *     safe against CSRF: a cross-site attacker's browser sends its OWN domain
     *     as Origin while Host remains this deployment's, so the two never match;
     *     and the CSRF token check below is still enforced regardless.
     *
     * Malformed hosts (empty or with CR/LF) are never trusted as same-origin.
     *
     * @return list<string> normalized origins, no trailing slash
     */
    private static function allowedOrigins(): array
    {
        $allowed = [];

        $configured = trim((string) ($_ENV['APP_ORIGIN'] ?? ''));
        if ($configured !== '') {
            $allowed[] = rtrim($configured, '/');
        }

        $host = $_SERVER['HTTP_HOST'] ?? '';
        if ($host !== '' && !preg_match('/[\r\n]/', $host)) {
            $scheme = Auth::isSecure() ? 'https://' : 'http://';
            $allowed[] = $scheme . strtolower($host);
            if (str_ends_with(strtolower($host), '.vercel.app')) {
                $allowed[] = 'https://' . strtolower($host);
            }
        }

        return $allowed;
    }
}
