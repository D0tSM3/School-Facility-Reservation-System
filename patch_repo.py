import os

with open('src/Repository/ConflictOverrideRepository.php', 'r', encoding='utf-8') as f:
    content = f.read()

find = """    public function create(
        string $requestedBy,
        string $roomId,
        string $startTime,
        string $endTime,
        string $purpose,
        string $category,
        ?string $equipmentNotes,
        string $reason,
        string $conflictingReservationId
    ): array {
        $stmt = $this->db->query(
            'INSERT INTO ConflictOverrideRequests
                    (requested_by, room_id, start_time, end_time, purpose, category,
                     equipment_notes, reason, conflicting_reservation_id)
             VALUES (:requested_by, :room_id, :start_time, :end_time, :purpose, :category,
                     :equipment_notes, :reason, :conflicting_reservation_id)
             RETURNING request_id',
            [
                ':requested_by'               => $requestedBy,
                ':room_id'                    => $roomId,
                ':start_time'                 => $startTime,
                ':end_time'                   => $endTime,
                ':purpose'                    => $purpose,
                ':category'                   => $category,
                ':equipment_notes'            => $equipmentNotes,
                ':reason'                     => $reason,
                ':conflicting_reservation_id' => $conflictingReservationId,
            ]
        );"""

replace = """    public function create(
        string $requestedBy,
        string $roomId,
        string $startTime,
        string $endTime,
        string $purpose,
        string $category,
        ?string $equipmentNotes,
        string $reason,
        string $conflictingReservationId,
        ?string $requestType = null,
        ?string $altStartTime = null,
        ?string $altEndTime = null
    ): array {
        $stmt = $this->db->query(
            'INSERT INTO ConflictOverrideRequests
                    (requested_by, room_id, start_time, end_time, purpose, category,
                     equipment_notes, reason, conflicting_reservation_id, request_type, alt_start_time, alt_end_time)
             VALUES (:requested_by, :room_id, :start_time, :end_time, :purpose, :category,
                     :equipment_notes, :reason, :conflicting_reservation_id, :request_type, :alt_start_time, :alt_end_time)
             RETURNING request_id',
            [
                ':requested_by'               => $requestedBy,
                ':room_id'                    => $roomId,
                ':start_time'                 => $startTime,
                ':end_time'                   => $endTime,
                ':purpose'                    => $purpose,
                ':category'                   => $category,
                ':equipment_notes'            => $equipmentNotes,
                ':reason'                     => $reason,
                ':conflicting_reservation_id' => $conflictingReservationId,
                ':request_type'               => $requestType,
                ':alt_start_time'             => $altStartTime,
                ':alt_end_time'               => $altEndTime,
            ]
        );"""

if find in content:
    content = content.replace(find, replace)
    with open('src/Repository/ConflictOverrideRepository.php', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Updated ConflictOverrideRepository.php")
else:
    print("Could not find pattern in ConflictOverrideRepository.php")
