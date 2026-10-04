import os

with open('src/Controller/ReservationController.php', 'r', encoding='utf-8') as f:
    content = f.read()

find1 = """    private function createBookingRows(
        string $customerId,
        string $roomId,
        string $purpose,
        string $category,
        ?string $equipmentNotes,
        string $startTime,
        string $endTime,
        ?array $activeDates = null
    ): array {"""

replace1 = """    private function createBookingRows(
        string $customerId,
        string $roomId,
        string $purpose,
        string $category,
        ?string $equipmentNotes,
        string $startTime,
        string $endTime,
        ?array $activeDates = null,
        string $status = 'Approved'
    ): array {"""

content = content.replace(find1, replace1)

find2 = """        if ($startDate === $endDate) {
            return [$this->reservations->create($customerId, $roomId, $purpose, $startTime, $endTime, $equipmentNotes, $category, null, 'Approved')];
        }"""

replace2 = """        if ($startDate === $endDate) {
            return [$this->reservations->create($customerId, $roomId, $purpose, $startTime, $endTime, $equipmentNotes, $category, null, $status)];
        }"""

content = content.replace(find2, replace2)

find3 = """            $rows = [];
            foreach ($days as $day) {
                $rows[] = $this->reservations->create(
                    $customerId, $roomId, $purpose, "$day $dailyStart", "$day $dailyEnd",
                    $equipmentNotes, $category, $seriesId, 'Approved'
                );
            }"""

replace3 = """            $rows = [];
            foreach ($days as $day) {
                $rows[] = $this->reservations->create(
                    $customerId, $roomId, $purpose, "$day $dailyStart", "$day $dailyEnd",
                    $equipmentNotes, $category, $seriesId, $status
                );
            }"""

content = content.replace(find3, replace3)

find4 = """    private function storeSeries(
        string $roomId,
        string $purpose,
        string $category,
        string $equipmentNotes,
        string $startTime,
        string $endTime,
        ?array $activeDates = null
    ): never {"""

replace4 = """    private function storeSeries(
        string $roomId,
        string $purpose,
        string $category,
        string $equipmentNotes,
        string $startTime,
        string $endTime,
        ?array $activeDates = null,
        string $status = 'Approved'
    ): never {"""

content = content.replace(find4, replace4)

find5 = """        try {
            $rows = $this->createBookingRows(
                Auth::userId(), $roomId, $purpose, $category,
                $equipmentNotes !== '' ? $equipmentNotes : null, $startTime, $endTime, $activeDates
            );"""

replace5 = """        try {
            $rows = $this->createBookingRows(
                Auth::userId(), $roomId, $purpose, $category,
                $equipmentNotes !== '' ? $equipmentNotes : null, $startTime, $endTime, $activeDates, $status
            );"""

content = content.replace(find5, replace5)


with open('src/Controller/ReservationController.php', 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
