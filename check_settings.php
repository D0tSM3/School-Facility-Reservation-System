<?php
require_once __DIR__ . '/vendor/autoload.php';
$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();
$dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s;sslmode=require', $_ENV['DB_HOST'], $_ENV['DB_PORT'], $_ENV['DB_NAME']);
$pdo = new PDO($dsn, $_ENV['DB_USER'], $_ENV['DB_PASSWORD'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

$stmt = $pdo->query("SELECT setting_value FROM SystemSettings WHERE setting_key = 'closed_days'");
echo $stmt->fetchColumn();
