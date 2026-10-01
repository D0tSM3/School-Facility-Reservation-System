import re

with open("public/index.html", "r", encoding="utf-8") as f:
    html = f.read()

# Remove the "Remember my device" label block
pattern = re.compile(r'<label class="flex items-center gap-3 cursor-pointer py-1 select-none">.*?Remember my device on BPU campus network.*?</span>\s*</label>', re.DOTALL)
html = pattern.sub('', html)

with open("public/index.html", "w", encoding="utf-8") as f:
    f.write(html)
