import re

with open("public/js/staff-queue.js", "r", encoding="utf-8") as f:
    js = f.read()

# 1. Tab Classes
js = js.replace(
    "const ACTIVE_TAB_CLASSES = ['bg-surface-container-lowest', 'text-primary', 'shadow-sm'];",
    "const ACTIVE_TAB_CLASSES = ['bg-white', 'shadow-sm', 'text-gray-800', 'font-semibold'];\n  const INACTIVE_TAB_CLASSES = ['text-gray-500', 'hover:text-gray-700', 'font-medium'];"
)

js = js.replace(
    "tabEl.classList.toggle('text-on-surface-variant', !active);",
    "INACTIVE_TAB_CLASSES.forEach((cls) => tabEl.classList.toggle(cls, !active));"
)

# 2. Empty State
js = re.sub(
    r"function emptyState\(message, icon = 'inbox'\) \{.*?return `.*?<div class=\"p-space-lg flex flex-col items-center gap-space-xs text-center bg-surface-container-lowest rounded-lg shadow-sm\">.*?<span class=\"material-symbols-outlined text-\[32px\] text-outline\">\$\{icon\}</span>.*?<p class=\"font-body-md text-body-md text-on-surface-variant\">\$\{escapeHtml\(message\)\}</p>.*?</div>`;\n\s*\}",
    """function emptyState(message, icon = 'inbox') {
      return `<div class="p-8 flex flex-col items-center gap-2 text-center bg-white border border-gray-100 rounded-2xl shadow-sm text-gray-500">
          <span class="material-symbols-outlined text-[32px]">${icon}</span>
          <p class="text-sm">${escapeHtml(message)}</p>
        </div>`;
    }""",
    js, flags=re.DOTALL
)

# 3. Reservation Card
js = re.sub(
    r"function reservationCard\(reservation\) \{.*?return `.*?<div class=\"relative bg-surface-container-lowest.*?</div>`;\n\s*\}",
    """function reservationCard(reservation) {
      const id = escapeHtml(reservation.reservation_id);
      const requester = escapeHtml(reservation.customer_name || reservation.customer_email || 'Unknown requester');
      const meta = statusMeta(reservation.status);
      const isPending = reservation.status === 'Pending';
      
      let badgeBg = 'bg-gray-100 text-gray-700';
      if (reservation.status === 'Approved') badgeBg = 'bg-green-100 text-green-700';
      else if (reservation.status === 'Pending') badgeBg = 'bg-yellow-100 text-yellow-700';
      else if (reservation.status === 'Cancelled' || reservation.status === 'Rejected') badgeBg = 'bg-red-100 text-red-700';

      return `
        <div class="relative bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden transition-all hover:shadow-md mb-3" data-card-id="${id}">
          <div class="p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            <div class="flex flex-col md:flex-row md:items-center gap-4 flex-1">
              <div class="flex-shrink-0">
                <span class="px-2 py-1 rounded bg-[#FDF2F4] text-[#7a1f2b] text-xs font-bold tracking-wide border border-[#FDF2F4]">
                  #${shortId(reservation.reservation_id)}
                </span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex flex-wrap items-center gap-2 mb-1">
                  <h3 class="text-sm font-bold text-gray-900 truncate">${requester}</h3>
                  ${reservation.customer_email ? `<span class="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-xs truncate">${escapeHtml(reservation.customer_email)}</span>` : ''}
                  <span class="px-2 py-0.5 rounded ${badgeBg} text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                    <span class="material-symbols-outlined text-[12px]">${meta.icon}</span>
                    ${escapeHtml(meta.label)}
                  </span>
                  ${reservation.category ? `<span class="px-2 py-0.5 rounded border border-gray-200 text-gray-500 text-xs">${escapeHtml(reservation.category)}</span>` : ''}
                </div>
                
                <div class="flex items-center gap-1.5 text-xs text-gray-500 mt-1.5">
                  <span class="material-symbols-outlined text-[14px]">event</span>
                  <span>${formatDateTime(reservation.start_time)} &rarr; ${formatTime(reservation.end_time)}</span>
                  <span class="mx-1">&bull;</span>
                  <span class="material-symbols-outlined text-[14px]">meeting_room</span>
                  <span class="font-medium text-gray-700">${escapeHtml(reservation.room_name)}</span>
                </div>
                
                <p class="text-xs text-gray-600 mt-2 truncate w-full max-w-xl"><span class="font-semibold text-gray-700">Purpose:</span> ${escapeHtml(reservation.purpose)}</p>
                ${reservation.equipment_notes ? `<p class="text-xs text-gray-600 mt-1 truncate"><span class="font-semibold text-gray-700">Equip/Notes:</span> ${escapeHtml(reservation.equipment_notes)}</p>` : ''}
              </div>
            </div>
            
            <div class="flex flex-wrap items-center gap-2 shrink-0 border-t xl:border-t-0 border-gray-100 pt-3 xl:pt-0">
              <button type="button" onclick="window.CampusRoomStaff.openDetailModal('${id}')" class="px-3 py-1.5 text-xs font-semibold text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm">Details</button>
              ${isPending ? `<button type="button" onclick="window.CampusRoomStaff.decide('${id}', 'Rejected', '${requester}', this)" class="px-3 py-1.5 text-xs font-semibold text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-colors shadow-sm">Reject</button>` : ''}
              ${isPending ? `<button type="button" onclick="window.CampusRoomStaff.decide('${id}', 'Approved', '${requester}', this)" class="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors shadow-sm">Approve</button>` : ''}
              ${!isPending && reservation.status === 'Approved' ? `<button type="button" onclick="window.CampusRoomStaff.openStaffCancelModal('${id}', ${escapeHtml(JSON.stringify(reservation))})" class="px-3 py-1.5 text-xs font-semibold text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-colors shadow-sm">Cancel Booking</button>` : ''}
            </div>
          </div>
        </div>`;
    }""",
    js, flags=re.DOTALL
)

