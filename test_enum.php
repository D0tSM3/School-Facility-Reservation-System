<?php
require __DIR__ . '/vendor/autoload.php';

use Dotenv\Dotenv;
$dotenv = Dotenv::createImmutable(__DIR__);
$dotenv->safeLoad();

$db = \CampusRoom\Core\Database::getInstance();
$roomId = $db->query("SELECT room_id FROM Rooms LIMIT 1")->fetchColumn();
$userId = $db->query("SELECT user_id FROM Users WHERE role='Customer' LIMIT 1")->fetchColumn();

// generate random uuid
$uuid = sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
    mt_rand(0, 0xffff), mt_rand(0, 0xffff),
    mt_rand(0, 0xffff),
    mt_rand(0, 0x0fff) | 0x4000,
    mt_rand(0, 0x3fff) | 0x8000,
    mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
);

try {
    $db->query(
        'INSERT INTO Reservations (reservation_id, customer_id, room_id, purpose, category, equipment_notes, start_time, end_time, series_id, status)
         VALUES (:reservation_id, :customer_id, :room_id, :purpose, :category, :equipment_notes, :start_time, :end_time, :series_id, :status)',
        [
            ':reservation_id'  => $uuid,
            ':customer_id'     => $userId,
            ':room_id'         => $roomId,
            ':purpose'         => 'Test',
            ':category'        => 'Academic Lecture',
            ':equipment_notes' => null,
            ':start_time'      => '2026-10-15 09:00:00',
            ':end_time'        => '2026-10-15 11:00:00',
            ':series_id'       => null,
            ':status'          => 'Approved',
        ]
    );
    echo "Success!";
} catch (PDOException $e) {
    echo "PDO Error: " . $e->getMessage();
}
