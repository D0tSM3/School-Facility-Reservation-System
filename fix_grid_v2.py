import re

with open("public/rooms.html", "r", encoding="utf-8") as f:
    html = f.read()

html = re.sub(
    r'<!-- Grid: Room Selector & Date -->\s*<div class="grid grid-cols-1 md:grid-cols-2 gap-6">\s*<div class="flex flex-col space-y-2">',
    r'<!-- Grid: Room Selector & Date -->\n              <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">\n                <div class="flex flex-col space-y-2 lg:col-span-4">',
    html
)

html = re.sub(
    r'<select id="roomSelect"(.*?)>\s*<option value="">Loading rooms(.*?)</option>\s*</select>',
    r'<select id="roomSelect"\1>\n                      <option value="">Loading rooms\2</option>\n                    </select>\n                    <span class="absolute right-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-[18px] text-gray-400 pointer-events-none">expand_more</span>',
    html
)

html = re.sub(
    r'<div class="flex flex-col mb-4">\s*<span class="text-\[10px\] font-extrabold text-\[\#2a303c\] uppercase tracking-widest mb-3 block">BOOKING TYPE</span>',
    r'<div class="flex flex-col mb-4 lg:col-span-8">\n                  <span class="text-[10px] font-extrabold text-[#2a303c] uppercase tracking-widest mb-3 block">BOOKING TYPE</span>',
    html
)

html = re.sub(
    r'<div class="flex flex-col mb-4 mt-6">\s*<span class="text-\[10px\] font-extrabold text-\[\#2a303c\] uppercase tracking-widest mb-3 block">DATE</span>',
    r'<div class="flex flex-col mb-4 lg:col-span-12 mt-2">\n                  <span class="text-[10px] font-extrabold text-[#2a303c] uppercase tracking-widest mb-3 block">DATE</span>',
    html
)

html = re.sub(
    r'<div class="grid grid-cols-1 md:grid-cols-2 gap-4">\s*<div class="flex flex-col space-y-1.5 w-full" id="resDateWrapper">',
    r'<div class="grid grid-cols-1 md:grid-cols-3 gap-4">\n                    <div class="flex flex-col space-y-1.5 w-full" id="resDateWrapper">',
    html, count=1
)

with open("public/rooms.html", "w", encoding="utf-8") as f:
    f.write(html)
