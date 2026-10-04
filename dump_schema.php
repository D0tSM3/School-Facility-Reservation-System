<?php
require __DIR__ . '/vendor/autoload.php';

use Dotenv\Dotenv;
$dotenv = Dotenv::createImmutable(__DIR__);
$dotenv->safeLoad();

$db = \CampusRoom\Core\Database::getInstance();
$stmt = $db->query("SELECT column_name, column_default, data_type FROM information_schema.columns WHERE table_name = 'reservations'");
print_r($stmt->fetchAll(PDO::FETCH_ASSOC));
