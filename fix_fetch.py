import re

with open("public/register.html", "r", encoding="utf-8") as f:
    html = f.read()

# Replace absolute paths with BASE-relative paths
html = html.replace("fetch('/api/config')", "const BASE = window.location.pathname.replace(/[^\\/]*$/, '');\n        fetch(BASE + 'api/config')")
html = html.replace("fetch('/api/auth/register'", "fetch(BASE + 'api/auth/register'")

with open("public/register.html", "w", encoding="utf-8") as f:
    f.write(html)
