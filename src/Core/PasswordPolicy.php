<?php

declare(strict_types=1);

namespace CampusRoom\Core;

final class PasswordPolicy
{
    private const COMMON_PASSWORDS = [
        '1234567890123',
        '12345678901234',
        '123456789012345',
        '1234567890abcdef',
        'password12345',
        '123456789012',
        'qwertyuiop123',
        'qwerty123456789',
        'password123',
        'password1234',
        'password12345!',
        'adminadmin123',
        'administrator',
        'qwerty123456',
        'iloveyou1234',
        'letmein12345',
        'welcome12345',
        'admin123456',
        'welcome1234',
        'iloveyou123',
        'changeme123',
        'correcthorsebatterystaple',
        'dragon123456',
        'football1234',
        'monkey123456',
        'sunshine1234',
        'princess1234',
        'trustnoone123',
        'abc123abc123',
        'passw0rd1234',
        'password!1234',
        'qwerty!123456',
    ];

    public static function validate(string $password): ?string
    {
        $length = preg_match_all('/./us', $password);
        if ($length === false) {
            return 'Password must be valid UTF-8.';
        }
        if ($length < 12 || $length > 128) {
            return 'Password must be between 12 and 128 characters.';
        }

        if (in_array(strtolower($password), self::COMMON_PASSWORDS, true)) {
            return 'Choose a less common password.';
        }

        if (self::isBreached($password)) {
            return 'This password appears in known data breaches. Choose another password.';
        }

        return null;
    }

    private static function isBreached(string $password): bool
    {
        if (!function_exists('curl_init')) {
            error_log('[CampusRoom] HIBP password check skipped: ext-curl is unavailable.');
            return false;
        }

        $hash = strtoupper(sha1($password));
        $prefix = substr($hash, 0, 5);
        $suffix = substr($hash, 5);
        $curl = curl_init('https://api.pwnedpasswords.com/range/' . $prefix);
        curl_setopt_array($curl, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT_MS => 1000,
            CURLOPT_TIMEOUT_MS => 2000,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => ['Add-Padding: true'],
        ]);
        $response = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $error = curl_error($curl);
        curl_close($curl);

        if (!is_string($response) || $status !== 200) {
            error_log('[CampusRoom] HIBP password check unavailable: ' . ($error !== '' ? $error : 'HTTP ' . $status));
            return false;
        }

        foreach (preg_split('/\r?\n/', $response) ?: [] as $line) {
            [$candidate, $count] = array_pad(explode(':', trim($line), 2), 2, '');
            if ($candidate !== '' && hash_equals($suffix, strtoupper($candidate)) && (int) $count > 0) {
                return true;
            }
        }

        return false;
    }
}
