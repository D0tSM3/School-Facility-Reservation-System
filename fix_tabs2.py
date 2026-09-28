import re

with open("public/js/reservations.js", "r", encoding="utf-8") as f:
    content = f.read()

# 1. Remove the activeFilter declaration from its current location
content = re.sub(
    r"\s*const urlParams = new URLSearchParams\(window\.location\.search\);\s*let activeFilter = urlParams\.get\('filter'\) \|\| 'all';",
    "",
    content
)

# 2. Insert it before the tabs logic
replacement = """
  const urlParams = new URLSearchParams(window.location.search);
  let activeFilter = urlParams.get('filter') || 'all';

  const tabs = document.querySelectorAll('.filter-btn');

  // Sync visual tab state with activeFilter on load
"""

content = content.replace(
    """
  const tabs = document.querySelectorAll('.filter-btn');

  // Sync visual tab state with activeFilter on load
""",
    replacement
)

with open("public/js/reservations.js", "w", encoding="utf-8") as f:
    f.write(content)
