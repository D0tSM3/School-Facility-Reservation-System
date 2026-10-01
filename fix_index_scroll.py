import re

with open("public/index.html", "r", encoding="utf-8") as f:
    html = f.read()

# Fix the tall card clipping issue in index.html too:
html = html.replace('class="bg-background font-body-md text-on-surface antialiased min-h-screen flex items-center justify-center \np-space-md"', 'class="bg-background font-body-md text-on-surface antialiased min-h-screen flex justify-center items-start md:items-center p-space-md py-10 overflow-y-auto"')
html = html.replace('class="bg-background font-body-md text-on-surface antialiased min-h-screen flex items-center justify-center p-space-md"', 'class="bg-background font-body-md text-on-surface antialiased min-h-screen flex justify-center items-start md:items-center p-space-md py-10 overflow-y-auto"')

with open("public/index.html", "w", encoding="utf-8") as f:
    f.write(html)
