import re

with open("src/Controller/ReservationController.php", "r", encoding="utf-8") as f:
    php = f.read()

php = php.replace(
    "ReservationValidator::checkRange($roomId, $startDate, $endDate, $dailyStart, $dailyEnd, $activeDates, ['Pending'])",
    "ReservationValidator::checkRange($roomId, $startDate, $endDate, $dailyStart, $dailyEnd, [], ['Pending'], $activeDates)"
)

php = php.replace(
    "$error = ReservationValidator::checkRange($roomId, $startDate, $endDate, $dailyStart, $dailyEnd, $activeDates);",
    "$error = ReservationValidator::checkRange($roomId, $startDate, $endDate, $dailyStart, $dailyEnd, [], ['Pending', 'Approved'], $activeDates);"
)

with open("src/Controller/ReservationController.php", "w", encoding="utf-8") as f:
    f.write(php)
