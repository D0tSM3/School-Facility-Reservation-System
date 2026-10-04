<?php
require_once __DIR__ . '/vendor/autoload.php';
$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();

$dsn = sprintf(
    'pgsql:host=%s;port=%s;dbname=%s;sslmode=require',
    $_ENV['DB_HOST'],
    $_ENV['DB_PORT'],
    $_ENV['DB_NAME']
);
$pdo = new PDO($dsn, $_ENV['DB_USER'], $_ENV['DB_PASSWORD'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

$custId = $pdo->query("SELECT user_id FROM Users WHERE role = 'Customer' LIMIT 1")->fetchColumn();
$roomId = $pdo->query("SELECT room_id FROM Rooms LIMIT 1")->fetchColumn();

require_once __DIR__ . "/src/Core/Auth.php";
CampusRoom\Core\Auth::login($custId, 'Customer');

$_SERVER['REQUEST_METHOD'] = 'POST';
$_SERVER['REQUEST_URI'] = '/api/reservations';
$_SERVER['CONTENT_TYPE'] = 'application/json';

$payload = [
    'room_id' => $roomId,
    'purpose' => 'Test Reservation',
    'category' => 'Academic Lecture',
    'start_time' => '2026-10-10T10:00:00',
    'end_time' => '2026-10-10T11:00:00',
    'equipment_notes' => 'Standard Academic Setup'
];

// Instead of php://memory, replace php://input in the Controller
file_put_contents('test_payload.json', json_encode($payload));