# 4. Move Request Card
js = re.sub(
    r"function moveCard\(request\) \{.*?return `.*?<div class=\"relative bg-surface-container-lowest.*?</div>`;\n\s*\}",
    """function moveCard(request) {
      const id = escapeHtml(request.request_id);
      const resId = escapeHtml(request.reservation_id);
      return `
        <div class="relative bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden transition-all hover:shadow-md mb-3" data-move-id="${id}">
          <div class="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-2">
                <span class="px-2 py-1 rounded bg-[#FDF2F4] text-[#7a1f2b] text-xs font-bold tracking-wide border border-[#FDF2F4]">Move REQ #${id}</span>
                <span class="text-xs text-gray-500">Ref: <a href="#" onclick="window.CampusRoomStaff.openDetailModal('${resId}')" class="text-[#7a1f2b] hover:underline">#${shortId(resId)}</a></span>
                <span class="px-2 py-0.5 rounded bg-yellow-100 text-yellow-700 text-[10px] font-bold uppercase tracking-wider">Pending</span>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mt-3">
                 <div class="p-3 bg-gray-50 rounded-xl border border-gray-100">
                    <div class="text-[10px] font-bold text-gray-500 uppercase mb-1">Current Booking</div>
                    <div class="font-semibold text-gray-800">${escapeHtml(request.old_room_name)}</div>
                    <div class="text-xs text-gray-600 mt-1">${formatDateTime(request.old_start_time)} - ${formatTime(request.old_end_time)}</div>
                 </div>
                 <div class="flex items-center justify-center hidden md:flex text-gray-300 absolute left-1/2 -translate-x-1/2">
                    <span class="material-symbols-outlined">arrow_forward</span>
                 </div>
                 <div class="p-3 bg-amber-50 rounded-xl border border-amber-100">
                    <div class="text-[10px] font-bold text-amber-600 uppercase mb-1">Requested Move</div>
                    <div class="font-semibold text-gray-800">${escapeHtml(request.new_room_name)}</div>
                    <div class="text-xs text-gray-600 mt-1">${formatDateTime(request.new_start_time)} - ${formatTime(request.new_end_time)}</div>
                 </div>
              </div>
              <p class="text-xs text-gray-600 mt-3"><span class="font-semibold text-gray-700">Reason:</span> ${escapeHtml(request.customer_reason)}</p>
            </div>
            
            <div class="flex flex-wrap items-center gap-2 shrink-0 border-t lg:border-t-0 border-gray-100 pt-3 lg:pt-0">
              <button type="button" onclick="window.CampusRoomStaff.openMoveModal('${id}')" class="px-4 py-2 text-xs font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors shadow-sm">Review Move</button>
            </div>
          </div>
        </div>`;
    }""",
    js, flags=re.DOTALL
)

