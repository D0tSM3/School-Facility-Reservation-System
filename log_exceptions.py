import re

with open("public/index.php", "r", encoding="utf-8") as f:
    php = f.read()

# Modify the global exception handler
php = php.replace("error_log('[CampusRoom] Uncaught exception: ' . $e->getMessage());", "error_log('[CampusRoom] Uncaught exception: ' . $e->getMessage() . \"\\n\" . $e->getTraceAsString() . \"\\n\", 3, __DIR__ . '/error_debug.log'); error_log('[CampusRoom] Uncaught exception: ' . $e->getMessage());")
php = php.replace("error_log('[CampusRoom] PDOException: ' . $e->getMessage());", "error_log('[CampusRoom] PDOException: ' . $e->getMessage() . \"\\n\" . $e->getTraceAsString() . \"\\n\", 3, __DIR__ . '/error_debug.log'); error_log('[CampusRoom] PDOException: ' . $e->getMessage());")

with open("public/index.php", "w", encoding="utf-8") as f:
    f.write(php)
