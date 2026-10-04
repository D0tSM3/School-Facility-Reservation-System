import os
import re

with open('public/js/reservations.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Because of the powershell formatting madness, I will use a regex that matches the end of the subtitle row
pattern = re.compile(r'<span>\$\{formatTime\(reservation\.start_time\)\}\s*.\s*\$\{formatTime\(reservation\.end_time\)\}</span>\s*</span>')

replace = r'''<span>${formatTime(reservation.start_time)} \u2013 ${formatTime(reservation.end_time)}</span>
                </span>
                ${extraInfoHtml}'''

if pattern.search(content):
    content = pattern.sub(replace, content)
    with open('public/js/reservations.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Injected extraInfoHtml successfully")
else:
    print("Could not find pattern to inject extraInfoHtml")
