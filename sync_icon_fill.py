import re

with open("public/index.html", "r", encoding="utf-8") as f:
    html = f.read()

# Check if style block exists, if not inject it
style_block = """    <style>
      .material-symbols-outlined {
        font-variation-settings: 'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24;
      }
    </style>"""

if "<style>" not in html:
    html = html.replace('</head>', f'{style_block}\n  </head>')

with open("public/index.html", "w", encoding="utf-8") as f:
    f.write(html)
