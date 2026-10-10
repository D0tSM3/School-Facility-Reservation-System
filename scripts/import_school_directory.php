<?php

declare(strict_types=1);

use CampusRoom\Core\Database;
use Dotenv\Dotenv;

define('BASE_DIR', dirname(__DIR__));
require BASE_DIR . '/vendor/autoload.php';

$dotenv = Dotenv::createImmutable(BASE_DIR);
$dotenv->safeLoad();
foreach (getenv() as $key => $value) {
    $_ENV[$key] ??= $value;
}

$arguments = array_slice($argv, 1);
$apply = in_array('--apply', $arguments, true);
$dryRun = in_array('--dry-run', $arguments, true);
$paths = array_values(array_filter($arguments, static fn($argument) => !str_starts_with($argument, '--')));
$unknownOptions = array_filter(
    $arguments,
    static fn($argument) => str_starts_with($argument, '--') && !in_array($argument, ['--apply', '--dry-run'], true)
);
if ($apply === $dryRun || count($paths) !== 1 || $unknownOptions !== []) {
    fwrite(STDERR, "Usage: php scripts/import_school_directory.php [--dry-run|--apply] roster.csv\n");
    exit(2);
}

$csvPath = $paths[0];
if ($csvPath === null || !is_file($csvPath) || !is_readable($csvPath)) {
    fwrite(STDERR, "Provide a readable CSV file.\n");
    exit(2);
}

$domain = strtolower(ltrim(trim((string) ($_ENV['ALLOWED_EMAIL_DOMAIN'] ?? '')), '@'));
if ($domain === '') {
    fwrite(STDERR, "ALLOWED_EMAIL_DOMAIN must be configured.\n");
    exit(2);
}

$handle = fopen($csvPath, 'rb');
if ($handle === false) {
    fwrite(STDERR, "Unable to open CSV file.\n");
    exit(2);
}

$headers = fgetcsv($handle);
$requiredHeaders = ['school_id', 'full_name', 'email', 'person_type'];
if (!is_array($headers)) {
    fclose($handle);
    fwrite(STDERR, "CSV is empty or has no header row.\n");
    exit(2);
}
$headers = array_map(static fn($header) => strtolower(trim((string) $header)), $headers);
if (array_diff($requiredHeaders, $headers) !== []) {
    fclose($handle);
    fwrite(STDERR, "CSV must include school_id, full_name, email, and person_type columns.\n");
    exit(2);
}

$indexes = array_flip($headers);
$rows = [];
$schoolIds = [];
$emails = [];
$errors = [];
$line = 1;
while (($values = fgetcsv($handle)) !== false) {
    $line++;
    if ($values === [null] || $values === []) {
        continue;
    }

    $row = [];
    foreach ($requiredHeaders as $column) {
        $row[$column] = trim((string) ($values[$indexes[$column]] ?? ''));
    }
    $studentId = $row['school_id'];
    $email = strtolower($row['email']);
    $at = strrpos($email, '@');

    $validId = preg_match('/^(19|20)\d{6}$/', $studentId) === 1
        && (int) substr($studentId, 0, 4) <= (int) date('Y');
    $validEmail = filter_var($email, FILTER_VALIDATE_EMAIL) !== false
        && $at !== false
        && hash_equals($domain, substr($email, $at + 1));
    if (!$validId || $row['full_name'] === '' || strlen($row['full_name']) > 200
        || !$validEmail || $row['person_type'] === '' || strlen($row['person_type']) > 32) {
        $errors[] = "Line {$line}: invalid student ID, name, institutional email, or person type.";
        continue;
    }
    if (isset($schoolIds[$studentId]) || isset($emails[$email])) {
        $errors[] = "Line {$line}: duplicate student ID or email.";
        continue;
    }

    $schoolIds[$studentId] = true;
    $emails[$email] = true;
    $rows[] = $row;
}
fclose($handle);

