import re

with open("src/Controller/ReservationController.php", "r", encoding="utf-8") as f:
    php = f.read()

php = re.sub(
    r'private function conflictError\(string \$error, string \$roomId, string \$startTime, string \$endTime\): never',
    r'private function conflictError(string $error, string $roomId, string $startTime, string $endTime, ?array $activeDates = null): never',
    php
)

php = re.sub(
    r'private function overridableConflict\(string \$roomId, string \$startTime, string \$endTime\): \?array\s*\{',
    r'private function overridableConflict(string $roomId, string $startTime, string $endTime, ?array $activeDates = null): ?array {',
    php
)

# Update checkRange calls inside overridableConflict
# ReservationValidator::checkRange($roomId, $startDate, $endDate, $dailyStart, $dailyEnd, [], ['Pending'])
# We need to pass $activeDates instead of []
php = php.replace(
    "ReservationValidator::checkRange($roomId, $startDate, $endDate, $dailyStart, $dailyEnd, [], ['Pending'])",
    "ReservationValidator::checkRange($roomId, $startDate, $endDate, $dailyStart, $dailyEnd, $activeDates, ['Pending'])"
)

# Update findApprovedConflict
# ReservationValidator::findApprovedConflict($roomId, $startDate, $endDate, $dailyStart, $dailyEnd)
php = php.replace(
    "ReservationValidator::findApprovedConflict($roomId, $startDate, $endDate, $dailyStart, $dailyEnd)",
    "ReservationValidator::findApprovedConflict($roomId, $startDate, $endDate, $dailyStart, $dailyEnd, $activeDates)"
)

with open("src/Controller/ReservationController.php", "w", encoding="utf-8") as f:
    f.write(php)
