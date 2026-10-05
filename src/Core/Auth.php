<?php

declare(strict_types=1);

namespace CampusRoom\Core;

/**
 * Auth — session helpers and role-based access control.
 */
class Auth
{
    private const COOKIE_NAME = 'campusroom_session';
    private const COOKIE_LIFETIME = 604800; // 7 days in seconds

    /**
     * Determine whether the current request is HTTPS.
     * Takes into account standard reverse proxies and serverless gateways (e.g. Vercel, Cloudflare, AWS ALB).
     */
    public static function isSecure(): bool
    {
        return (isset($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) === 'on')
            || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower((string)$_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https')
            || (isset($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === 443);
    }

    /**
     * Start the session exactly once and restore identity from signed cookie if needed.
     */
    public static function startSession(): void
    {
        if (session_status() === PHP_SESSION_NONE) {
            // On serverless hosts (Vercel) the filesystem session store is wiped
            // between requests, so keep sessions in the database there. Local
            // XAMPP keeps the default files handler. Must be set before start.
            if (self::useDbSessions()) {
                try {
                    session_set_save_handler(new DbSessionHandler(), true);
                } catch (\Throwable $e) {
                    error_log('[CampusRoom] could not register DB session handler: ' . $e->getMessage());
                }
            }

            if (!headers_sent()) {
                // isSecure() honours X-Forwarded-Proto so the cookie is marked
                // Secure behind Vercel's proxy (where $_SERVER['HTTPS'] is unset).
                session_set_cookie_params([
                    'lifetime' => 0,
                    'path'     => '/',
                    'domain'   => '',
                    'secure'   => self::isSecure(),
                    'httponly' => true,
                    'samesite' => 'Lax', // Strict drops the cookie on some cross-site returns; Lax keeps same-site API calls working
                ]);
            }

            @session_start();
        }

        // If native session is missing user identity (e.g. Lambda container switch on Vercel),
        // restore it from the tamper-proof signed cookie if present and valid.
        if (empty($_SESSION['user_id'])) {
            self::restoreFromSignedCookie();
        }
    }

    /**
     * True when sessions should be stored in the database rather than on disk.
     *
     * Opt-in via SESSION_DRIVER=db. On Vercel, login persistence is handled by
     * the stateless signed cookie below (no per-request DB round-trip, which at
     * ~1.5s each would slow every page), so DB sessions are NOT auto-enabled —
     * set SESSION_DRIVER=db only if you want server-side, revocable sessions
     * and accept the latency.
     */
    private static function useDbSessions(): bool
    {
        return ($_ENV['SESSION_DRIVER'] ?? getenv('SESSION_DRIVER')) === 'db';
    }

    /**
     * Persist user identity into the session after a successful login.
     */
    public static function login(string $userId, string $role): void
    {
        self::startSession();
        // Regenerate session ID on privilege change to prevent fixation.
        session_regenerate_id(true);
        $_SESSION['user_id'] = $userId;
        $_SESSION['role']    = $role;

        // Issue stateless signed cookie so other serverless instances recognise this user
        self::issueSignedCookie($userId, $role);
    }

    public static function logout(): void
    {
        self::startSession();

        // Expire native PHPSESSID cookie
        if (ini_get('session.use_cookies') && !headers_sent()) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', [
                'expires'  => time() - 42000,
                'path'     => $params['path'],
                'domain'   => $params['domain'],
                'secure'   => self::isSecure(),
                'httponly' => $params['httponly'],
                'samesite' => 'Lax',
            ]);
        }

        // Clear stateless signed cookie
        self::clearSignedCookie();

