<?php
require __DIR__ . '/vendor/autoload.php';

use Dotenv\Dotenv;
$dotenv = Dotenv::createImmutable(__DIR__);
$dotenv->safeLoad();

$db = \CampusRoom\Core\Database::getInstance();
$userId = $db->query("SELECT user_id FROM Users WHERE role='Customer' LIMIT 1")->fetchColumn();
var_dump($userId);
