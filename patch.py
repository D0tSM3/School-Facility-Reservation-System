import os
with open('src/Controller/ReservationController.php', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("private function jsonBody(): array", "protected function jsonBody(): array")

with open('src/Controller/ReservationController.php', 'w', encoding='utf-8') as f:
    f.write(content)
print("Made jsonBody protected")
