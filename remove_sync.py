import os

with open("public/staff-dashboard.html", "r", encoding="utf-8") as f:
    html = f.read()

# Remove the sync block
html = html.replace("""<div class="flex items-center gap-2 mb-2">
              <span class="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" id="sync-indicator"></span>
              <span class="text-[11px] font-bold uppercase tracking-wider text-emerald-600" id="sync-timestamp">Live Staff Dispatch Feed</span>
            </div>""", "")

with open("public/staff-dashboard.html", "w", encoding="utf-8") as f:
    f.write(html)
