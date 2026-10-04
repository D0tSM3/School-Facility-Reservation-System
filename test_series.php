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

$db->query("DELETE FROM Reservations WHERE purpose = 'Test 500 Series'");

$controller = new TestController();
$controller->mockJson = json_encode([
    'room_id' => $roomId,
    'purpose' => 'Test 500 Series',
    'category' => 'Academic Lecture',
    'start_time' => '2026-10-18 09:00:00',
    'end_time' => '2026-10-19 11:00:00', // 18 and 19
    'equipment_notes' => '',
    'active_dates' => ['2026-10-18', '2026-10-19']
]);

try {
    ob_start();
    $controller->store();
    $out = ob_get_clean();
    echo "Output: $out\n";
} catch (Exception $e) {
    echo "Exception: " . $e->getMessage() . "\n" . $e->getTraceAsString();
} catch (Error $e) {
    echo "Error: " . $e->getMessage() . "\n" . $e->getTraceAsString();
}
