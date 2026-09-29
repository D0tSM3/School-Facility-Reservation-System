import re

# 1. Update staff-dashboard.html metric cards
with open("public/staff-dashboard.html", "r", encoding="utf-8") as f:
    html = f.read()

# Remove the word "Requests" from the move-badge-count and cancel-badge-count spans? 
# Wait, the word "Requests" isn't in the HTML, it's injected by JS!
# Let's check staff-dashboard.js: `if (moveBadge) moveBadge.textContent = \`${state.moveRequests.length} Requests\`;`

# 2. Update staff-dashboard.js
with open("public/js/staff-dashboard.js", "r", encoding="utf-8") as f:
    js = f.read()

# Remove " Requests" from badges
js = js.replace("moveBadge.textContent = `${state.moveRequests.length} Requests`;", "moveBadge.textContent = `${state.moveRequests.length}`;")
js = js.replace("cancelReqBadge.textContent = `${state.cancelRequests.length} Requests`;", "cancelReqBadge.textContent = `${state.cancelRequests.length}`;")

# Rewrite moveCard
js = re.sub(
    r"function moveCard\(request\) \{.*?return `.*?</div>`;\n\s*\}",
    """function moveCard(request) {
      const id = escapeHtml(request.request_id);
      const resId = escapeHtml(request.reservation_id);
      return `
        <div class="relative bg-white rounded-2xl border border-blue-200 shadow-sm overflow-hidden transition-all hover:shadow-md mb-4" data-move-id="${id}">
          <div class="p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-5">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-3">
                <span class="px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs font-bold tracking-wide border border-blue-100">Move REQ #${shortId(id)}</span>
                <span class="text-xs text-gray-500 font-semibold">Ref: <a href="#" onclick="window.CampusRoomStaff.openDetailModal('${resId}')" class="text-[#7a1f2b] hover:underline">#${shortId(resId)}</a></span>
              </div>
              <div class="flex flex-col md:flex-row gap-4 text-sm mt-3 items-stretch">
                 <div class="flex-1 p-4 bg-gray-50 rounded-xl border border-gray-100 relative">
                    <div class="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Current Booking</div>
                    <div class="font-bold text-gray-900">${escapeHtml(request.room_name)}</div>
                    <div class="text-xs text-gray-600 mt-1">${formatDateTime(request.original_start_time)} - ${formatTime(request.original_end_time)}</div>
                 </div>
                 <div class="flex-1 p-4 bg-blue-50 rounded-xl border border-blue-100 relative">
                    <div class="text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-1">Requested Move</div>
                    <div class="font-bold text-gray-900">${escapeHtml(request.room_name)}</div>
                    <div class="text-xs text-gray-600 mt-1">${formatDateTime(request.requested_start_time)} - ${formatTime(request.requested_end_time)}</div>
                 </div>
              </div>
            </div>
            
            <div class="flex flex-wrap items-center gap-2 shrink-0 border-t xl:border-t-0 border-gray-100 pt-4 xl:pt-0">
              <button type="button" onclick="window.CampusRoomStaff.openMoveModal('${id}')" class="px-6 py-2.5 text-sm font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors shadow-sm">Review Move</button>
            </div>
          </div>
        </div>`;
    }""",
    js, flags=re.DOTALL
)

with open("public/js/staff-dashboard.js", "w", encoding="utf-8") as f:
    f.write(js)
