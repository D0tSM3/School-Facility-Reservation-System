import os
import re

for filename in os.listdir("public"):
    if not filename.endswith(".html"):
        continue
        
    filepath = os.path.join("public", filename)
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()
        
    # Remove AY badge from handbook.html
    if "AY 2024-2025" in content and filename == "handbook.html":
        content = re.sub(
            r'<div class="flex items-center gap-2 px-3 py-1 bg-gray-100/90 rounded-full text-gray-600 text-xs font-medium">\s*<span class="material-symbols-outlined text-\[15px\]">school</span>\s*<span>AY 2024-2025\s+First Semester</span>\s*</div>',
            "",
            content
        )
        
    # Remove AY badge from staff-queue.html
    if "AY 2024-2025" in content and filename == "staff-queue.html":
        content = re.sub(
            r'<div\s*class="hidden md:flex items-center gap-space-xs px-space-sm py-1 bg-surface-container rounded"\s*>\s*<span class="material-symbols-outlined text-secondary text-\[16px\]"\s*>school</span\s*><span\s*class="font-label-sm text-label-sm text-on-surface-variant font-semibold"\s*>AY 2024-2025\s+First Semester</span\s*>\s*</div>',
            "",
            content
        )

    # Change justify-between to justify-end if it's the standard customer header
    # If the header ONLY has the User Profile div, justify-between makes it left-aligned.
    # To put it on the right, we change justify-between to justify-end.
    # We will do this for dashboard.html, rooms.html, my-reservations.html, book-room.html, handbook.html
    if filename in ["dashboard.html", "rooms.html", "my-reservations.html", "book-room.html", "handbook.html"]:
        content = content.replace(
            "z-40 flex items-center justify-between px-8",
            "z-40 flex items-center justify-end px-8"
        )

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(content)
