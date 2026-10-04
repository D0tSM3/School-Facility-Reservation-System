<?php
require_once __DIR__ . "/src/Utils/Uuid.php";
require_once __DIR__ . "/src/Core/Auth.php";
require_once __DIR__ . "/src/Core/Database.php";
require_once __DIR__ . "/src/Repository/ReservationRepository.php";
require_once __DIR__ . "/src/Validator/ReservationValidator.php";
require_once __DIR__ . "/src/Controller/ReservationController.php";

$_SERVER['REQUEST_METHOD'] = 'POST';
$_SERVER['REQUEST_URI'] = '/api/reservations';
$_SERVER['CONTENT_TYPE'] = 'application/json';

$payload = [
    'room_id' => 'A101',
    'purpose' => 'Test',
    'category' => 'Academic Lecture',
    'start_time' => '2026-10-10T10:00:00',
    'end_time' => '2026-10-10T11:00:00',
    'equipment_notes' => 'Test'
];

file_put_contents("php://memory", json_encode($payload));
// Wait, file_get_contents('php://input') is what jsonBody() uses.
// I'll just mock Auth
CampusRoom\Core\Auth::login('admin', 'Customer');

try {
    (new CampusRoom\Controller\ReservationController())->store();
} catch (Throwable $e) {
    echo "ERROR: " . $e->getMessage() . "\n";
    echo $e->getTraceAsString();
}
