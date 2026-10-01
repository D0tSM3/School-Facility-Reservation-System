import re

with open("public/register.html", "r", encoding="utf-8") as f:
    html = f.read()

# Fix BASE scope by moving it to the top of the script tag
script_tag = "<script>"
new_script_start = "<script>\n      const BASE = window.location.pathname.replace(/[^\\/]*$/, '');\n"

# Remove the BASE definitions inside the script
html = html.replace("const BASE = window.location.pathname.replace(/[^\\/]*$/, '');\n        ", "")
html = html.replace(script_tag, new_script_start)

# Fix the tall card clipping issue:
# Change `flex items-center justify-center p-6` to `flex justify-center p-6 py-10 overflow-y-auto`
html = html.replace('class="bg-gray-50 text-gray-900 antialiased min-h-screen flex items-center justify-center p-6"', 'class="bg-gray-50 text-gray-900 antialiased min-h-screen flex justify-center items-start md:items-center p-6 py-10 overflow-y-auto"')

with open("public/register.html", "w", encoding="utf-8") as f:
    f.write(html)
