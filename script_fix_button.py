import re
with open('public/rooms.html', 'r', encoding='utf-8') as f:
  content = f.read()
content = re.sub(r'// Initial state\n\s*updateBtn\(\);', r'// Initial state\n        updateBtn();\n        setInterval(updateBtn, 500);\n\n        submitBtn.addEventListener(\
click\, function(e) {\n          if (submitBtn.disabled) return;\n          e.preventDefault();\n          if (form.dispatchEvent) {\n            form.dispatchEvent(new Event(\submit\, { cancelable: true, bubbles: true }));\n          }\n        });', content)
with open('public/rooms.html', 'w', encoding='utf-8') as f:
  f.write(content)
