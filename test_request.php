<?php
require __DIR__ . '/vendor/autoload.php';

use Dotenv\Dotenv;
$dotenv = Dotenv::createImmutable(__DIR__);
$dotenv->safeLoad();

// Let's just instantiate the controller and call store directly?
// Actually, it's easier to use curl if the server is running, or we can just mock the request.
