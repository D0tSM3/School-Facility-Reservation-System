<?php
require_once __DIR__ . '/vendor/autoload.php';
$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();
require_once __DIR__ . '/src/Core/ReservationValidator.php';
use CampusRoom\Core\ReservationValidator;

// Test 1: Past time
$roomId = "12345678-1234-1234-1234-123456789012"; // Fake room ID is fine for syntax check
$start = date('Y-m-d H:i:s', time() - 3600); // 1 hour ago
$end = date('Y-m-d H:i:s', time() + 3600);

echo "Test 1: " . (ReservationValidator::check($roomId, $start, $end) ?? "Valid") . "\n";

// Test 2: Future time
$start2 = date('Y-m-d H:i:s', time() + 3600);
$end2 = date('Y-m-d H:i:s', time() + 7200);
// We expect "The selected room does not exist" because room is fake, but it should PASS the past-time check.
echo "Test 2: " . (ReservationValidator::check($roomId, $start2, $end2) ?? "Valid") . "\n";
