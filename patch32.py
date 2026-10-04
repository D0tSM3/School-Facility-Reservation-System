import os
import re

with open('src/Controller/ReservationController.php', 'r', encoding='utf-8') as f:
    content = f.read()

find1 = """    private function storeSeries(
        string $roomId,
        string $purpose,
        string $category,
        string $equipmentNotes,
        string $startTime,
        string $endTime
    ): never {"""

replace1 = """    private function storeSeries(
        string $roomId,
        string $purpose,
        string $category,
        string $equipmentNotes,
        string $startTime,
        string $endTime,
        ?array $activeDates = null
    ): never {"""

content = content.replace(find1, replace1)

find2 = """    private function createBookingRows(
        string $customerId,
        string $roomId,
        string $purpose,
        string $category,
        ?string $equipmentNotes,
        string $startTime,
        string $endTime
    ): array {"""

replace2 = """    private function createBookingRows(
        string $customerId,
        string $roomId,
        string $purpose,
        string $category,
        ?string $equipmentNotes,
        string $startTime,
        string $endTime,
        ?array $activeDates = null
    ): array {"""

content = content.replace(find2, replace2)

find3 = """        if ($startDate === $endDate) {
            return [$this->reservations->create($customerId, $roomId, $purpose, $startTime, $endTime, $equipmentNotes, $category)];
        }"""

replace3 = """        if ($startDate === $endDate) {
            return [$this->reservations->create($customerId, $roomId, $purpose, $startTime, $endTime, $equipmentNotes, $category, null, 'Approved')];
        }"""

content = content.replace(find3, replace3)

find4 = """            $rows = [];
            foreach ($days as $day) {
                $rows[] = $this->reservations->create(
                    $customerId, $roomId, $purpose, "$day $dailyStart", "$day $dailyEnd",
                    $equipmentNotes, $category, $seriesId
                );
            }"""

replace4 = """            $rows = [];
            foreach ($days as $day) {
                $rows[] = $this->reservations->create(
                    $customerId, $roomId, $purpose, "$day $dailyStart", "$day $dailyEnd",
                    $equipmentNotes, $category, $seriesId, 'Approved'
                );
            }"""

content = content.replace(find4, replace4)

find5 = """    public function store(): never
    {
        Auth::requireRole(['Customer']);
        $body = $this->jsonBody();
        [
            'room_id' => $roomId, 'purpose' => $purpose, 'category' => $category,
            'equipment_notes' => $equipmentNotes, 'start_time' => $startTime, 'end_time' => $endTime,
        ] = $this->bookingRequest($body);

        // Different dates = a multi-day booking: start_time's date to
        // end_time's date, using start_time's clock to end_time's clock as the
        // window on every one of those days.
        $activeDates = $body['active_dates'] ?? null; if (substr($startTime, 0, 10) !== substr($endTime, 0, 10)) {
            $this->storeSeries($roomId, $purpose, $category, $equipmentNotes, $startTime, $endTime, $activeDates);
        }

        $error = ReservationValidator::check($roomId, $startTime, $endTime);
        if ($error !== null) {
            $this->conflictError($error, $roomId, $startTime, $endTime, $activeDates);
        }

        try {
            $reservation = $this->reservations->create(
                Auth::userId(),
                $roomId,
                $purpose,
                $startTime,
                $endTime,
                $equipmentNotes !== '' ? $equipmentNotes : null,
                $category
            );"""

replace5 = """    public function store(): never
    {
        Auth::requireRole(['Customer']);
        $body = $this->jsonBody();
        [
            'room_id' => $roomId, 'purpose' => $purpose, 'category' => $category,
            'equipment_notes' => $equipmentNotes, 'start_time' => $startTime, 'end_time' => $endTime,
        ] = $this->bookingRequest($body);

        // Different dates = a multi-day booking: start_time's date to
        // end_time's date, using start_time's clock to end_time's clock as the
        // window on every one of those days.
        $activeDates = $body['active_dates'] ?? null;
        if (substr($startTime, 0, 10) !== substr($endTime, 0, 10)) {
            $this->storeSeries($roomId, $purpose, $category, $equipmentNotes, $startTime, $endTime, $activeDates);
        }

        $error = ReservationValidator::check($roomId, $startTime, $endTime);
        if ($error !== null) {
            $this->conflictError($error, $roomId, $startTime, $endTime, $activeDates);
        }

        try {
            $reservation = $this->reservations->create(
                Auth::userId(),
                $roomId,
                $purpose,
                $startTime,
                $endTime,
                $equipmentNotes !== '' ? $equipmentNotes : null,
                $category,
                null,
                'Approved'
            );"""
content = content.replace(find5, replace5)


with open('src/Controller/ReservationController.php', 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
