<?php
/**
 * Regression: password policy requires at least 15 characters and forbids
 * ANY whitespace (no spaces anywhere) — enforced for new-account activation
 * and password reset alike (both call PasswordPolicy::validateAll()).
 *
 * Exercises the REAL PasswordPolicy (checkBreached=false to stay offline).
 * Run:  php tests/php/password_policy.test.php
 */
declare(strict_types=1);

require __DIR__ . '/../../src/Core/PasswordPolicy.php';
use CampusRoom\Core\PasswordPolicy;

$pass = 0; $fail = 0;
function check(string $label, bool $cond): void {
    global $pass, $fail;
    if ($cond) { $pass++; echo "  ok   $label\n"; }
    else { $fail++; echo "  FAIL $label\n"; }
}

check('MIN_LENGTH is 15', PasswordPolicy::MIN_LENGTH === 15);

// A space anywhere -> 'no_spaces'
$codes = PasswordPolicy::validateAll('Umbrella Falcon 9x', [], false);
check('internal space flagged no_spaces', in_array('no_spaces', $codes, true));

// Leading/trailing space -> still no_spaces
check('edge space flagged no_spaces',
    in_array('no_spaces', PasswordPolicy::validateAll(' Umbrella7Falcon9x', [], false), true));

// Too short (<15) -> too_short
check('short password flagged too_short',
    in_array('too_short', PasswordPolicy::validateAll('Short7x', [], false), true));

// containsWhitespace helper
check('containsWhitespace true for a space', PasswordPolicy::containsWhitespace('a b') === true);
check('containsWhitespace false without space', PasswordPolicy::containsWhitespace('abcdef') === false);

// A clean 15+ char, space-free, non-trivial password passes (offline)
$clean = PasswordPolicy::validateAll('Umbrella7Falcon9x', [], false);
check('valid space-free 17-char password has no codes', $clean === []);

// The user-facing message for a spaced password mentions spaces
check('message mentions spaces', PasswordPolicy::validate('bad password here') === 'Password must not contain spaces.');

echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
