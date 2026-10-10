<?php

declare(strict_types=1);

namespace CampusRoom\Core;

final class PasswordPolicy
{
    public const MIN_LENGTH = 15;
    public const MAX_LENGTH = 128;

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

    private const MESSAGES = [
        'invalid_input' => 'Enter a valid password.',
        'too_short' => 'Password must be at least 15 characters.',
        'too_long' => 'Password must be 128 characters or fewer.',
        'whitespace_edges' => 'Password must not start or end with whitespace.',
        'repetitive' => 'Avoid repeated or sequential characters.',
        'contains_personal' => 'Password must not contain personal information.',
        'common' => 'Choose a less common password.',
        'breached' => 'This password appears in known data breaches. Choose another password.',
    ];

    /**
     * @param array{school_id?: string, full_name?: string, email?: string} $context
     * @return list<string>
     */
    public static function validateAll(string $password, array $context = [], bool $checkBreached = true): array
    {
        if (preg_match('//u', $password) !== 1) {
            return ['invalid_input'];
        }

        $characters = preg_match_all('/./us', $password, $matches) === false
            ? []
            : $matches[0];
        $length = count($characters);
        $codes = [];

        if ($length < self::MIN_LENGTH) {
            $codes[] = 'too_short';
        }
        if ($length > self::MAX_LENGTH) {
            $codes[] = 'too_long';
        }
        if (self::hasWhitespaceEdges($password)) {
            $codes[] = 'whitespace_edges';
        }
        if (self::isRepetitive($characters)) {
            $codes[] = 'repetitive';
        }
        if (self::containsPersonalInformation($password, $context)) {
            $codes[] = 'contains_personal';
        }
        if (in_array(self::lower($password), self::COMMON_PASSWORDS, true)) {
            $codes[] = 'common';
        }

        if ($codes === [] && $checkBreached && self::isBreached($password)) {
            $codes[] = 'breached';
        }

        return $codes;
    }

    public static function validate(string $password): ?string
    {
        $codes = self::validateAll($password);
        return $codes === [] ? null : self::MESSAGES[$codes[0]];
    }

    public static function hasWhitespaceEdges(string $password): bool
    {
        return preg_match('/(?:\A[\s\p{Z}]|[\s\p{Z}]\z)/u', $password) === 1;
    }

    private static function containsPersonalInformation(string $password, array $context): bool
    {
        $candidate = self::lower($password);
        $personal = [];
        foreach (['school_id', 'full_name', 'email'] as $key) {
            if (isset($context[$key]) && is_string($context[$key])) {
                $personal[$key] = self::lower($context[$key]);
            }
        }

        if (($personal['school_id'] ?? '') !== ''
            && str_contains($candidate, $personal['school_id'])) {
            return true;
        }

        $name = $personal['full_name'] ?? '';
        foreach (preg_split('/[^\p{L}\p{N}]+/u', $name, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $token) {
            if (self::codePointLength($token) >= 4 && str_contains($candidate, $token)) {
                return true;
            }
        }

        $email = $personal['email'] ?? '';
        $at = strrpos($email, '@');
        if ($at !== false) {
            $localPart = substr($email, 0, $at);
            if (self::codePointLength($localPart) >= 4 && str_contains($candidate, $localPart)) {
                return true;
            }
        }

        $domain = strtolower((string) ($_ENV['ALLOWED_EMAIL_DOMAIN'] ?? getenv('ALLOWED_EMAIL_DOMAIN') ?: ''));
        $domain = ltrim($domain, '@');
        $domainLabel = explode('.', $domain, 2)[0] ?? '';
        if ($domainLabel !== '' && str_contains($candidate, $domainLabel)) {
            return true;
        }

        return str_contains($candidate, 'campusroom');
    }

    /**
     * @param list<string> $characters
     */
    private static function isRepetitive(array $characters): bool
    {
        $length = count($characters);
        if ($length < 5) {
            return false;
        }

        if (count(array_unique($characters)) === 1) {
            return true;
        }

        for ($blockLength = 1; $blockLength <= intdiv($length, 2); $blockLength++) {
            if ($length % $blockLength !== 0) {
                continue;
            }
            $block = array_slice($characters, 0, $blockLength);
            $repeated = true;
            for ($offset = $blockLength; $offset < $length; $offset += $blockLength) {
                if (array_slice($characters, $offset, $blockLength) !== $block) {
                    $repeated = false;
                    break;
                }
            }
            if ($repeated) {
                return true;
            }
        }

        $folded = array_map(static fn(string $character): string => strtolower($character), $characters);
        $runs = ['abcdefghijklmnopqrstuvwxyz', '0123456789'];
        foreach ($runs as $run) {
            $runCharacters = str_split($run);
            for ($start = 0; $start <= count($folded) - 5; $start++) {
                foreach ([1, -1] as $direction) {
                    $isRun = true;
                    for ($offset = 0; $offset < 5; $offset++) {
                        $index = array_search($folded[$start + $offset], $runCharacters, true);
                        if ($index === false || ($offset > 0 && $index !== $previousIndex + $direction)) {
                            $isRun = false;
                            break;
                        }
                        $previousIndex = $index;
                    }
                    if ($isRun) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    private static function codePointLength(string $value): int
    {
        $length = preg_match_all('/./us', $value);
        return $length === false ? 0 : $length;
    }

    private static function lower(string $value): string
    {
        return function_exists('mb_strtolower') ? mb_strtolower($value, 'UTF-8') : strtolower($value);
    }

    private static function isBreached(string $password): bool
    {
        if (!function_exists('curl_init')) {
            error_log('[CampusRoom] HIBP password check unavailable; continuing without breach lookup.');
            return false;
        }

        $hash = strtoupper(sha1($password));
        $prefix = substr($hash, 0, 5);
        $suffix = substr($hash, 5);
        $curl = curl_init('https://api.pwnedpasswords.com/range/' . $prefix);
        if ($curl === false) {
            error_log('[CampusRoom] HIBP password check unavailable; continuing without breach lookup.');
            return false;
        }

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
        curl_close($curl);

        if (!is_string($response) || $status !== 200) {
            error_log('[CampusRoom] HIBP password check failed; continuing without breach lookup.');
            return false;
        }

        foreach (preg_split('/\r?\n/', $response) ?: [] as $line) {
            [$candidate, $count] = array_pad(explode(':', trim($line), 2), 2, '');
            if ($candidate !== ''
                && hash_equals($suffix, strtoupper($candidate))
                && (int) $count > 0) {
                return true;
            }
        }

        return false;
    }
}
