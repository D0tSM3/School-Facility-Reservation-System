import re

with open("src/Core/ReservationValidator.php", "r", encoding="utf-8") as f:
    php = f.read()

# Fix checkRange signature
old_sig = """    public static function checkRange(
        string $roomId,
        string $startDate,
        string $endDate,
        string $dailyStart,
        string $dailyEnd,
        array $excludeReservationIds = [],
        array $blockingStatuses = ['Pending', 'Approved']
    ): ?string {"""
new_sig = """    public static function checkRange(
        string $roomId,
        string $startDate,
        string $endDate,
        string $dailyStart,
        string $dailyEnd,
        array $excludeReservationIds = [],
        array $blockingStatuses = ['Pending', 'Approved'],
        ?array $activeDates = null
    ): ?string {"""
php = php.replace(old_sig, new_sig)

# Fix findApprovedConflict signature
old_sig2 = """    public static function findApprovedConflict(
        string $roomId,
        string $startDate,
        string $endDate,
        string $dailyStart,
        string $dailyEnd
    ): ?array {"""
new_sig2 = """    public static function findApprovedConflict(
        string $roomId,
        string $startDate,
        string $endDate,
        string $dailyStart,
        string $dailyEnd,
        ?array $activeDates = null
    ): ?array {"""
php = php.replace(old_sig2, new_sig2)

# Fix datesBetween logic if it wasn't replaced properly
# I already replaced one `datesBetween` in update_validator, but let's just make sure both have activeDates filter
# The first occurrence is in checkRange:
php = php.replace(
    '$days = self::datesBetween($startDate, $endDate);',
    '$days = self::datesBetween($startDate, $endDate);\n        if ($activeDates !== null && count($activeDates) > 0) {\n            $days = array_values(array_intersect($days, $activeDates));\n        }'
)

with open("src/Core/ReservationValidator.php", "w", encoding="utf-8") as f:
    f.write(php)
