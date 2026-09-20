<?php

declare(strict_types=1);

namespace CampusRoom\Core;

/**
 * Recaptcha — server-side verification of a Google reCAPTCHA v2 checkbox token.
 *
 * The secret key never leaves this class, and never leaves the server: the
 * browser only ever sees the SITE key, handed out by GET /api/config.
 *
 * Deliberately uses cURL rather than Guzzle. Guzzle is present in vendor/ only
 * as a transitive dependency of league/oauth2-google — a package this project
 * no longer uses — so building on it would break the moment that dead
 * dependency is dropped. cURL ships with PHP.
 *
 * A token is SINGLE-USE and expires roughly two minutes after the box is
 * ticked, so a caller that rejects a request for some other reason must reset
 * the widget or the user's next attempt fails for a reason they cannot see.
 */
final class Recaptcha
{
    private const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

    /**
     * Whether verification is switched on. False disables every check, which
     * is how the automated suites post to the auth routes; it is also the
     * default, so a fresh clone without keys still runs.
     */
    public static function enabled(): bool
    {
        return filter_var($_ENV['RECAPTCHA_ENABLED'] ?? 'false', FILTER_VALIDATE_BOOLEAN)
            && trim((string) ($_ENV['RECAPTCHA_SECRET_KEY'] ?? '')) !== '';
    }

    /** The public site key, or '' when unconfigured. Safe to send to the browser. */
    public static function siteKey(): string
    {
        return trim((string) ($_ENV['RECAPTCHA_SITE_KEY'] ?? ''));
    }

    /**
     * Verify a token.
     *
     * @param string|null $token    the g-recaptcha-response from the form
     * @param bool        $failOpen what to do when GOOGLE ITSELF is unreachable.
     *                              false (default) refuses the request — right
     *                              for anything that creates an account or
     *                              sends mail. true lets it through — right for
     *                              login, where the password is still required
     *                              and a network fault should not lock the
     *                              whole university out.
     *                              A token that is missing or REJECTED always
     *                              fails, whatever this is set to.
     * @return string|null null when the request may proceed; otherwise the
     *                     message to show the user.
     */
    public static function check(?string $token, ?string $remoteIp = null, bool $failOpen = false): ?string
    {
        if (!self::enabled()) {
            return null;
        }

        $token = trim((string) $token);
        if ($token === '') {
            return 'Please confirm you are not a robot, then try again.';
        }

        if (!function_exists('curl_init')) {
            error_log('[CampusRoom] reCAPTCHA: ext-curl is not available.');
            return $failOpen ? null : 'Verification is temporarily unavailable. Please try again shortly.';
        }

        $fields = [
            'secret'   => (string) $_ENV['RECAPTCHA_SECRET_KEY'],
            'response' => $token,
        ];
        if ($remoteIp !== null && $remoteIp !== '') {
            $fields['remoteip'] = $remoteIp;
        }

        $ch = curl_init(self::VERIFY_URL);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => http_build_query($fields),
            CURLOPT_TIMEOUT        => 5,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        $raw    = curl_exec($ch);
        $error  = curl_error($ch);
        curl_close($ch);

        // Could not reach Google. This is the fail-open/closed decision.
        if ($raw === false) {
            error_log('[CampusRoom] reCAPTCHA unreachable: ' . $error);
            return $failOpen ? null : 'Verification is temporarily unavailable. Please try again shortly.';
        }

        $body = json_decode((string) $raw, true);
        if (!is_array($body)) {
            error_log('[CampusRoom] reCAPTCHA: unreadable response from Google.');
            return $failOpen ? null : 'Verification is temporarily unavailable. Please try again shortly.';
        }

        if (empty($body['success'])) {
            // Google answered and said no. Never fail open on this.
            $codes = isset($body['error-codes']) && is_array($body['error-codes'])
                ? implode(', ', $body['error-codes'])
                : 'unspecified';
            error_log('[CampusRoom] reCAPTCHA rejected a token: ' . $codes);

            // The error codes are operator detail (bad secret, duplicate token,
            // expired token). The user is told only what they can act on.
            return 'Verification failed. Please tick the box again and retry.';
        }

        return null;
    }
}