# 5. Cancel Request Card
js = re.sub(
    r"function cancelRequestCard\(request\) \{.*?return `.*?<div class=\"relative bg-surface-container-lowest.*?</div>`;\n\s*\}",
    """function cancelRequestCard(request) {
      const id = escapeHtml(request.request_id);
      const resId = escapeHtml(request.reservation_id);
      return `
        <div class="relative bg-white rounded-2xl border border-red-100 shadow-sm overflow-hidden transition-all hover:shadow-md mb-3" data-cancel-id="${id}">
          <div class="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-2">
                <span class="px-2 py-1 rounded bg-red-100 text-red-700 text-xs font-bold tracking-wide border border-red-100">Cancel REQ #${id}</span>
                <span class="text-xs text-gray-500">Ref: <a href="#" onclick="window.CampusRoomStaff.openDetailModal('${resId}')" class="text-[#7a1f2b] hover:underline">#${shortId(resId)}</a></span>
              </div>
              <div class="text-xs text-gray-600 mt-2">
                 <span class="font-semibold text-gray-700">Reason:</span> ${escapeHtml(request.customer_reason)}
              </div>
              <div class="text-xs text-gray-500 mt-1">
                 Requested on ${formatDateTime(request.created_at)}
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0 border-t sm:border-t-0 border-gray-100 pt-3 sm:pt-0">
               <button type="button" onclick="window.CampusRoomStaff.openCancelRequestModal('${id}')" class="px-4 py-2 text-xs font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors shadow-sm">Review Request</button>
            </div>
          </div>
        </div>`;
    }""",
    js, flags=re.DOTALL
)

# 6. Facility Card
js = re.sub(
    r"function facilityCard\(room\) \{.*?return `.*?<div class=\"bg-surface-container rounded-lg.*?</div>`;\n\s*\}",
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
        <div class="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden flex flex-col">
           <div class="p-4 border-b border-gray-50 flex items-start justify-between gap-2">
              <div>
                 <div class="text-xs font-bold text-gray-400 tracking-wider uppercase mb-1">${escapeHtml(room.room_type)} &bull; ${escapeHtml(room.floor)}</div>
                 <h4 class="font-bold text-gray-900 text-sm leading-tight mb-2">${rName}</h4>
                 <span class="px-2 py-0.5 rounded ${badgeBg} text-[10px] font-bold uppercase tracking-wider">${escapeHtml(room.status)}</span>
              </div>
              <div class="flex flex-col gap-1 items-end shrink-0">
                <span class="material-symbols-outlined text-gray-400 text-[20px]">meeting_room</span>
                <span class="text-[10px] font-semibold text-gray-500">Cap: ${room.capacity}</span>
              </div>
           </div>
           <div class="p-3 bg-gray-50 flex items-center justify-between gap-2 mt-auto">
              <span class="text-xs font-medium text-gray-600">Quick Toggle:</span>
              <div class="flex items-center gap-1">
                 ${!isOperational ? `<button type="button" onclick="window.CampusRoomStaff.toggleFacility('${rId}','Operational','${rName}',this)" class="p-1 rounded text-emerald-600 hover:bg-emerald-100 transition-colors" title="Set Operational"><span class="material-symbols-outlined text-[18px]">check_circle</span></button>` : ''}
                 ${!isMaint ? `<button type="button" onclick="window.CampusRoomStaff.toggleFacility('${rId}','Maintenance','${rName}',this)" class="p-1 rounded text-amber-600 hover:bg-amber-100 transition-colors" title="Set Maintenance"><span class="material-symbols-outlined text-[18px]">build</span></button>` : ''}
                 ${!isLocked ? `<button type="button" onclick="window.CampusRoomStaff.toggleFacility('${rId}','Locked','${rName}',this)" class="p-1 rounded text-red-600 hover:bg-red-100 transition-colors" title="Lock Room"><span class="material-symbols-outlined text-[18px]">lock</span></button>` : ''}
              </div>
           </div>
        </div>`;
    }""",
    js, flags=re.DOTALL
)

with open("public/js/staff-queue.js", "w", encoding="utf-8") as f:
    f.write(js)
