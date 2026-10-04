<?php
require __DIR__ . '/vendor/autoload.php';
use Dotenv\Dotenv;
$dotenv = Dotenv::createImmutable(__DIR__);
$dotenv->safeLoad();
$db = \CampusRoom\Core\Database::getInstance()->getPdo();
$db->exec("ALTER TABLE Users ADD COLUMN account_type VARCHAR(50) DEFAULT NULL");
echo "Added account_type column to Users table.\n";
