<?php
require __DIR__ . '/vendor/autoload.php';
use Dotenv\Dotenv;
$dotenv = Dotenv::createImmutable(__DIR__);
$dotenv->safeLoad();
$db = \CampusRoom\Core\Database::getInstance()->getPdo();
$stmt = $db->query("SELECT column_name, data_type, character_maximum_length FROM information_schema.columns WHERE table_name = 'users'");
print_r($stmt->fetchAll(PDO::FETCH_ASSOC));
