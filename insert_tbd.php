<?php
require 'vendor/autoload.php';
\ = Dotenv\Dotenv::createImmutable(__DIR__);
\->load();
\ = new PDO('mysql:host='.\['DB_HOST'].';dbname='.\['DB_NAME'], \['DB_USER'], \['DB_PASSWORD']);
\->exec("INSERT INTO Rooms (room_id, name, floor, room_type, capacity, is_active, status, created_at) VALUES ('tbd00000-0000-4000-8000-000000000000', 'To Be Determined', 0, 'TBD', 0, 1, 'Available', NOW())");
echo 'Inserted';
