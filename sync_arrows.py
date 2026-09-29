import re

with open("public/index.html", "r", encoding="utf-8") as f:
    html = f.read()

# Replace login with arrow_forward in index.html
html = html.replace('login\n                  </span>\n                </button>', 'arrow_forward\n                  </span>\n                </button>')

with open("public/index.html", "w", encoding="utf-8") as f:
    f.write(html)

with open("public/register.html", "r", encoding="utf-8") as f:
    reg = f.read()

# Replace login with arrow_forward in register.html
reg = reg.replace('login\n                </span>\n              </button>', 'arrow_forward\n                </span>\n              </button>')

with open("public/register.html", "w", encoding="utf-8") as f:
    f.write(reg)
