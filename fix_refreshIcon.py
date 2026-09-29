import re

with open("public/js/staff-dashboard.js", "r", encoding="utf-8") as f:
    js = f.read()

# Fix the ReferenceError by removing refreshIcon usage
js = js.replace("if (refreshIcon) refreshIcon.classList.add('animate-spin');", "")
js = js.replace("if (refreshIcon) refreshIcon.classList.remove('animate-spin');", "")

with open("public/js/staff-dashboard.js", "w", encoding="utf-8") as f:
    f.write(js)
