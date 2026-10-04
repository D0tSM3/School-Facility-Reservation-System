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

$controller = new TestController();
$controller->mockJson = json_encode([
    'room_id' => $roomId,
    'purpose' => 'Test 500 Override',
    'category' => 'Academic Lecture',
    'start_time' => '2026-10-16 09:00:00', // This conflicts with the one we just created
    'end_time' => '2026-10-16 11:00:00',
    'equipment_notes' => '',
    'reason' => 'Emergency Override'
]);

try {
    ob_start();
    $controller->requestOverride();
    $out = ob_get_clean();
    echo "Output: $out\n";
} catch (Exception $e) {
    echo "Exception: " . $e->getMessage() . "\n" . $e->getTraceAsString();
} catch (Error $e) {
    echo "Error: " . $e->getMessage() . "\n" . $e->getTraceAsString();
}
