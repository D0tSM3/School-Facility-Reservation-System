import re
import os

with open("public/js/staff-dashboard.js", "r", encoding="utf-8") as f:
    js = f.read()

# Remove sync logic
js = re.sub(r"const syncTimestamp = el\('sync-timestamp'\);", "", js)
js = re.sub(r"const syncIndicator = el\('sync-indicator'\);", "", js)
js = re.sub(r"function stampSync\(\)\s*\{.*?\s*\}", "function stampSync() {}", js, flags=re.DOTALL)
js = re.sub(r"if \(syncIndicator\) syncIndicator.classList.add\('animate-pulse'\);", "", js)

# Fix emptyState
js = re.sub(
    r"function emptyState\(message, icon = 'inbox'\) \{.*?return `.*?</div>`;\n\s*\}",
    """function emptyState(message, icon = 'inbox') {
      return `<div class="p-8 flex flex-col items-center gap-2 text-center bg-white border border-gray-100 rounded-2xl shadow-sm text-gray-500">
          <span class="material-symbols-outlined text-[32px]">${icon}</span>
          <p class="text-sm">${escapeHtml(message)}</p>
        </div>`;
    }""",
    js, flags=re.DOTALL
)

# Replace reservationCard
js = re.sub(
    r"function reservationCard\(reservation\) \{.*?return `.*?<div class=\"relative bg-white.*?</div>`;\n\s*\}",
    """function reservationCard(reservation) {
      const id = escapeHtml(reservation.reservation_id);
      const requester = escapeHtml(reservation.customer_name || reservation.customer_email || 'Unknown requester');
      const isPending = reservation.status === 'Pending';
      
      let badgeBg = 'bg-gray-100 text-gray-700';
      if (reservation.status === 'Approved') badgeBg = 'bg-green-100 text-green-700';
      else if (isPending) badgeBg = 'bg-amber-100 text-amber-700';
      else if (reservation.status === 'Cancelled' || reservation.status === 'Rejected') badgeBg = 'bg-red-100 text-red-700';

      return `
        <div class="relative bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden transition-all hover:shadow-md hover:border-gray-300 mb-4" data-card-id="${id}">
          <div class="p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-5">
            <div class="flex flex-col md:flex-row md:items-center gap-5 flex-1">
              <div class="flex-shrink-0">
                <span class="px-2.5 py-1.5 rounded-lg bg-[#FDF2F4] text-[#7a1f2b] text-xs font-bold tracking-wide border border-[#FDF2F4]">
                  #${shortId(reservation.reservation_id)}
                </span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex flex-wrap items-center gap-2 mb-2">
                  <h3 class="text-base font-bold text-gray-900 truncate">${requester}</h3>
                  ${reservation.customer_email ? `<span class="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-bold uppercase truncate">${escapeHtml(reservation.customer_email)}</span>` : ''}
                  <span class="px-2 py-0.5 rounded ${badgeBg} text-[10px] font-bold uppercase tracking-wider">${escapeHtml(reservation.status)}</span>
                  ${reservation.category ? `<span class="px-2 py-0.5 rounded border border-gray-200 text-gray-500 text-xs">${escapeHtml(reservation.category)}</span>` : ''}
                </div>
                
                <div class="flex items-center gap-2 text-sm text-gray-500 mt-1 mb-2">
                  <span class="material-symbols-outlined text-[16px] text-gray-400">event</span>
                  <span class="font-medium">${formatDateTime(reservation.start_time)} &rarr; ${formatTime(reservation.end_time)}</span>
                  <span class="mx-1">&bull;</span>
                  <span class="material-symbols-outlined text-[16px] text-gray-400">meeting_room</span>
                  <span class="font-semibold text-gray-700">${escapeHtml(reservation.room_name)}</span>
                </div>
                
                <p class="text-sm text-gray-600 truncate w-full max-w-2xl"><span class="font-semibold text-gray-700">Purpose:</span> ${escapeHtml(reservation.purpose)}</p>
                ${reservation.equipment_notes ? `<p class="text-sm text-gray-600 mt-1 truncate"><span class="font-semibold text-gray-700">Equip/Notes:</span> ${escapeHtml(reservation.equipment_notes)}</p>` : ''}
              </div>
            </div>
            
            <div class="flex flex-wrap items-center gap-2 shrink-0 border-t xl:border-t-0 border-gray-100 pt-4 xl:pt-0">
              <button type="button" onclick="window.CampusRoomStaff.openDetailModal('${id}')" class="px-4 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors shadow-sm">Details</button>
              ${isPending ? `<button type="button" onclick="window.CampusRoomStaff.decide('${id}', 'Rejected', '${requester}', this)" class="px-4 py-2 text-sm font-semibold text-red-600 bg-white border border-red-200 rounded-xl hover:bg-red-50 transition-colors shadow-sm">Reject</button>` : ''}
              ${isPending ? `<button type="button" onclick="window.CampusRoomStaff.decide('${id}', 'Approved', '${requester}', this)" class="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 transition-colors shadow-sm">Approve</button>` : ''}
              ${!isPending && reservation.status === 'Approved' ? `<button type="button" onclick="window.CampusRoomStaff.openStaffCancelModal('${id}', ${escapeHtml(JSON.stringify(reservation))})" class="px-4 py-2 text-sm font-semibold text-red-600 bg-white border border-red-200 rounded-xl hover:bg-red-50 transition-colors shadow-sm">Cancel Booking</button>` : ''}
            </div>
          </div>
        </div>`;
    }""",
    js, flags=re.DOTALL
)

