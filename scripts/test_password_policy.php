<?php

declare(strict_types=1);

require __DIR__ . '/../src/Core/PasswordPolicy.php';

use CampusRoom\Core\PasswordPolicy;

$_ENV['ALLOWED_EMAIL_DOMAIN'] = 'bpu.edu.ph';

$context = [
    'school_id' => '20269999',
    'full_name' => 'Maria Santos',
    'email' => 'maria.santos@bpu.edu.ph',
];
$valid15 = 'quiet river orbit';
$validEmoji = implode('', [
    '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🙂', '🙃', '😉',
    '😊', '😇', '🥰', '😍', '🤩',
]);
$nonStringCodes = static function (mixed $value) use ($context): array {
    return is_string($value)
        ? PasswordPolicy::validateAll($value, $context, checkBreached: false)
        : ['invalid_input'];
};

$cases = [
    '14 random letters' => [str_repeat('qR8!xM3vP6zT2k', 1), ['too_short']],
    '15 characters with internal spaces' => [$valid15, []],
    '128 characters' => [str_repeat('a', 127) . 'b', []],
    '129 characters' => [str_repeat('a', 128) . 'b', ['too_long']],
    'leading space' => [' ' . $valid15, ['whitespace_edges']],
    'trailing tab' => [$valid15 . "\t", ['whitespace_edges']],
    'single repeated character' => ['aaaaaaaaaaaaaaa', ['repetitive']],
    'ascending sequence' => ['abcdefghijklmno', ['repetitive']],
    'repeated block' => ['abcabcabcabcabc', ['repetitive']],
    'student ID included' => ['my-20269999-passphrase', ['contains_personal']],
    'name token included' => ['blue-santos-river-table', ['contains_personal']],
    'email domain label included' => ['blue-bpu-river-table-xx', ['contains_personal']],
    'common password' => ['correcthorsebatterystaple', ['common']],
    '15 emoji code points' => [$validEmoji, []],
    'invalid UTF-8 bytes' => ["\xFF", ['invalid_input']],
    'empty string' => ['', ['too_short']],
];

$passed = 0;
$failed = 0;
foreach ($cases as $name => [$password, $expected]) {
    $actual = PasswordPolicy::validateAll($password, $context, checkBreached: false);
    if ($actual === $expected) {
        ++$passed;
        fwrite(STDOUT, "PASS: {$name}\n");
    } else {
        ++$failed;
        fwrite(
            STDERR,
            'FAIL: ' . $name . '; expected [' . implode(', ', $expected)
            . '], received [' . implode(', ', $actual) . ']' . PHP_EOL
        );
    }
}

$nonStringResult = $nonStringCodes(123);
if ($nonStringResult === ['invalid_input']) {
    ++$passed;
    fwrite(STDOUT, "PASS: non-string controller input\n");
} else {
    ++$failed;
    fwrite(STDERR, "FAIL: non-string controller input\n");
}

fwrite(STDOUT, "Result: {$passed} passed, {$failed} failed.\n");
exit($failed === 0 ? 0 : 1);
