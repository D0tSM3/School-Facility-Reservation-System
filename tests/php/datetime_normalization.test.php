<?php
/**
 * Regression: a rebooking/booking datetime must persist on the SAME calendar
 * day the user submitted — no timezone drift. DateTimeHelper is the single
 * server-side normalization every reservation datetime passes through
 * (ReservationController::rebook / store call it right after reading the body).
 *
 * Pure unit test — no database. Run:
 *   php tests/php/datetime_normalization.test.php
 */
declare(strict_types=1);

// The app sets Asia/Manila in index.php; pin it here so the test is deterministic
// and actually exercises the UTC+8 boundary where a naive converter would slip.
date_default_timezone_set('Asia/Manila');

require __DIR__ . '/../../src/Core/DateTimeHelper.php';
use CampusRoom\Core\DateTimeHelper;

$pass = 0; $fail = 0;
function eq(string $label, $got, $want): void {
    global $pass, $fail;
    if ($got === $want) { $pass++; echo "  ok   $label\n"; }
    else { $fail++; echo "  FAIL $label\n       got:  " . var_export($got, true) . "\n       want: " . var_export($want, true) . "\n"; }
}

// Zone-less wall-clock (exactly what rebook.js sends: `${date}T${time}:00`) is
// kept on the same day and clock.
eq('original date preserved',        DateTimeHelper::toMysqlDateTime('2026-03-11T09:00:00'), '2026-03-11 09:00:00');
eq('a different valid date preserved', DateTimeHelper::toMysqlDateTime('2026-08-20T13:30:00'), '2026-08-20 13:30:00');

// Midnight-edge: the time a naive UTC converter would roll back to the previous
// day in Manila. Must stay on the submitted day.
eq('00:30 stays on the same day',    DateTimeHelper::toMysqlDateTime('2026-08-03T00:30:00'), '2026-08-03 00:30:00');
eq('23:30 stays on the same day',    DateTimeHelper::toMysqlDateTime('2026-10-17T23:30:00'), '2026-10-17 23:30:00');

// Semester boundary dates (Q1 AY2026-2027) round-trip unchanged.
eq('semester first day',             DateTimeHelper::toMysqlDateTime('2026-08-03T07:30:00'), '2026-08-03 07:30:00');
eq('semester last day',              DateTimeHelper::toMysqlDateTime('2026-10-17T12:00:00'), '2026-10-17 12:00:00');

// Impossible dates are rejected, never silently rolled forward.
eq('Feb 30 rejected',                DateTimeHelper::toMysqlDateTime('2026-02-30T09:00:00'), null);
eq('hour 24 rejected',               DateTimeHelper::toMysqlDateTime('2026-02-10T24:00:00'), null);

// A value that DOES carry a zone is converted into app time (documents intent):
// 2026-08-03T00:30:00+00:00 (UTC) -> 08:30 Manila, same day here.
eq('explicit +00:00 converted to Manila', DateTimeHelper::toMysqlDateTime('2026-08-03T00:30:00+00:00'), '2026-08-03 08:30:00');

echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
