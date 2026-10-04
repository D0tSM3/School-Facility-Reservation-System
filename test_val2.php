<?php
require_once __DIR__ . '/vendor/autoload.php';
$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();
require_once __DIR__ . '/src/Core/ReservationValidator.php';
use CampusRoom\Core\ReservationValidator;

$dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s;sslmode=require', $_ENV['DB_HOST'], $_ENV['DB_PORT'], $_ENV['DB_NAME']);
$pdo = new PDO($dsn, $_ENV['DB_USER'], $_ENV['DB_PASSWORD'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

$roomId = $pdo->query("SELECT room_id FROM Rooms LIMIT 1")->fetchColumn();

// Test 1: Past time
$start = date('Y-m-d H:i:s', time() - 3600); // 1 hour ago
$end = date('Y-m-d H:i:s', time() + 3600);
echo "Test 1: " . (ReservationValidator::check($roomId, $start, $end) ?? "Valid") . "\n";

// Test 2: Future time
$start2 = date('Y-m-d H:i:s', time() + 86400 * 2); // 2 days from now
$end2 = date('Y-m-d H:i:s', time() + 86400 * 2 + 3600);
echo "Test 2: " . (ReservationValidator::check($roomId, $start2, $end2) ?? "Valid") . "\n";
