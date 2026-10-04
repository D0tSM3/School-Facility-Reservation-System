import os

with open('public/js/reservations.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace all occurrences of – (which were inserted by the python script)
# The hex codes for – are \xc3\xa2\xe2\x82\xac\xe2\x80\x9c if written literally,
# but since python wrote them, they might be literally "–"
content = content.replace("–", "\u2013")
content = content.replace("â€�", "\u2014")

with open('public/js/reservations.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')
