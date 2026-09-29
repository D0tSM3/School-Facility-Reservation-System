import re

with open("public/js/staff-dashboard.js", "r", encoding="utf-8") as f:
    js = f.read()

# Replace the inner block of reservationCard to include the checkbox
old_block = """<div class="flex-shrink-0">
                  <span class="px-2.5 py-1.5 rounded-lg bg-[#FDF2F4] text-[#7a1f2b] text-xs font-bold tracking-wide border border-[#FDF2F4]">
                    #${shortId(reservation.reservation_id)}
                  </span>
                </div>"""

new_block = """<div class="flex-shrink-0 flex items-center gap-3">
                  ${isPending ? `<input type="checkbox" value="${id}" class="batch-checkbox w-4 h-4 text-[#7a1f2b] bg-gray-50 border-gray-300 rounded focus:ring-[#7a1f2b] cursor-pointer" onchange="window.CampusRoomStaff.updateBatchButton()">` : ""}
                  <span class="px-2.5 py-1.5 rounded-lg bg-[#FDF2F4] text-[#7a1f2b] text-xs font-bold tracking-wide border border-[#FDF2F4]">
                    #${shortId(reservation.reservation_id)}
                  </span>
                </div>"""

js = js.replace(old_block, new_block)

with open("public/js/staff-dashboard.js", "w", encoding="utf-8") as f:
    f.write(js)