# Replace moveCard
js = re.sub(
    r"function moveCard\(request\) \{.*?return `.*?<div class=\"relative bg-white.*?</div>`;\n\s*\}",
    """function moveCard(request) {
      const id = escapeHtml(request.request_id);
      const resId = escapeHtml(request.reservation_id);
      return `
        <div class="relative bg-white rounded-2xl border border-blue-200 shadow-sm overflow-hidden transition-all hover:shadow-md mb-4" data-move-id="${id}">
          <div class="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-3">
                <span class="px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs font-bold tracking-wide border border-blue-100">Move REQ #${id}</span>
                <span class="text-xs text-gray-500 font-semibold">Ref: <a href="#" onclick="window.CampusRoomStaff.openDetailModal('${resId}')" class="text-[#7a1f2b] hover:underline">#${shortId(resId)}</a></span>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mt-3">
                 <div class="p-4 bg-gray-50 rounded-xl border border-gray-100 relative">
                    <div class="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Current Booking</div>
                    <div class="font-bold text-gray-900">${escapeHtml(request.old_room_name)}</div>
                    <div class="text-xs text-gray-600 mt-1">${formatDateTime(request.old_start_time)} - ${formatTime(request.old_end_time)}</div>
                 </div>
                 <div class="p-4 bg-blue-50 rounded-xl border border-blue-100 relative">
                    <div class="text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-1">Requested Move</div>
                    <div class="font-bold text-gray-900">${escapeHtml(request.new_room_name)}</div>
                    <div class="text-xs text-gray-600 mt-1">${formatDateTime(request.new_start_time)} - ${formatTime(request.new_end_time)}</div>
                 </div>
              </div>
              <p class="text-sm text-gray-600 mt-4"><span class="font-semibold text-gray-700">Reason for moving:</span> ${escapeHtml(request.customer_reason)}</p>
            </div>
            
            <div class="flex flex-wrap items-center gap-2 shrink-0 border-t lg:border-t-0 border-gray-100 pt-4 lg:pt-0">
              <button type="button" onclick="window.CampusRoomStaff.openMoveModal('${id}')" class="px-5 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors shadow-sm">Review Move</button>
            </div>
          </div>
        </div>`;
    }""",
    js, flags=re.DOTALL
)

