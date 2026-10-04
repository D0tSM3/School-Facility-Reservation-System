<?php
require __DIR__ . '/vendor/autoload.php';

use Dotenv\Dotenv;
$dotenv = Dotenv::createImmutable(__DIR__);
$dotenv->safeLoad();

session_start();
$db = \CampusRoom\Core\Database::getInstance();
$roomId = $db->query("SELECT room_id FROM Rooms LIMIT 1")->fetchColumn();
$userId = $db->query("SELECT user_id FROM Users WHERE role='Customer' LIMIT 1")->fetchColumn();

$_SESSION['user_id'] = $userId;
$_SESSION['role'] = 'Customer';

$json = json_encode([
    'room_id' => $roomId,
    'purpose' => 'Test 500',
    'category' => 'Academic Lecture',
    'start_time' => '2026-10-15 09:00:00',
    'end_time' => '2026-10-15 11:00:00',
    'equipment_notes' => ''
]);

class TestController extends \CampusRoom\Controller\ReservationController {
    public $mockJson;
    protected function jsonBody(): array {
        return json_decode($this->mockJson, true);
    }
}

$controller = new TestController();
$controller->mockJson = $json;
try {
    $controller->store();
} catch (Exception $e) {
    echo "Exception: " . $e->getMessage() . "\n" . $e->getTraceAsString();
} catch (Error $e) {
    echo "Error: " . $e->getMessage() . "\n" . $e->getTraceAsString();
}
