import re

with open("public/rooms.html", "r", encoding="utf-8") as f:
    html = f.read()

old_eq_box = r'class="flex items-start gap-3 p-4 bg-white border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors shadow-sm"'
new_eq_box = r'class="flex items-start gap-3 p-4 bg-white border border-gray-300 rounded-xl cursor-pointer hover:border-[#7a1f2b]/30 hover:bg-[#faf5f6] transition-colors shadow-sm"'
html = re.sub(old_eq_box, new_eq_box, html)

with open("public/rooms.html", "w", encoding="utf-8") as f:
    f.write(html)
