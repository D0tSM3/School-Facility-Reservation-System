import re

with open("public/js/staff-dashboard.js", "r", encoding="utf-8") as f:
    js = f.read()

# Replace facilityCard
js = re.sub(
    r"function facilityCard\(room\) \{.*?return `.*?</div>`;\n\s*\}",
    """function facilityCard(room) {
      const isAvailable = room.status === 'Available';
      const isMaint = room.status === 'Maintenance';
      
      let badgeBg = 'bg-gray-100 text-gray-700';
      if (isAvailable) badgeBg = 'bg-emerald-100 text-emerald-700';
      else if (isMaint) badgeBg = 'bg-amber-100 text-amber-700';
      
      const rId = escapeHtml(room.room_id);
      const rName = escapeHtml(room.name);
      
      return `
        <div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow">
           <div class="p-5 border-b border-gray-50 flex items-start justify-between gap-3">
              <div>
                 <div class="text-[10px] font-bold text-gray-400 tracking-wider uppercase mb-1">${escapeHtml(room.room_type)} &bull; Floor ${escapeHtml(room.floor)}</div>
                 <h4 class="font-bold text-gray-900 text-base leading-tight mb-2">${rName}</h4>
                 <span class="px-2 py-0.5 rounded ${badgeBg} text-[10px] font-bold uppercase tracking-wider">${escapeHtml(room.status)}</span>
              </div>
              <div class="flex flex-col gap-1 items-end shrink-0">
                <span class="material-symbols-outlined text-gray-300 text-[24px]">meeting_room</span>
                <span class="text-xs font-semibold text-gray-500">Cap: ${room.capacity}</span>
              </div>
           </div>
           <div class="p-4 bg-[#f8f9fb] flex flex-col gap-3 mt-auto">
              <span class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Quick State Toggle</span>
              <div class="grid grid-cols-2 gap-2">
                 <button type="button" onclick="window.CampusRoomStaff.toggleFacility('${rId}','Available','${rName}',this)" class="flex items-center justify-center py-2 rounded-lg border border-emerald-200 text-emerald-600 hover:bg-emerald-50 transition-colors ${isAvailable ? 'bg-emerald-50 ring-2 ring-emerald-500 border-transparent' : 'bg-white'}" title="Set Available"><span class="material-symbols-outlined text-[20px]">check_circle</span></button>
                 <button type="button" onclick="window.CampusRoomStaff.toggleFacility('${rId}','Maintenance','${rName}',this)" class="flex items-center justify-center py-2 rounded-lg border border-amber-200 text-amber-600 hover:bg-amber-50 transition-colors ${isMaint ? 'bg-amber-50 ring-2 ring-amber-500 border-transparent' : 'bg-white'}" title="Set Maintenance"><span class="material-symbols-outlined text-[20px]">build</span></button>
              </div>
           </div>
        </div>`;
    }""",
    js, flags=re.DOTALL
)

with open("public/js/staff-dashboard.js", "w", encoding="utf-8") as f:
    f.write(js)
