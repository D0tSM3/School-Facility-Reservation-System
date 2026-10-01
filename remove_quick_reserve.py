import re

with open("public/dashboard.html", "r", encoding="utf-8") as f:
    html = f.read()

# Remove the quickReserveBtn
html = re.sub(
    r'<button id="quickReserveBtn".*?</button>',
    '',
    html,
    flags=re.DOTALL
)

# Remove the quickReserveModal
html = re.sub(
    r'<!-- Quick Reserve Modal -->.*?<div id="quickReserveModal".*?</div>\s*</div>\s*</div>\s*</div>',
    '',
    html,
    flags=re.DOTALL
)

with open("public/dashboard.html", "w", encoding="utf-8") as f:
    f.write(html)
