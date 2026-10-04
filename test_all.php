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

class TestController extends \CampusRoom\Controller\ReservationController {
    public $mockJson;
    protected function jsonBody(): array {
        return json_decode($this->mockJson, true);
    }
}

// Ensure the table doesn't already have it
$db->query("DELETE FROM Reservations WHERE purpose = 'Test 500 Normal'");
$db->query("DELETE FROM ConflictOverrideRequests WHERE purpose = 'Test 500 Override'");

$controller = new TestController();
$controller->mockJson = json_encode([
    'room_id' => $roomId,
    'purpose' => 'Test 500 Normal',
    'category' => 'Academic Lecture',
    'start_time' => '2026-10-16 09:00:00',
    'end_time' => '2026-10-16 11:00:00',
    'equipment_notes' => ''
]);
try {
    ob_start();
    $controller->store();
    $out = ob_get_clean();
    echo "Output 1: $out\n";
} catch (Exception $e) {
    echo "Exception 1: " . $e->getMessage() . "\n" . $e->getTraceAsString();
} catch (Error $e) {
    echo "Error 1: " . $e->getMessage() . "\n" . $e->getTraceAsString();
}
