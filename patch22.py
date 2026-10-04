import os

with open('public/js/reservations.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('\u00e2\u20ac\u201c', '\u2013')
content = content.replace('\u00c3\u00a2\u201a\xac\u00e2\u20ac\u201d', '\u2014')
content = content.replace('\u00e2\u20ac\u00a2', '\u2022')
content = content.replace('???????', '\u2014')

with open('public/js/reservations.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')
