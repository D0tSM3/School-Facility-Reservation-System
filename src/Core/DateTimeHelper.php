<?php

declare(strict_types=1);

namespace CampusRoom\Core;

/**
 * DateTimeHelper — one canonical datetime shape for everything that enters
 * the application.
 *
 * The browser sends '2026-09-21T13:00:00' (booking.js) or
 * '2026-09-21 13:00:00' (move form). MySQL tolerates both on INSERT, but PHP
 * string comparisons between a request value and a stored value would not.
 * Controllers call these once, right after reading the request, so the
 * validator, repositories and DB triggers only ever see 'Y-m-d H:i:s'.
 *
 * Deliberately stricter than a bare strtotime():
 *   - strtotime() accepts words ("now", "tomorrow", "next monday");
 *   - strtotime() silently rolls impossible dates forward, so 2026-02-30
 *     becomes 2026-03-02 and a customer would book a day they never chose.
 */
final class DateTimeHelper
{
    /** YYYY-MM-DD, 'T' or space, HH:MM[:SS[.fff]], optional Z / +08:00 / +0800. */
    private const DATETIME_PATTERN =
        '/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?$/D';

    private const DATE_PATTERN = '/^(\d{4})-(\d{2})-(\d{2})$/D';

    /**
     * Normalise a client datetime to 'Y-m-d H:i:s' in the application
     * timezone, or return null if it is not a real datetime.
     *
     * A value with no zone designator is treated as local (application
     * timezone) wall-clock time, which is what both JS senders produce.
     * A value that carries a zone (Z, +08:00) is converted into it.
     */
    public static function toMysqlDateTime(string $value): ?string
    {
        $value = trim($value);

        if (preg_match(self::DATETIME_PATTERN, $value, $m) !== 1) {
            return null;
        }

        // Reject what strtotime() would silently "fix" (see class comment).
        if (
            !checkdate((int) $m[2], (int) $m[3], (int) $m[1])
            || (int) $m[4] > 23
            || (int) $m[5] > 59
            || (int) ($m[6] ?? 0) > 59
        ) {
            return null;
        }

        $ts = strtotime($value);
        return $ts === false ? null : date('Y-m-d H:i:s', $ts);
    }

    /**
     * Validate a plain calendar date ('YYYY-MM-DD') and return it unchanged,
     * or null. For endpoints that take a day, not a moment.
     */
    public static function toMysqlDate(string $value): ?string
    {
        $value = trim($value);

        if (
            preg_match(self::DATE_PATTERN, $value, $m) !== 1
            || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])
        ) {
            return null;
        }

        return $value;
    }
}