if ($rows === []) {
    $errors[] = 'CSV contains no valid roster rows.';
}
if ($errors !== []) {
    fwrite(STDERR, implode(PHP_EOL, $errors) . PHP_EOL);
    exit(1);
}

$pdo = Database::getInstance()->getPdo();
$queryCurrent = static function () use ($pdo): array {
    $stmt = $pdo->query('SELECT school_id FROM public.school_directory WHERE is_current IS TRUE');
    return array_map('strval', $stmt->fetchAll(PDO::FETCH_COLUMN));
};

$currentIds = $queryCurrent();
$incomingIds = array_keys($schoolIds);
$removals = count(array_diff($currentIds, $incomingIds));
$removalPercent = $currentIds === [] ? 0.0 : ($removals / count($currentIds)) * 100;
printf(
    "CSV rows: %d; current rows: %d; rows to deactivate: %d (%.2f%%).\n",
    count($rows),
    count($currentIds),
    $removals,
    $removalPercent
);

if ($removalPercent > 20.0) {
    fwrite(STDERR, "Safety rail: import would deactivate more than 20% of the current roster; aborting.\n");
    exit(1);
}
if (!$apply) {
    fwrite(STDOUT, "Dry run only; no roster rows were changed. Use --apply to import.\n");
    exit(0);
}

$pdo->beginTransaction();
try {
    $pdo->exec("SET LOCAL lock_timeout = '5s'");
    $pdo->exec('LOCK TABLE public.school_directory IN SHARE ROW EXCLUSIVE MODE');
    $lock = $pdo->query(
        'SELECT school_id FROM public.school_directory WHERE is_current IS TRUE FOR UPDATE'
    );
    $lockedIds = array_map('strval', $lock->fetchAll(PDO::FETCH_COLUMN));
    $lockedRemovals = count(array_diff($lockedIds, $incomingIds));
    $lockedPercent = $lockedIds === [] ? 0.0 : ($lockedRemovals / count($lockedIds)) * 100;
    if ($lockedPercent > 20.0) {
        throw new RuntimeException('Safety rail: current roster changed and would lose more than 20%.');
    }

    $pdo->exec(
        'CREATE TEMPORARY TABLE incoming_school_directory (
            school_id varchar(64) PRIMARY KEY,
            full_name varchar(200) NOT NULL,
            email varchar(254) NOT NULL UNIQUE,
            person_type varchar(32) NOT NULL
        ) ON COMMIT DROP'
    );
    $stage = $pdo->prepare(
        'INSERT INTO incoming_school_directory (school_id, full_name, email, person_type)
         VALUES (:school_id, :full_name, :email, :person_type)'
    );
    foreach ($rows as $row) {
        $stage->execute([
            ':school_id' => $row['school_id'],
            ':full_name' => $row['full_name'],
            ':email' => strtolower($row['email']),
            ':person_type' => $row['person_type'],
        ]);
    }

    $pdo->exec(
        'INSERT INTO public.school_directory (school_id, full_name, email, person_type, is_current, synced_at)
         SELECT school_id, full_name, email, person_type, TRUE, CURRENT_TIMESTAMP
           FROM incoming_school_directory
         ON CONFLICT (school_id) DO UPDATE
           SET full_name = EXCLUDED.full_name,
               email = EXCLUDED.email,
               person_type = EXCLUDED.person_type,
               is_current = TRUE,
               synced_at = CURRENT_TIMESTAMP'
    );
    $pdo->exec(
        'UPDATE public.school_directory AS roster
            SET is_current = FALSE,
                synced_at = CURRENT_TIMESTAMP
          WHERE roster.is_current IS TRUE
            AND NOT EXISTS (
                SELECT 1
                  FROM incoming_school_directory AS incoming
                 WHERE incoming.school_id = roster.school_id
            )'
    );
    $pdo->commit();
    fwrite(STDOUT, "Roster import committed successfully.\n");
} catch (Throwable $error) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('[CampusRoom] roster import failed: ' . $error->getMessage());
    fwrite(STDERR, "Roster import failed; no changes were committed.\n");
    exit(1);
}