        $_SESSION = [];
        session_destroy();
    }

    public static function userId(): ?string
    {
        self::startSession();
        return $_SESSION['user_id'] ?? null;
    }

    public static function role(): ?string
    {
        self::startSession();
        return $_SESSION['role'] ?? null;
    }

    /**
     * Require that the current session holds one of the allowed roles.
     * Aborts with HTTP 401 if not authenticated, HTTP 403 if wrong role.
     *
     * @param string[] $roles  e.g. ['Admin', 'Staff']
     */
    public static function requireRole(array $roles): void
    {
        self::startSession();

        if (empty($_SESSION['user_id'])) {
            Response::error('Unauthenticated. Please log in.', 401);
        }

        if (!in_array($_SESSION['role'], $roles, true)) {
            Response::error('Forbidden. Insufficient permissions.', 403);
        }
    }

    // -------------------------------------------------------------------------
    // Stateless HMAC-signed Session Cookie Helpers
    // -------------------------------------------------------------------------

    private static function getSigningKey(): string
    {
        return $_ENV['APP_SECRET']
            ?? (getenv('APP_SECRET') ?: null)
            ?? $_ENV['DB_PASSWORD']
            ?? (getenv('DB_PASSWORD') ?: null)
            ?? $_ENV['RECAPTCHA_SECRET_KEY']
            ?? (getenv('RECAPTCHA_SECRET_KEY') ?: null)
            ?? 'campusroom-signing-key-salt-2026';
    }

    private static function issueSignedCookie(string $userId, string $role): void
    {
        $exp = time() + self::COOKIE_LIFETIME;
        $payload = json_encode([
            'uid'  => $userId,
            'role' => $role,
            'exp'  => $exp,
        ], JSON_UNESCAPED_SLASHES);

        $payloadB64 = self::base64UrlEncode((string)$payload);
        $sig = hash_hmac('sha256', $payloadB64, self::getSigningKey(), true);
        $sigB64 = self::base64UrlEncode($sig);

        $token = $payloadB64 . '.' . $sigB64;

        if (!headers_sent()) {
            setcookie(self::COOKIE_NAME, $token, [
                'expires'  => $exp,
                'path'     => '/',
                'domain'   => '',
                'secure'   => self::isSecure(),
                'httponly' => true,
                'samesite' => 'Lax',
            ]);
        }
        $_COOKIE[self::COOKIE_NAME] = $token;
    }

    private static function clearSignedCookie(): void
    {
        if (!headers_sent()) {
            setcookie(self::COOKIE_NAME, '', [
                'expires'  => time() - 42000,
                'path'     => '/',
                'domain'   => '',
                'secure'   => self::isSecure(),
                'httponly' => true,
                'samesite' => 'Lax',
            ]);
        }
        unset($_COOKIE[self::COOKIE_NAME]);
    }

    private static function restoreFromSignedCookie(): void
    {
        $token = $_COOKIE[self::COOKIE_NAME] ?? null;
        if (!is_string($token) || strpos($token, '.') === false) {
            return;
        }

        $parts = explode('.', $token, 2);
        if (count($parts) !== 2) {
            return;
        }

        [$payloadB64, $sigB64] = $parts;
        $sig = self::base64UrlDecode($sigB64);
        if ($sig === false) {
            return;
        }

        $expectedSig = hash_hmac('sha256', $payloadB64, self::getSigningKey(), true);
        if (!hash_equals($expectedSig, $sig)) {
            return;
        }

        $json = self::base64UrlDecode($payloadB64);
        if ($json === false) {
            return;
        }

        $data = json_decode($json, true);
        if (!is_array($data) || empty($data['uid']) || empty($data['role']) || empty($data['exp'])) {
            return;
        }

        if (time() > (int)$data['exp']) {
            self::clearSignedCookie();
            return;
        }

        $_SESSION['user_id'] = (string)$data['uid'];
        $_SESSION['role']    = (string)$data['role'];
    }

    private static function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function base64UrlDecode(string $data): string|false
    {
        $remainder = strlen($data) % 4;
        if ($remainder) {
            $padlen = 4 - $remainder;
            $data .= str_repeat('=', $padlen);
        }
        return base64_decode(strtr($data, '-_', '+/'), true);
    }
}
