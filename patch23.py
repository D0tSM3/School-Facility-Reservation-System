with open('public/js/reservations.js', 'rb') as f:
    content = f.read()

idx = content.find(b'<br>')
print(content[idx:idx+20])
