import re

with open("public/staff-queue.html", "r", encoding="utf-8") as f:
    content = f.read()

# staff-queue.html has a div that contains school and AY 2024
pattern = re.compile(r'<div\s*class="hidden md:flex items-center gap-space-xs px-space-sm py-1 bg-surface-container rounded"\s*>\s*<span class="material-symbols-outlined text-secondary text-\[16px\]"\s*>school</span.*?AY 2024-2025.*?</span\s*>\s*</div>', re.DOTALL)
content = pattern.sub("", content)

with open("public/staff-queue.html", "w", encoding="utf-8") as f:
    f.write(content)


with open("public/handbook.html", "r", encoding="utf-8") as f:
    content2 = f.read()

pattern2 = re.compile(r'<div class="flex items-center gap-2 px-3 py-1 bg-gray-100/90 rounded-full text-gray-600 text-xs font-medium">\s*<span class="material-symbols-outlined text-\[15px\]">school</span>\s*<span>AY 2024-2025.*?Semester</span>\s*</div>', re.DOTALL)
content2 = pattern2.sub("", content2)

with open("public/handbook.html", "w", encoding="utf-8") as f:
    f.write(content2)
