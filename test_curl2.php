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

session_id('testsession123');
session_start();
$_SESSION['user_id'] = $custId;
$_SESSION['role'] = 'Customer';
session_write_close();

$payload = [
    'room_id' => $roomId,
    'purpose' => 'Test Reservation',
    'category' => 'Academic Lecture',
    'start_time' => '2027-10-10T10:00:00',
    'end_time' => '2027-10-10T11:00:00',
    'equipment_notes' => 'Standard Academic Setup',
    'booking_mode' => 'single'
];

$ch = curl_init('http://localhost:8000/api/reservations');
curl_setopt($ch, CURLOPT_POST, 1);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_COOKIE, 'PHPSESSID=testsession123');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

$response = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

echo "HTTP STATUS: $status\n";
echo "RESPONSE: $response\n";
