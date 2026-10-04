import os

with open('src/Repository/ConflictOverrideRepository.php', 'r', encoding='utf-8') as f:
    content = f.read()

find = "o.requested_by, u.name AS requester_name, u.email AS requester_email,"
replace = "o.requested_by, u.name AS requester_name, u.email AS requester_email, u.account_type AS requester_account_type,"

if find in content:
    content = content.replace(find, replace)
    with open('src/Repository/ConflictOverrideRepository.php', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Patched ConflictOverrideRepository")
else:
    print("Could not find in ConflictOverrideRepository")
