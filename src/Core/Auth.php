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
    private static ?string $validatedIdentity = null;

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
                    if (!session_set_save_handler(new DbSessionHandler(), true)) {
                        throw new \RuntimeException('PHP refused the configured DB session handler.');
                    }
                } catch (\Throwable $e) {
                    error_log('[CampusRoom] could not register DB session handler: ' . $e->getMessage());
                    throw new \RuntimeException('Unable to initialize the configured session handler.', 0, $e);
                }
            }

            if (!headers_sent()) {
                session_set_cookie_params([
                    'lifetime' => 0,
                    'path'     => '/',
                    'domain'   => '',
                    'secure'   => self::secureCookies(),
                    'httponly' => true,
                    'samesite' => 'Lax', // Strict drops the cookie on some cross-site returns; Lax keeps same-site API calls working
                ]);
            }

            if (!session_start()) {
                throw new \RuntimeException('Unable to start the session.');
            }
            self::getSigningKey();
        }

        // If native session is missing user identity (e.g. Lambda container switch on Vercel),
        // restore it from the tamper-proof signed cookie if present and valid.
        if (empty($_SESSION['user_id'])) {
            self::restoreFromSignedCookie();
        }

        $userId = (string) ($_SESSION['user_id'] ?? '');
        $role = (string) ($_SESSION['role'] ?? '');
        if ($userId === '' || $role === '') {
            self::$validatedIdentity = null;
            return;
        }

        $identityKey = $userId . "\0" . $role;
        if (self::$validatedIdentity !== $identityKey) {
            if (!(new \CampusRoom\Repository\UserRepository())->isActiveIdentity($userId, $role)) {
                unset($_SESSION['user_id'], $_SESSION['role']);
                self::clearSignedCookie();
                self::$validatedIdentity = null;
                return;
            }
            self::$validatedIdentity = $identityKey;
        }
    }

    /**
     * True when sessions should be stored in the database rather than on disk.
     *
     * Vercel needs shared server-side sessions for the short-lived activation
     * verification state; other deployments may opt in via SESSION_DRIVER=db.
     */
    private static function useDbSessions(): bool
    {
        return ($_ENV['SESSION_DRIVER'] ?? getenv('SESSION_DRIVER')) === 'db'
            || (($_ENV['VERCEL'] ?? getenv('VERCEL')) === '1');
    }

    private static function secureCookies(): bool
    {
        return self::isSecure() || (($_ENV['APP_ENV'] ?? 'development') === 'production');
    }

    /**
     * Persist user identity into the session after a successful login.
     */
    public static function login(string $userId, string $role): void
    {
        self::startSession();
        // Regenerate session ID on privilege change to prevent fixation.
        if (!session_regenerate_id(true)) {
            throw new \RuntimeException('Unable to regenerate session after login.');
        }
        $_SESSION['user_id'] = $userId;
        $_SESSION['role']    = $role;
        if (!(new \CampusRoom\Repository\UserRepository())->isActiveIdentity($userId, $role)) {
            unset($_SESSION['user_id'], $_SESSION['role']);
            throw new \RuntimeException('Cannot establish a session for an inactive account.');
        }
        self::$validatedIdentity = $userId . "\0" . $role;

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
                'secure'   => self::secureCookies(),
                'httponly' => $params['httponly'],
                'samesite' => 'Lax',
            ]);
        }

        // Clear stateless signed cookie
        self::clearSignedCookie();

        $_SESSION = [];
        self::$validatedIdentity = null;
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
        $configured = $_ENV['APP_SECRET'] ?? getenv('APP_SECRET');
        $key = is_string($configured) ? trim($configured) : '';
        if (strlen($key) < 32) {
            throw new \RuntimeException('APP_SECRET must contain at least 32 characters.');
        }
        return $key;
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
                'secure'   => self::secureCookies(),
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
                'secure'   => self::secureCookies(),
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