# Replace cancelRequestCard
js = re.sub(
    r"function cancelRequestCard\(request\) \{.*?return `.*?<div class=\"relative bg-white.*?</div>`;\n\s*\}",
    """function cancelRequestCard(request) {
      const id = escapeHtml(request.request_id);
      const resId = escapeHtml(request.reservation_id);
      return `
        <div class="relative bg-white rounded-2xl border border-red-200 shadow-sm overflow-hidden transition-all hover:shadow-md mb-4" data-cancel-id="${id}">
          <div class="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-2">
                <span class="px-2 py-1 rounded bg-red-50 text-red-700 text-xs font-bold tracking-wide border border-red-100">Cancel REQ #${id}</span>
                <span class="text-xs text-gray-500 font-semibold">Ref: <a href="#" onclick="window.CampusRoomStaff.openDetailModal('${resId}')" class="text-[#7a1f2b] hover:underline">#${shortId(resId)}</a></span>
              </div>
              <div class="text-sm text-gray-600 mt-3">
                 <span class="font-semibold text-gray-700">Reason given:</span> ${escapeHtml(request.customer_reason)}
              </div>
              <div class="text-xs text-gray-400 mt-2">
                 Requested on ${formatDateTime(request.created_at)}
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0 border-t sm:border-t-0 border-gray-100 pt-4 sm:pt-0">
               <button type="button" onclick="window.CampusRoomStaff.openCancelRequestModal('${id}')" class="px-5 py-2.5 text-sm font-semibold text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors shadow-sm">Review Request</button>
            </div>
          </div>
        </div>`;
    }""",
    js, flags=re.DOTALL
)

# Replace facilityCard
js = re.sub(
    r"function facilityCard\(room\) \{.*?return `.*?</div>`;\n\s*\}",
    """function facilityCard(room) {
      const isOperational = room.status === 'Operational';
      const isMaint = room.status === 'Maintenance';
      const isLocked = room.status === 'Locked';
      
      let badgeBg = 'bg-gray-100 text-gray-700';
      if (isOperational) badgeBg = 'bg-emerald-100 text-emerald-700';
      else if (isMaint) badgeBg = 'bg-amber-100 text-amber-700';
      else if (isLocked) badgeBg = 'bg-red-100 text-red-700';
      
      const rId = escapeHtml(room.room_id);
      const rName = escapeHtml(room.name);
      
      return `
        <div class="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow">
           <div class="p-5 border-b border-gray-50 flex items-start justify-between gap-3">
              <div>
                 <div class="text-[10px] font-bold text-gray-400 tracking-wider uppercase mb-1">${escapeHtml(room.room_type)} &bull; ${escapeHtml(room.floor)}</div>
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
              <div class="grid grid-cols-3 gap-2">
                 <button type="button" onclick="window.CampusRoomStaff.toggleFacility('${rId}','Operational','${rName}',this)" class="flex items-center justify-center py-2 rounded-lg border border-emerald-200 text-emerald-600 hover:bg-emerald-50 transition-colors ${isOperational ? 'bg-emerald-50 ring-2 ring-emerald-500 border-transparent' : 'bg-white'}" title="Set Operational"><span class="material-symbols-outlined text-[20px]">check_circle</span></button>
                 <button type="button" onclick="window.CampusRoomStaff.toggleFacility('${rId}','Maintenance','${rName}',this)" class="flex items-center justify-center py-2 rounded-lg border border-amber-200 text-amber-600 hover:bg-amber-50 transition-colors ${isMaint ? 'bg-amber-50 ring-2 ring-amber-500 border-transparent' : 'bg-white'}" title="Set Maintenance"><span class="material-symbols-outlined text-[20px]">build</span></button>
                 <button type="button" onclick="window.CampusRoomStaff.toggleFacility('${rId}','Locked','${rName}',this)" class="flex items-center justify-center py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors ${isLocked ? 'bg-red-50 ring-2 ring-red-500 border-transparent' : 'bg-white'}" title="Lock Room"><span class="material-symbols-outlined text-[20px]">lock</span></button>
              </div>
           </div>
        </div>`;
    }""",
    js, flags=re.DOTALL
)

with open("public/js/staff-dashboard.js", "w", encoding="utf-8") as f:
    f.write(js)
