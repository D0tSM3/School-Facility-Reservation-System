import re

def fix_clipping(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        html = f.read()

    # Remove items-center from the body and just use items-start
    html = re.sub(r'items-start md:items-center', 'items-start', html)
    html = re.sub(r'flex items-center justify-center', 'flex justify-center items-start overflow-y-auto', html)

    # Add my-auto to the <main> tag to center it safely
    html = re.sub(r'<main class="w-full max-w-\[950px\]">', '<main class="w-full max-w-[950px] my-auto">', html)

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(html)

fix_clipping("public/register.html")
fix_clipping("public/index.html")
