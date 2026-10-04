import os

with open('public/js/admin-dashboard.js', 'r', encoding='utf-8') as f:
    content = f.read()

find = """<td class="py-4 px-6 text-xs text-gray-600 font-mono">${escapeHtml(u.email)}</td>"""
replace = """<td class="py-4 px-6 text-xs text-gray-600 font-mono">
              <div>${escapeHtml(u.email)}</div>
              <div class="text-[11px] text-indigo-600 font-semibold mt-0.5">${escapeHtml(u.account_type || 'Student')}</div>
            </td>"""

if find in content:
    content = content.replace(find, replace)
    with open('public/js/admin-dashboard.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Patched admin-dashboard.js for Users table")
else:
    print("Could not find table cell in admin-dashboard.js")
