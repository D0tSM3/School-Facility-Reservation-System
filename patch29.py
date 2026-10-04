import os
import re

with open('public/js/reservations.js', 'r', encoding='utf-8') as f:
    content = f.read()

pattern = re.compile(r'<span>\$\{formatTime\(reservation\.start_time\)\}\s*.\s*\$\{formatTime\(reservation\.end_time\)\}</span>\s*</span>')

def replacer(m):
    return "<span>${formatTime(reservation.start_time)} \u2013 ${formatTime(reservation.end_time)}</span>\n                </span>\n                ${extraInfoHtml}"

if pattern.search(content):
    content = pattern.sub(replacer, content)
    with open('public/js/reservations.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Injected extraInfoHtml successfully")
else:
    print("Could not find pattern to inject extraInfoHtml")
