import re

with open('src/Repository/ReservationRepository.php', 'r', encoding='utf-8') as f:
    content = f.read()

find = """    public function create(
        string $customerId,
        string $roomId,
        string $purpose,
        string $startTime,
        string $endTime,
        ?string $equipmentNotes = null,
        string $category = 'Academic Lecture',
        ?string $seriesId = null
    ): array {
        $reservationId = self::uuidv4();
        $this->db->query(
            'INSERT INTO Reservations (reservation_id, customer_id, room_id, purpose, category, equipment_notes, start_time, end_time, series_id)
             VALUES (:reservation_id, :customer_id, :room_id, :purpose, :category, :equipment_notes, :start_time, :end_time, :series_id)',
            [
                ':reservation_id'  => $reservationId,
                ':customer_id'     => $customerId,
                ':room_id'         => $roomId,
                ':purpose'         => $purpose,
                ':category'        => $category,
                ':equipment_notes' => $equipmentNotes,
                ':start_time'      => $startTime,
                ':end_time'        => $endTime,
                ':series_id'       => $seriesId,
            ]
        );"""

replace = """    public function create(
        string $customerId,
        string $roomId,
        string $purpose,
        string $startTime,
        string $endTime,
        ?string $equipmentNotes = null,
        string $category = 'Academic Lecture',
        ?string $seriesId = null,
        string $status = 'Pending'
    ): array {
        $reservationId = self::uuidv4();
        $this->db->query(
            'INSERT INTO Reservations (reservation_id, customer_id, room_id, purpose, category, equipment_notes, start_time, end_time, series_id, status)
             VALUES (:reservation_id, :customer_id, :room_id, :purpose, :category, :equipment_notes, :start_time, :end_time, :series_id, :status)',
            [
                ':reservation_id'  => $reservationId,
                ':customer_id'     => $customerId,
                ':room_id'         => $roomId,
                ':purpose'         => $purpose,
                ':category'        => $category,
                ':equipment_notes' => $equipmentNotes,
                ':start_time'      => $startTime,
                ':end_time'        => $endTime,
                ':series_id'       => $seriesId,
                ':status'          => $status,
            ]
        );"""

if find in content:
    content = content.replace(find, replace)
    with open('src/Repository/ReservationRepository.php', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Injected status successfully")
else:
    print("Could not find pattern")
