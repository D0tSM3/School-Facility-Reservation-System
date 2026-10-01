import re

with open("src/Controller/ReservationController.php", "r", encoding="utf-8") as f:
    php = f.read()

# Add active_dates to storeSeries signature
php = re.sub(
    r'private function storeSeries\((.*?)\string \$endTime\s*\): never \{',
    r'private function storeSeries(\1string $endTime, ?array $activeDates = null): never {',
    php,
    flags=re.DOTALL
)

# Pass active_dates to storeSeries call in store()
# We need to extract active_dates from jsonBody
# In store():
# ] = $this->bookingRequest($this->jsonBody());
# Add $body = $this->jsonBody(); at the top of store()
php = re.sub(
    r'public function store\(\): never\s*\{\s*Auth::requireRole\(\[\'Customer\'\]\);\s*\[',
    r"public function store(): never\n    {\n        Auth::requireRole(['Customer']);\n        $body = $this->jsonBody();\n        [",
    php,
    flags=re.DOTALL
)

# Update the bookingRequest call
php = php.replace('$this->bookingRequest($this->jsonBody())', '$this->bookingRequest($body)')

# Update the call to storeSeries
php = php.replace(
    '$this->storeSeries($roomId, $purpose, $category, $equipmentNotes, $startTime, $endTime);',
    '$this->storeSeries($roomId, $purpose, $category, $equipmentNotes, $startTime, $endTime, $body[\'active_dates\'] ?? null);'
)

# Update checkRange call in storeSeries
# Currently: ReservationValidator::checkRange($roomId, $startDate, $endDate, $dailyStart, $dailyEnd);
# We need to pass activeDates so checkRange only checks those days.
php = php.replace(
    'ReservationValidator::checkRange($roomId, $startDate, $endDate, $dailyStart, $dailyEnd)',
    'ReservationValidator::checkRange($roomId, $startDate, $endDate, $dailyStart, $dailyEnd, $activeDates)'
)

# Update createBookingRows signature
php = re.sub(
    r'private function createBookingRows\((.*?)\string \$endTime\s*\): array \{',
    r'private function createBookingRows(\1string $endTime, ?array $activeDates = null): array {',
    php,
    flags=re.DOTALL
)

# Pass activeDates to createBookingRows in storeSeries
php = php.replace(
    ', $startTime, $endTime',
    ', $startTime, $endTime, $activeDates'
)

# In createBookingRows, filter $days
# $days       = ReservationValidator::datesBetween($startDate, $endDate) ?? [];
# if ($activeDates !== null) { $days = array_intersect($days, $activeDates); }
filter_code = """
        $days       = ReservationValidator::datesBetween($startDate, $endDate) ?? [];
        if ($activeDates !== null && count($activeDates) > 0) {
            $days = array_values(array_intersect($days, $activeDates));
        }
        if (empty($days)) {
            Response::error('No valid dates selected within the range.', 400);
        }
"""
php = php.replace('$days       = ReservationValidator::datesBetween($startDate, $endDate) ?? [];', filter_code)

with open("src/Controller/ReservationController.php", "w", encoding="utf-8") as f:
    f.write(php)
