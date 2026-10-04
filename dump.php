<?php
require __DIR__ . '/vendor/autoload.php';

use Dotenv\Dotenv;
$dotenv = Dotenv::createImmutable(__DIR__);
$dotenv->safeLoad();

$db = \CampusRoom\Core\Database::getInstance();
$stmt = $db->query("SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'conflictoverriderequests'");
print_r($stmt->fetchAll(PDO::FETCH_ASSOC));
