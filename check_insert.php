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

try {
    $stmt = $pdo->prepare("INSERT INTO Reservations (reservation_id, customer_id, room_id, purpose, category, equipment_notes, start_time, end_time, series_id) VALUES (:reservation_id, :customer_id, :room_id, :purpose, :category, :equipment_notes, :start_time, :end_time, :series_id)");
    
    // UUIDs
    $reservationId = '123e4567-e89b-12d3-a456-426614174000';
    // Get a real customer ID and room ID
    $custId = $pdo->query("SELECT user_id FROM Users WHERE role = 'Customer' LIMIT 1")->fetchColumn();
    $roomId = $pdo->query("SELECT room_id FROM Rooms LIMIT 1")->fetchColumn();

    if (!$custId || !$roomId) {
        die("Missing test data");
    }

    $stmt->execute([
        ':reservation_id' => $reservationId,
        ':customer_id' => $custId,
        ':room_id' => $roomId,
        ':purpose' => 'Test',
        ':category' => 'Academic Lecture',
        ':equipment_notes' => 'Test',
        ':start_time' => '2026-10-10 10:00:00',
        ':end_time' => '2026-10-10 11:00:00',
        ':series_id' => null
    ]);
    echo "Success!";
} catch (PDOException $e) {
    echo "ERROR: " . $e->getMessage();
}

