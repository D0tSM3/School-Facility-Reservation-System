import re

with open("public/index.html", "r", encoding="utf-8") as f:
    html = f.read()

# Add maxlength="64" to email input in index.html
html = html.replace('id="bpu-email"\n                      placeholder="id@bpu.edu.ph"\n                      type="email"', 'id="bpu-email"\n                      placeholder="id@bpu.edu.ph"\n                      type="email"\n                      maxlength="64"')

# Replace arrow_forward icon with login icon on the submit button in index.html
html = html.replace('arrow_forward', 'login')

with open("public/index.html", "w", encoding="utf-8") as f:
    f.write(html)
