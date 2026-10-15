<?php
/**
 * Regression: password policy requires 8 to 15 characters, forbids ANY
 * whitespace (no spaces anywhere), and requires an uppercase letter, a
 * lowercase letter, a number and a special character — enforced for
 * new-account activation and password reset alike (both call
 * PasswordPolicy::validateAll()).
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

check('MIN_LENGTH is 8', PasswordPolicy::MIN_LENGTH === 8);

// A space anywhere -> 'no_spaces'
$codes = PasswordPolicy::validateAll('Umbrella Falcon 9x!', [], false);
check('internal space flagged no_spaces', in_array('no_spaces', $codes, true));

// Leading/trailing space -> still no_spaces
check('edge space flagged no_spaces',
    in_array('no_spaces', PasswordPolicy::validateAll(' Umbrella7Falcon!x', [], false), true));

// Too short (<8) -> too_short
check('short password flagged too_short',
    in_array('too_short', PasswordPolicy::validateAll('Ab1!xy', [], false), true));

// Too long (>15) -> too_long
check('long password flagged too_long',
    in_array('too_long', PasswordPolicy::validateAll('Umbrella7Falcon!x', [], false), true));

// Complexity: missing each required class is flagged
check('missing uppercase flagged no_uppercase',
    in_array('no_uppercase', PasswordPolicy::validateAll('lowercase9!xy', [], false), true));
check('missing lowercase flagged no_lowercase',
    in_array('no_lowercase', PasswordPolicy::validateAll('UPPERCASE9!XY', [], false), true));
check('missing number flagged no_number',
    in_array('no_number', PasswordPolicy::validateAll('NoDigitsHere!', [], false), true));
check('missing special flagged no_special',
    in_array('no_special', PasswordPolicy::validateAll('NoSpecial9xy', [], false), true));

// containsWhitespace helper
check('containsWhitespace true for a space', PasswordPolicy::containsWhitespace('a b') === true);
check('containsWhitespace false without space', PasswordPolicy::containsWhitespace('abcdef') === false);

// A clean 8-15 char, space-free password meeting every class passes (offline)
$clean = PasswordPolicy::validateAll('Falcon7!xK', [], false);
check('valid 10-char password has no codes', $clean === []);

// The user-facing message for a spaced password mentions spaces (checked first)
check('message mentions spaces', PasswordPolicy::validate('bad pass!') === 'Password must not contain spaces.');

echo "\n$pass passed, $fail failed\n";
exit($fail ? 1 : 0);
