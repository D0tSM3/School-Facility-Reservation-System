<?php
require 'vendor/autoload.php';
$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();

$dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s;sslmode=require', $_ENV['DB_HOST'], $_ENV['DB_PORT'], $_ENV['DB_NAME']);
$pdo = new PDO($dsn, $_ENV['DB_USER'], $_ENV['DB_PASSWORD'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

$pdo->exec("INSERT INTO system_settings (setting_key, setting_value, updated_by, updated_at) VALUES ('closed_days', '', 'SYSTEM', NOW()) ON CONFLICT (setting_key) DO UPDATE SET setting_value = ''");
echo "Closed days cleared.\n";
