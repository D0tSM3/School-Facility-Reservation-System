<?php try { $pdo = new PDO('mysql:host=127.0.0.1;port=3306;dbname=campusroom', 'root', ''); echo 'OK'; } catch (Exception $e) { echo $e->getMessage(); }
