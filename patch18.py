with open('public/js/reservations.js', 'rb') as f:
    content = f.read()

# Replace powershell mangled en-dash '–' (c3 a2 e2 82 ac e2 80 9c)
content = content.replace(b'\xc3\xa2\xe2\x82\xac\xe2\x80\x9c', b'\xe2\x80\x93')
# Also replace literally what was written from my python script: '–' (which is b'\xc3\xa2\xe2\x80\x9c')
content = content.replace(b'\xc3\xa2\xe2\x80\x9c', b'\xe2\x80\x93')

# Replace em-dash mangled 'â€�'
content = content.replace(b'\xc3\x83\xc2\xa2\xc3\xa2\xe2\x80\x9a\xc2\xac\xc3\xa2\xe2\x82\xac\xc5\x93', b'\xe2\x80\x94')

with open('public/js/reservations.js', 'wb') as f:
    f.write(content)
print("Done")
