import os

with open('src/Controller/ReservationController.php', 'r', encoding='utf-8') as f:
    content = f.read()

find = """        $override = $overrides->create(
            Auth::userId(),
            $request['room_id'],
            $request['start_time'],
            $request['end_time'],
            $request['purpose'],
            $request['category'],
            $request['equipment_notes'] !== '' ? $request['equipment_notes'] : null,
            $reason,
            $conflict['reservation_id']
        );"""

replace = """        $requestType = trim((string) ($body['request_type'] ?? ''));
        $altStartTime = trim((string) ($body['alt_start_time'] ?? ''));
        $altEndTime = trim((string) ($body['alt_end_time'] ?? ''));

        $override = $overrides->create(
            Auth::userId(),
            $request['room_id'],
            $request['start_time'],
            $request['end_time'],
            $request['purpose'],
            $request['category'],
            $request['equipment_notes'] !== '' ? $request['equipment_notes'] : null,
            $reason,
            $conflict['reservation_id'],
            $requestType !== '' ? $requestType : null,
            $altStartTime !== '' ? $altStartTime : null,
            $altEndTime !== '' ? $altEndTime : null
        );"""

if find in content:
    content = content.replace(find, replace)
    with open('src/Controller/ReservationController.php', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Updated ReservationController.php")
else:
    print("Could not find pattern in ReservationController.php")
