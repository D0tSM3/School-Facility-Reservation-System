import os
import re

with open('src/Controller/ReservationController.php', 'r', encoding='utf-8') as f:
    content = f.read()

find = """    private function createBookingRows(
        string $customerId,
        string $roomId,
        string $purpose,
        string $category,
        ?string $equipmentNotes,
        string $startTime,
        string $endTime,
        ?array $activeDates = null
    ): array {
        $startDate = substr($startTime, 0, 10);
        $endDate   = substr($endTime, 0, 10);

        if ($startDate === $endDate) {
            return [$this->reservations->create($customerId, $roomId, $purpose, $startTime, $endTime, $equipmentNotes, $category)];
        }"""

replace = """    private function createBookingRows(
        string $customerId,
        string $roomId,
        string $purpose,
        string $category,
        ?string $equipmentNotes,
        string $startTime,
        string $endTime,
        ?array $activeDates = null
    ): array {
        $startDate = substr($startTime, 0, 10);
        $endDate   = substr($endTime, 0, 10);

        if ($startDate === $endDate) {
            return [$this->reservations->create($customerId, $roomId, $purpose, $startTime, $endTime, $equipmentNotes, $category, null, 'Approved')];
        }"""

if find in content:
    content = content.replace(find, replace)
    with open('src/Controller/ReservationController.php', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Injected Approved into single day successfully")
else:
    print("Could not find pattern for single day")
