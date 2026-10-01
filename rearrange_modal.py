import re

with open("public/rooms.html", "r", encoding="utf-8") as f:
    html = f.read()

# 1. Move the calendar below the time.
# Let's extract the calendar block.
calendar_match = re.search(r'(<!-- Facility Weekly Availability -->\s*<div id="room-calendar-container".*?</div>\s*</div>)', html, re.DOTALL)
if calendar_match:
    calendar_html = calendar_match.group(1)
    # Remove it from the current location
    html = html.replace(calendar_html, '')
    
    # Find the end of the TIME block
    time_block_match = re.search(r'(<!-- Time Selectors.*?<div class="grid grid-cols-1 md:grid-cols-2 gap-4">.*?</div>\s*</div>)', html, re.DOTALL)
    # Wait, my time block is just `<div class="flex flex-col mb-4 mt-6">...TIME...</div>`
    time_match = re.search(r'(<div class="flex flex-col mb-4 mt-6">\s*<span class="text-\[10px\] font-extrabold text-\[\#2a303c\] uppercase tracking-widest mb-3 block">TIME</span>.*?</div>\s*</div>)', html, re.DOTALL)
    if time_match:
        time_html = time_match.group(1)
        # Insert calendar after time block
        html = html.replace(time_html, time_html + '\n\n              ' + calendar_html)

# 2. Align buttons to the right
old_footer = r'<div class="bg-gray-50 px-6 py-5 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-4">'
new_footer = r'<div class="bg-gray-50 px-6 py-5 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-end gap-4">'
html = re.sub(old_footer, new_footer, html)

# 3. Wait, let me also check if BOOKING TYPE and TARGET FACILITY should be on separate lines.
# Looking at the new screenshots, BOOKING TYPE takes up the full width. 
# Let's revert the lg:grid-cols-12 and lg:col-span-4/8 back to full width rows.
old_grid = r'<!-- Grid: Room Selector & Date -->\s*<div class="grid grid-cols-1 lg:grid-cols-12 gap-8">'
new_grid = r'<!-- Grid: Room Selector & Date -->\n              <div class="flex flex-col gap-6">'
html = re.sub(old_grid, new_grid, html)

# Remove the lg:col-span-4 and lg:col-span-8 and lg:col-span-12
html = re.sub(r'lg:col-span-4', '', html)
html = re.sub(r'lg:col-span-8', '', html)
html = re.sub(r'lg:col-span-12', '', html)

with open("public/rooms.html", "w", encoding="utf-8") as f:
    f.write(html)
