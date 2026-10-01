import re

with open("public/index.php", "r", encoding="utf-8") as f:
    php = f.read()

# Revert the logging
php = php.replace("error_log('[CampusRoom] Uncaught exception: ' . $e->getMessage() . \"\\n\" . $e->getTraceAsString() . \"\\n\", 3, __DIR__ . '/error_debug.log'); ", "")
php = php.replace("error_log('[CampusRoom] PDOException: ' . $e->getMessage() . \"\\n\" . $e->getTraceAsString() . \"\\n\", 3, __DIR__ . '/error_debug.log'); ", "")

with open("public/index.php", "w", encoding="utf-8") as f:
    f.write(php)
