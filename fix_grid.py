import re

with open("public/rooms.html", "r", encoding="utf-8") as f:
    html = f.read()

# Fix the grid structure for Target Facility & Booking Type
old_grid = r'<!-- Grid: Room Selector & Date -->\s*<div class="grid grid-cols-1 md:grid-cols-2 gap-6">'
new_grid = r'<!-- Grid: Room Selector & Date -->\s*<div class="grid grid-cols-1 lg:grid-cols-12 gap-8">'
html = re.sub(old_grid, new_grid, html)

old_tf = r'<div class="flex flex-col space-y-2">\s*<span class="text-\[10px\] font-extrabold text-\[\#2a303c\] uppercase tracking-widest mb-3 block">TARGET FACILITY <span class="text-red-500">\*</span></span>'
new_tf = r'<div class="flex flex-col space-y-2 lg:col-span-4">\s*<span class="text-[10px] font-extrabold text-[#2a303c] uppercase tracking-widest mb-3 block">TARGET FACILITY <span class="text-red-500">*</span></span>'
html = re.sub(old_tf, new_tf, html)

old_bt = r'<div class="flex flex-col mb-4">\s*<span class="text-\[10px\] font-extrabold text-\[\#2a303c\] uppercase tracking-widest mb-3 block">BOOKING TYPE</span>'
new_bt = r'<div class="flex flex-col mb-4 lg:col-span-8">\s*<span class="text-[10px] font-extrabold text-[#2a303c] uppercase tracking-widest mb-3 block">BOOKING TYPE</span>'
html = re.sub(old_bt, new_bt, html)

# The DATE is currently inside the same grid. We want DATE to be its own row, full width.
# In the original, it was in the grid, taking up the 3rd column, which wrapped.
old_date = r'<div class="flex flex-col mb-4 mt-6">\s*<span class="text-\[10px\] font-extrabold text-\[\#2a303c\] uppercase tracking-widest mb-3 block">DATE</span>'
new_date = r'<div class="flex flex-col mb-4 lg:col-span-12 mt-2">\s*<span class="text-[10px] font-extrabold text-[#2a303c] uppercase tracking-widest mb-3 block">DATE</span>'
html = re.sub(old_date, new_date, html)

# Also fix the resDateWrapper grid
old_date_grid = r'<div class="grid grid-cols-1 md:grid-cols-2 gap-4">'
new_date_grid = r'<div class="grid grid-cols-1 md:grid-cols-3 gap-4">'
html = re.sub(old_date_grid, new_date_grid, html, count=1) # Only replace the first one (Date)


with open("public/rooms.html", "w", encoding="utf-8") as f:
    f.write(html)
