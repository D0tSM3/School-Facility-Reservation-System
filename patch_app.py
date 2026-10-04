import os

with open('public/js/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

find = """      const roleLabel = (currentUser.role === 'Staff' || currentUser.role === 'Admin')
        ? `${currentUser.role} / Registrar`
        : 'Student';"""

replace = """      const roleLabel = (currentUser.role === 'Staff' || currentUser.role === 'Admin')
        ? `${currentUser.role} / Registrar`
        : (currentUser.account_type || 'Student');"""

if find in content:
    content = content.replace(find, replace)
    with open('public/js/app.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Patched app.js roleLabel")
else:
    print("Could not find roleLabel in app.js")
