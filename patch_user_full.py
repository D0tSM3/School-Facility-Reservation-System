import os

with open('src/Repository/UserRepository.php', 'r', encoding='utf-8') as f:
    content = f.read()

find = "SELECT user_id, name, email, password_hash, role, is_verified::int AS is_verified,\n                    otp_code"
replace = "SELECT user_id, name, email, password_hash, role, account_type, is_verified::int AS is_verified,\n                    otp_code"

if find in content:
    content = content.replace(find, replace)
    with open('src/Repository/UserRepository.php', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Patched findByEmailFull")
else:
    print("Could not find findByEmailFull")
