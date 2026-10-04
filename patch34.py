import os

with open('src/Controller/ReservationController.php', 'r', encoding='utf-8') as f:
    content = f.read()

find = """        if ($error === null) {
            try {
                $rows = $this->createBookingRows(
                    $override['requested_by'], $override['room_id'], $override['purpose'], $override['category'],
                    $override['equipment_notes'], $override['start_time'], $override['end_time']
                );"""

replace = """        if ($error === null) {
            try {
                $rows = $this->createBookingRows(
                    $override['requested_by'], $override['room_id'], $override['purpose'], $override['category'],
                    $override['equipment_notes'], $override['start_time'], $override['end_time'], null, 'Pending'
                );"""

content = content.replace(find, replace)

with open('src/Controller/ReservationController.php', 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
