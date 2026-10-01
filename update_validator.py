import re

with open("src/Core/ReservationValidator.php", "r", encoding="utf-8") as f:
    php = f.read()

# Update checkRange signature
# public static function checkRange(string $roomId, string $startDate, string $endDate, string $startTimeOnly, string $endTimeOnly): ?string
php = re.sub(
    r'public static function checkRange\(string \$roomId, string \$startDate, string \$endDate, string \$startTimeOnly, string \$endTimeOnly\): \?string\s*\{',
    r'public static function checkRange(string $roomId, string $startDate, string $endDate, string $startTimeOnly, string $endTimeOnly, ?array $activeDates = null): ?string {',
    php,
    flags=re.DOTALL
)

# Update the loop in checkRange
# $days = self::datesBetween($startDate, $endDate);
# foreach ($days as $day) {
filter_code = """
        $days = self::datesBetween($startDate, $endDate);
        if ($activeDates !== null && count($activeDates) > 0) {
            $days = array_values(array_intersect($days, $activeDates));
        }
"""
php = php.replace('$days = self::datesBetween($startDate, $endDate);', filter_code)

with open("src/Core/ReservationValidator.php", "w", encoding="utf-8") as f:
    f.write(php)
