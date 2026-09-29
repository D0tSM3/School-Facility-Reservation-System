import re

with open("public/staff-dashboard.html", "r", encoding="utf-8") as f:
    html = f.read()

# Replace the toolbar
toolbar_pattern = re.compile(r'<div class="flex items-center gap-3 shrink-0">.*?</div>', re.DOTALL)

new_toolbar = """<div class="flex items-center gap-3 shrink-0 w-full md:w-auto">
              <!-- Search Bar -->
              <div class="relative flex-1 md:w-64">
                <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[20px]">search</span>
                <input type="text" id="searchInput" placeholder="Search name, room, or ID..." class="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-xl text-sm focus:outline-none focus:border-[#7a1f2b] focus:ring-1 focus:ring-[#7a1f2b] transition-colors">
              </div>
              
              <!-- Batch Approve Button -->
              <button type="button" id="btn-batch-approve" disabled class="px-5 py-2 bg-[#7a1f2b] text-white font-semibold rounded-xl shadow-sm hover:bg-[#5e1821] transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                <span class="material-symbols-outlined text-[20px]">done_all</span>
                <span id="batch-approve-label">Approve Selected</span>
              </button>
            </div>"""

html = re.sub(r'<div class="flex items-center gap-3 shrink-0">.*?Refresh Queue.*?</button>.*?</div>', new_toolbar, html, flags=re.DOTALL)

with open("public/staff-dashboard.html", "w", encoding="utf-8") as f:
    f.write(html)
