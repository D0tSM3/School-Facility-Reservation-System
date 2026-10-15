<?php
/**
 * Regression: an empty / whitespace-only purpose must route a booking to
 * Pending (manual review), never auto-approve. This exercises the REAL
 * ReservationController::approvalOutcome() method body — not a re-implementation.
 *
 * The empty-purpose branch returns before approvalOutcome touches the database
 * (no RoomRepository / PDO call), so the method can be invoked offline via
 * reflection on an instance built without the (DB-connecting) constructor.
 *
 * Run:  php tests/php/approval_outcome.test.php
 */
declare(strict_types=1);

require __DIR__ . '/../../vendor/autoload.php';

use CampusRoom\Controller\ReservationController;

$pass = 0; $fail = 0;
function eq(string $label, $got, $want): void {
    global $pass, $fail;
    if ($got === $want) { $pass++; echo "  ok   $label\n"; }
    else { $fail++; echo "  FAIL $label\n       got:  " . var_export($got, true) . "\n       want: " . var_export($want, true) . "\n"; }
}

$ref = new ReflectionClass(ReservationController::class);
// Skip the constructor (it opens a DB connection via ReservationRepository);
// the empty-purpose path we test never dereferences $this->reservations.
$controller = $ref->newInstanceWithoutConstructor();
$method = $ref->getMethod('approvalOutcome');
$method->setAccessible(true);

$roomId = '00000000-0000-0000-0000-000000000000';

// Empty purpose -> Pending/manual (the fix's core contract).
eq('empty purpose -> Pending/manual',
   $method->invoke($controller, $roomId, 1, ''),
   ['Pending', 'manual']);

// Whitespace-only purpose is treated as empty.
eq('whitespace purpose -> Pending/manual',
   $method->invoke($controller, $roomId, 1, "   \t  "),
   ['Pending', 'manual']);

// A booking is never auto-approved solely because purpose was left blank.
$blank = $method->invoke($controller, $roomId, 1, '');
eq('blank purpose is NOT auto-approved', $blank[0] === 'Approved', false);

echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
