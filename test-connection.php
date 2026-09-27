<?php
require __DIR__ . '/vendor/autoload.php';
$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();

try {
    $pdo = \CampusRoom\Core\Database::getInstance()->getPdo();
    $stmt = $pdo->query('SELECT count(*) AS n FROM users');
    echo "Connected. Users table has " . $stmt->fetch()['n'] . " rows.\n";
} catch (\Throwable $e) {
    echo "Connection failed: " . get_class($e) . " — " . $e->getMessage() . "\n";
}