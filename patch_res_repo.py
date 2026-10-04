import os

with open('src/Repository/ReservationRepository.php', 'r', encoding='utf-8') as f:
    content = f.read()

finds = [
    "u.email         AS customer_email,",
    "c.name AS customer_name, c.email AS customer_email",
    "c.name  AS customer_name, c.email AS customer_email,",
]
replaces = [
    "u.email         AS customer_email, u.account_type AS customer_account_type,",
    "c.name AS customer_name, c.email AS customer_email, c.account_type AS customer_account_type",
    "c.name  AS customer_name, c.email AS customer_email, c.account_type AS customer_account_type,",
]

for i in range(len(finds)):
    content = content.replace(finds[i], replaces[i])

with open('src/Repository/ReservationRepository.php', 'w', encoding='utf-8') as f:
    f.write(content)
print("Patched ReservationRepository")
