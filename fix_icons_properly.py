import re

# 1. Inject the icon style into index.html
with open("public/index.html", "r", encoding="utf-8") as f:
    html = f.read()

style_block = """
    <style id="icon-fill">
      .material-symbols-outlined {
        font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24 !important;
      }
    </style>
"""

# ensure we don't inject twice
if "id=\"icon-fill\"" not in html:
    html = html.replace('</head>', style_block + '</head>')

# Ensure the correct google fonts url is used for icons (register.html uses one that supports GRAD/opsz)
font_link_old = 'href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap"'
font_link_new = 'href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"'
html = html.replace(font_link_old, font_link_new)

with open("public/index.html", "w", encoding="utf-8") as f:
    f.write(html)

# 2. Change Last Name icon to `person` in register.html
with open("public/register.html", "r", encoding="utf-8") as f:
    reg = f.read()

# Replace the "badge" icon for Last Name with "person"
reg = reg.replace('badge\n                    </span>\n                    <input\n                      class="w-full bg-[#f8f9fb] border border-[#dcc0c0] rounded-lg pl-10 pr-3 py-2.5 text-[#191c1e] text-[14px] focus:bg-white focus:border-[#7a1f2b] focus:ring-1 focus:ring-[#7a1f2b] focus:outline-none transition-all placeholder:text-[#897172]"\n                      id="bpu-lname"', 'person\n                    </span>\n                    <input\n                      class="w-full bg-[#f8f9fb] border border-[#dcc0c0] rounded-lg pl-10 pr-3 py-2.5 text-[#191c1e] text-[14px] focus:bg-white focus:border-[#7a1f2b] focus:ring-1 focus:ring-[#7a1f2b] focus:outline-none transition-all placeholder:text-[#897172]"\n                      id="bpu-lname"')

with open("public/register.html", "w", encoding="utf-8") as f:
    f.write(reg)
