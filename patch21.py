import os

with open('public/js/reservations.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('â€“', '\u2013')
content = content.replace('Ã¢â‚¬â€', '\u2014')
content = content.replace('â€¢', '\u2022')

with open('public/js/reservations.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')
