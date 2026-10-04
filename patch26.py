import os
import re

with open('public/js/reservations.js', 'r', encoding='utf-8') as f:
    content = f.read()

pattern = re.compile(r'        return `<div data-status="\$\{escapeHtml\(filterStatus\)\}" class="reservation-card bg-white px-5 py-4 rounded-xl border border-gray-200 shadow-sm mb-3 transition-all hover:border-gray-300 hover:shadow">\n\s*<div class="flex items-center gap-5">\n\s*<!-- Date block: month \+ year on same header line, large day below -->\n\s*<div class="border border-gray-200 rounded-lg overflow-hidden text-center min-w-\[68px\] shrink-0 flex flex-col bg-white">\n\s*<div class="bg-\[#7a1f2b\] text-white text-\[9px\] font-bold py-1 px-1 uppercase tracking-widest whitespace-nowrap">\$\{date\.month\} \$\{date\.year\}</div>\n\s*<div class="text-2xl font-bold text-gray-900 py-2 leading-none">\$\{date\.day\}</div>\n\s*</div>')

replace = r'''        return `<div data-status="${escapeHtml(filterStatus)}" class="reservation-card bg-white px-5 py-4 rounded-xl border border-gray-200 shadow-sm mb-3 transition-all hover:border-gray-300 hover:shadow">
          <div class="flex items-center gap-5">
  
            ${dateBlockHtml}'''

if pattern.search(content):
    content = pattern.sub(replace, content)
    with open('public/js/reservations.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Injected dateBlockHtml successfully")
else:
    print("Could not find pattern to inject dateBlockHtml")
