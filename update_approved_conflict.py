import re

with open("src/Core/ReservationValidator.php", "r", encoding="utf-8") as f:
    php = f.read()

php = re.sub(
    r'public static function findApprovedConflict\(string \$roomId, string \$startDate, string \$endDate, string \$startTimeOnly, string \$endTimeOnly\): \?array\s*\{',
    r'public static function findApprovedConflict(string $roomId, string $startDate, string $endDate, string $startTimeOnly, string $endTimeOnly, ?array $activeDates = null): ?array {',
    php
)

filter_code = """
        $days = self::datesBetween($startDate, $endDate);
        if ($activeDates !== null && count($activeDates) > 0) {
            $days = array_values(array_intersect($days, $activeDates));
        }
"""
php = php.replace('$days = self::datesBetween($startDate, $endDate);', filter_code, 1)

with open("src/Core/ReservationValidator.php", "w", encoding="utf-8") as f:
    f.write(php)
