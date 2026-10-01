import re

# Update Settings.php
with open("src/Core/Settings.php", "r", encoding="utf-8") as f:
    php = f.read()

php = php.replace("'closed_days'          => 'Sunday',", "'closed_days'          => '',")

with open("src/Core/Settings.php", "w", encoding="utf-8") as f:
    f.write(php)

# Update schedule.js
with open("public/js/schedule.js", "r", encoding="utf-8") as f:
    js = f.read()

js = js.replace(
    "const DEFAULT_RULES = Object.freeze({ open: '06:00', close: '21:00', closedDays: ['Sunday'] });",
    "const DEFAULT_RULES = Object.freeze({ open: '06:00', close: '21:00', closedDays: [] });"
)
with open("public/js/schedule.js", "w", encoding="utf-8") as f:
    f.write(js)
