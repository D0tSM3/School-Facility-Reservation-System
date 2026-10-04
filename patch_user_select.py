import os

with open('src/Repository/UserRepository.php', 'r', encoding='utf-8') as f:
    content = f.read()

finds = [
    "'SELECT user_id, name, email, password_hash, role, is_verified::int AS is_verified, otp_code, otp_expires_at, created_at",
    "'SELECT user_id, name, email, role, is_verified::int AS is_verified, created_at"
]

replaces = [
    "'SELECT user_id, name, email, password_hash, role, account_type, is_verified::int AS is_verified, otp_code, otp_expires_at, created_at",
    "'SELECT user_id, name, email, role, account_type, is_verified::int AS is_verified, created_at"
]

for i in range(len(finds)):
    content = content.replace(finds[i], replaces[i])

with open('src/Repository/UserRepository.php', 'w', encoding='utf-8') as f:
    f.write(content)
print("Patched UserRepository SELECTs")
