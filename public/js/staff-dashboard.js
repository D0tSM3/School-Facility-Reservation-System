/**
 * CampusRoom — Staff Dispatch & Room Maintenance Queue
 *
 * Every control on this page is wired to the real API:
 *   GET   api/auth/me                              → session / role guard
 *   GET   api/reservations                         → pending queue + KPIs
 *   PATCH api/reservations/{id}                    → approve / reject
 *   GET   api/rooms                                → facility state grid
 *   PATCH api/rooms/{id}                           → maintenance toggle
 *   GET   api/reservations/move-requests           → move request queue
 *   PATCH api/reservations/move-requests/{id}      → approve / reject a move
 *   GET   api/logs                                 → audit log archive (rendered by js/logArchive.js)
 *   GET   api/reservations/{id}/logs               → per-booking log timeline (rendered by js/logArchive.js)
 *   GET   api/reservations/{id}                    → confirmation slip (rendered by js/slip.js)
 *   POST  api/reservations/{id}/rebook             → staff re-book modal (rendered by js/rebook.js)
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const BASE = window.location.pathname.replace(/[^\/]*$/, '');

  // Shared helpers (js/util.js). Declared up here so nothing can call them before they exist.
  const { escapeHtml, parseDate } = window.CampusRoomUtil;

  // ---------------------------------------------------------------
  // Element handles
  // ---------------------------------------------------------------

  const el = (id) => document.getElementById(id);

  const tabPending      = el('tab-pending');
  const tabMoves        = el('tab-moves');
  const tabCancels      = el('tab-cancels');
  const tabOverrides    = el('tab-overrides');
  const tabAll          = el('tab-all');
  const tabMaintenance  = el('tab-maintenance');
  const viewPending     = el('view-pending');
  const viewMoves       = el('view-moves');
  const viewCancels     = el('view-cancels');
  const viewOverrides   = el('view-overrides');
  const viewAll         = el('view-all');
  const viewAllList     = el('view-all-list');
  const viewMaintenance = el('view-maintenance');
  const allStatusFilter = el('all-status-filter');

  const pendingBadge     = el('pending-badge-count');
  const moveBadge        = el('move-badge-count');
  const cancelReqBadge   = el('cancel-badge-count');
  const overrideBadge    = el('override-badge-count');
  const allBadge         = el('all-badge-count');
  const maintenanceBadge = el('maintenance-badge-count');
  const kpiPending       = el('kpi-pending-count');
  const kpiMaintenance   = el('kpi-maintenance-count');
  const kpiAuth          = el('kpi-auth-count');

  const batchApproveBtn   = el('btn-batch-approve');
  const searchInput       = el('searchInput');
  const batchApproveLabel = el('batch-approve-label');
      const exportLogBtn      = el('btn-export-log');

  const toast       = el('action-toast');
  const toastText   = el('action-toast-text');
  const toastIcon   = el('action-toast-icon');
  const toastDismiss = el('btn-dismiss-toast');

  const facilityFilter = el('facility-filter');
  const facilityGrid   = el('view-maintenance-list');

  const alertBox      = el('maintenance-alert');
  const alertLocation = el('maintenance-alert-location');
  const alertTitle    = el('maintenance-alert-title');
  const alertBody     = el('maintenance-alert-body');
  const alertBtn      = el('btn-maintenance-alert-toggle');
  const alertBtnLabel = el('btn-maintenance-alert-label');

  
  
  const accessNotice  = el('access-notice');
  const accessText    = el('access-notice-text');

  // Move review modal
  const moveOverlay    = el('moveReviewModalOverlay');
  const moveSummary    = el('moveReviewSummary');
  const moveComment    = el('moveReviewComment');
  const moveError      = el('moveReviewErrorMsg');
  const moveApproveBtn = el('moveReviewApproveBtn');
  const moveRejectBtn  = el('moveReviewRejectBtn');

  // Cancellation request review modal
  const cancelReqOverlay    = el('cancelReviewModalOverlay');
  const cancelReqSummary    = el('cancelReviewSummary');
  const cancelReqComment    = el('cancelReviewComment');
  const cancelReqError      = el('cancelReviewErrorMsg');
  const cancelReqApproveBtn = el('cancelReviewApproveBtn');
  const cancelReqRejectBtn  = el('cancelReviewRejectBtn');

  // Detail modal
  const detailOverlay = el('detailModalOverlay');
  const detailBody    = el('detailModalBody');

  // Staff cancellation modal (reason required — see submitStaffCancel())
  const staffCancelOverlay     = el('staffCancelModalOverlay');
  const staffCancelSummary     = el('staffCancelSummary');
  const staffCancelReasonInput = el('staffCancelReasonInput');
  const staffCancelError       = el('staffCancelError');
  const staffCancelCloseIcon   = el('staffCancelCloseIcon');
  const staffCancelCancelBtn   = el('staffCancelCancelBtn');
  const staffCancelConfirmBtn  = el('staffCancelConfirmBtn');

  // ---------------------------------------------------------------
  // State
  // ---------------------------------------------------------------

  const state = {
    reservations: [],
    rooms: [],
    moveRequests: [],
    cancelRequests: [],
    overrideRequests: [],
    conflicts: {},          // reservation_id -> conflict reason (Pending rows that fail validation)
    suggestionsByRes: {},   // reservation_id -> latest facility suggestion for that booking
    activeTab: 'pending',
    wingFilter: 'all',
    allStatusFilter: 'all',
    currentMoveId: null,
    currentCancelReqId: null,
    currentCancelId: null,
    loading: false,
    searchQuery: ''
  };

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------

  /* parseDate() now lives in util.js (Section 8) — same helper reservations.js
     and dashboard.js use, so a MySQL/Postgres DATETIME string parses the
     same way (and doesn't silently fail on Safari) everywhere in the app. */

  function formatDay(value) {
    const date = parseDate(value);
    return date
      ? date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
      : '—';
  }

  function formatTime(value) {
    const date = parseDate(value);
    return date
      ? date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : '—';
  }

  function formatDateTime(value) {
    const date = parseDate(value);
    return date ? `${formatDay(value)} ${formatTime(value)}` : '—';
  }

  function isToday(value) {
    const date = parseDate(value);
    if (!date) return false;
    const now = new Date();
    return date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate();
  }

  /** "Lab • Floor 2 • Cap 36" from whatever room fields are populated. */
  function roomMeta(source) {
    const parts = [];
    if (source.room_type) parts.push(source.room_type);
    if (source.floor !== null && source.floor !== undefined && source.floor !== '') {
      parts.push(`Floor ${source.floor}`);
    }
    if (source.capacity) parts.push(`Cap ${source.capacity}`);
    return parts.join(' • ') || 'Campus facility';
  }

  function shortId(value) {
    return String(value ?? '').substring(0, 8).toUpperCase();
  }

  /**
   * Status → { accent bar color, badge icon/label/color }. Same palette as
   * public/js/reservations.js so a status reads the same everywhere in the app.
   */
  const STATUS_META = {
    Pending:   { accent: 'bg-secondary',    icon: 'hourglass_top', label: 'Awaiting sign-off', badgeClass: 'bg-secondary-container/30 text-on-secondary-container' },
    Approved:  { accent: 'bg-[#15803D]',    icon: 'check_circle',  label: 'Approved',          badgeClass: 'bg-[#DCFCE7] text-[#15803D]' },
    Rejected:  { accent: 'bg-[#B91C1C]',    icon: 'error',         label: 'Rejected',          badgeClass: 'bg-[#FEE2E2] text-[#B91C1C]' },
    Cancelled: { accent: 'bg-[#B91C1C]',    icon: 'error',         label: 'Cancelled',         badgeClass: 'bg-[#FEE2E2] text-[#B91C1C]' },
    Completed: { accent: 'bg-[#475569]',    icon: 'check_circle',  label: 'Completed',         badgeClass: 'bg-[#F1F5F9] text-[#475569]' }
  };

  function statusMeta(status) {
    return STATUS_META[status] || STATUS_META.Pending;
  }

  // ---------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------

  let toastTimer = null;

  function showToast(message, kind = 'info') {
    if (!toast || !toastText) return;

    toastText.textContent = message;
    if (toastIcon) {
      toastIcon.textContent =
        kind === 'error' ? 'error' : kind === 'success' ? 'check_circle' : 'info';
      toastIcon.className =
        'material-symbols-outlined ' +
        (kind === 'error' ? 'text-red-600' : kind === 'success' ? 'text-[#15803D]' : 'text-[#7a1f2b]');
    }

    toast.classList.remove('hidden');
    toast.style.display = 'flex';

    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(dismissToast, kind === 'error' ? 9000 : 6000);
  }

  function dismissToast() {
    window.clearTimeout(toastTimer);
    if (!toast) return;
    toast.classList.add('hidden');
    toast.style.display = 'none';
  }

  if (toastDismiss) toastDismiss.addEventListener('click', dismissToast);

  // ---------------------------------------------------------------
  // API wrapper — always resolves, never throws
  // ---------------------------------------------------------------

  async function api(path, options = {}) {
    try {
      const response = await fetch(BASE + path, {
        credentials: 'same-origin',
        headers: options.body ? { 'Content-Type': 'application/json' } : {},
        ...options
      });

      let json = null;
      try {
        json = await response.json();
      } catch (_) {
        json = null;
      }

      if (response.status === 401) {
        return { ok: false, status: 401, error: 'Your session has expired. Please sign in again.' };
      }

      if (!response.ok || !json || json.success === false) {
        return {
          ok: false,
          status: response.status,
          error: (json && json.error) || `Request failed (HTTP ${response.status}).`
        };
      }

      return { ok: true, status: response.status, data: json.data };
    } catch (error) {
      console.error('[staff-queue] network error:', path, error);
      return { ok: false, status: 0, error: 'Network error. Check that the server is reachable.' };
    }
  }

  function handleAuthFailure(result) {
    if (result.status === 401) {
      window.location.href = 'index.html';
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------

  
  

  function switchTab(tab) {
    state.activeTab = tab;

    const pairs = [
      ['pending', tabPending, viewPending, 'Pending Approvals'],
      ['moves', tabMoves, viewMoves, 'Move Requests'],
      ['cancels', tabCancels, viewCancels, 'Cancellation Requests'],
      ['overrides', tabOverrides, viewOverrides, 'Conflict Override Requests'],
      ['all', tabAll, viewAll, 'All Requests'],
      ['maintenance', tabMaintenance, viewMaintenance, 'Facility State Grid']
    ];

    pairs.forEach(([name, tabEl, viewEl, title]) => {
      const active = name === tab;
      if (tabEl) {
        tabEl.classList.toggle('active-tab', active);
        tabEl.classList.toggle('ring-2', active);
        tabEl.classList.toggle('ring-[#7a1f2b]', active);
        tabEl.setAttribute('aria-selected', active ? 'true' : 'false');
      }
      if (viewEl) viewEl.classList.toggle('hidden', !active);
      
      if (active) {
         const titleEl = document.getElementById('viewport-title');
         if (titleEl) titleEl.textContent = title;
      }
    });

    if (alertBox) {
      alertBox.classList.toggle('hidden', tab !== 'maintenance' || !alertBtn.dataset.roomId);
    }
  }

  if (tabPending) tabPending.addEventListener('click', () => switchTab('pending'));
  if (tabMoves) tabMoves.addEventListener('click', () => switchTab('moves'));
  if (tabCancels) tabCancels.addEventListener('click', () => switchTab('cancels'));
  if (tabOverrides) tabOverrides.addEventListener('click', () => switchTab('overrides'));
  if (tabAll) tabAll.addEventListener('click', () => switchTab('all'));
  if (tabMaintenance) tabMaintenance.addEventListener('click', () => switchTab('maintenance'));

  // ---------------------------------------------------------------
  // Renderers
  // ---------------------------------------------------------------

  function emptyState(message, icon = 'inbox') {
      return `<div class="p-8 flex flex-col items-center gap-2 text-center bg-white border border-gray-100 rounded-2xl shadow-sm text-gray-500">
          <span class="material-symbols-outlined text-[32px]">${icon}</span>
          <p class="text-sm">${escapeHtml(message)}</p>
        </div>`;
    }

  function reservationCard(reservation) {
      const id = escapeHtml(reservation.reservation_id);
      const requester = escapeHtml(reservation.customer_name || reservation.customer_email || 'Unknown requester');
      const isPending = reservation.status === 'Pending';
      
      let badgeBg = 'bg-gray-100 text-gray-700';
      if (reservation.status === 'Approved') badgeBg = 'bg-green-100 text-green-700';
      else if (isPending) badgeBg = 'bg-amber-100 text-amber-700';
      else if (reservation.status === 'Cancelled' || reservation.status === 'Rejected') badgeBg = 'bg-red-100 text-red-700';

      // Step 4: this day can't currently be approved (a class/booking landed on
      // it). Staff can resolve just this day with a facility suggestion.
      const conflictReason = isPending ? state.conflicts[reservation.reservation_id] : null;
      const suggestion = state.suggestionsByRes[reservation.reservation_id];
      const sugMeta = {
        Pending:  { bg: 'bg-sky-100 text-sky-800',       label: 'Suggestion sent — awaiting customer' },
        Accepted: { bg: 'bg-emerald-100 text-emerald-800', label: 'Suggestion accepted' },
        Declined: { bg: 'bg-rose-100 text-rose-800',       label: 'Suggestion declined' }
      };

      return `
        <div class="relative bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden transition-all hover:shadow-md hover:border-gray-300 mb-4" data-card-id="${id}">
          <div class="p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-5">
            <div class="flex flex-col md:flex-row md:items-center gap-5 flex-1">
              <div class="flex-shrink-0 flex items-center gap-3">
                  ${isPending ? `<input type="checkbox" value="${id}" class="batch-checkbox w-4 h-4 text-[#7a1f2b] bg-gray-50 border-gray-300 rounded focus:ring-[#7a1f2b] cursor-pointer" onchange="window.CampusRoomStaff.updateBatchButton()">` : ""}
                  <span class="px-2.5 py-1.5 rounded-lg bg-[#FDF2F4] text-[#7a1f2b] text-xs font-bold tracking-wide border border-[#FDF2F4]">
                    #${shortId(reservation.reservation_id)}
                  </span>
                </div>
              <div class="flex-1 min-w-0">
                <div class="flex flex-wrap items-center gap-2 mb-2">
                  <h3 class="text-base font-bold text-gray-900 truncate">${requester}</h3>
                  ${reservation.customer_email ? `<span class="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-bold uppercase truncate">${escapeHtml(reservation.customer_email)}</span>` : ''}
                  <span class="px-2 py-0.5 rounded ${badgeBg} text-[10px] font-bold uppercase tracking-wider">${escapeHtml(reservation.status)}</span>
                  ${reservation.approval_type === 'special' ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold uppercase tracking-wider" title="This room is flagged to always require Staff review."><span class="material-symbols-outlined text-[13px] leading-none">verified_user</span>Requires approval</span>` : ''}
                  ${reservation.category ? `<span class="px-2 py-0.5 rounded border border-gray-200 text-gray-500 text-xs">${escapeHtml(reservation.category)}</span>` : ''}
                  ${conflictReason ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-red-100 text-red-700 text-[10px] font-bold uppercase tracking-wider"><span class="material-symbols-outlined text-[13px] leading-none">warning</span>Conflict</span>` : ''}
                  ${suggestion ? `<span class="px-2 py-0.5 rounded ${(sugMeta[suggestion.status]||sugMeta.Pending).bg} text-[10px] font-bold uppercase tracking-wider">${(sugMeta[suggestion.status]||sugMeta.Pending).label}</span>` : ''}
                </div>

                ${conflictReason ? `<p class="text-xs text-red-600 mb-2 flex items-start gap-1"><span class="material-symbols-outlined text-[14px] leading-none mt-px">error</span><span>${escapeHtml(conflictReason)}</span></p>` : ''}
                ${suggestion ? `<p class="text-xs text-gray-500 mb-2">Suggested move: <span class="font-semibold text-gray-700">${escapeHtml(suggestion.suggested_room_name || '')}</span> for ${escapeHtml(suggestion.affected_date || '')}${suggestion.status === 'Declined' ? ' — customer declined; you may reject this day or try another room.' : ''}</p>` : ''}

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
              ${isPending && conflictReason && (!suggestion || suggestion.status === 'Declined') ? `<button type="button" onclick="window.CampusRoomStaff.openFindAlternativeModal('${id}')" class="px-4 py-2 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors shadow-sm">Find alternative</button>` : ''}
              ${isPending ? `<button type="button" onclick="window.CampusRoomStaff.decide('${id}', 'Rejected', '${requester}', this)" class="px-4 py-2 text-sm font-semibold text-red-600 bg-white border border-red-200 rounded-xl hover:bg-red-50 transition-colors shadow-sm">Reject</button>` : ''}
              ${isPending ? `<button type="button" onclick="window.CampusRoomStaff.decide('${id}', 'Approved', '${requester}', this)" class="px-5 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 transition-colors shadow-sm">Approve</button>` : ''}
              ${!isPending && reservation.status === 'Approved' ? `<button type="button" onclick="window.CampusRoomStaff.openStaffCancelModal('${id}', ${escapeHtml(JSON.stringify(reservation))})" class="px-4 py-2 text-sm font-semibold text-red-600 bg-white border border-red-200 rounded-xl hover:bg-red-50 transition-colors shadow-sm">Cancel Booking</button>` : ''}
            </div>
          </div>
        </div>`;
    }

  
  function matchSearch(obj) {
    if (!state.searchQuery) return true;
    const q = state.searchQuery;
    const fields = [
      obj.reservation_id,
      obj.customer_name,
      obj.customer_email,
      obj.room_name,
      obj.purpose,
      obj.room_type,
      obj.customer_reason,
      obj.staff_comment,
      obj.requester_name,
      obj.requester_email,
      obj.reason
    ];
    return fields.some(f => f && String(f).toLowerCase().includes(q));
  }

  function renderPending() {
    if (!viewPending) return;

    const pending = state.reservations.filter((r) => r.status === 'Pending' && matchSearch(r));

    viewPending.innerHTML = pending.length
      ? pending.map(reservationCard).join('')
      : emptyState('No pending applications. The dispatch queue is clear.', 'task_alt');

    if (pendingBadge) pendingBadge.textContent = `${pending.length} Requests`;
    
  }

  function renderAllRequests() {
    if (!viewAllList) return;

    const filtered = state.allStatusFilter === 'all'
      ? state.reservations
      : state.reservations.filter((r) => r.status === state.allStatusFilter);

    viewAllList.innerHTML = filtered.length
      ? filtered.map(reservationCard).join('')
      : emptyState('No reservations match this filter.', 'search_off');

    if (allBadge) allBadge.textContent = `${state.reservations.length} Total`;
  }

  if (allStatusFilter) {
    if (allStatusFilter) allStatusFilter.addEventListener('change', () => {
      state.allStatusFilter = allStatusFilter.value;
      renderAllRequests();
    });
  }

  function moveCard(request) {
      const id = escapeHtml(request.request_id);
      const resId = escapeHtml(request.reservation_id);
      return `
        <div class="relative bg-white rounded-2xl border border-blue-200 shadow-sm overflow-hidden transition-all hover:shadow-md mb-4" data-move-id="${id}">
          <div class="p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-5">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-3">
                <span class="px-2 py-1 rounded bg-blue-50 text-blue-700 text-xs font-bold tracking-wide border border-blue-100">Move REQ #${shortId(id)}</span>
                <span class="text-xs text-gray-500 font-semibold">Ref: <a href="#" onclick="window.CampusRoomStaff.openDetailModal('${resId}')" class="text-[#7a1f2b] hover:underline">#${shortId(resId)}</a></span>
                ${request.reason ? '<span class="px-2 py-1 rounded bg-violet-50 text-violet-700 text-[10px] font-bold uppercase tracking-wide border border-violet-100">Staff-proposed · override</span>' : ''}
              </div>
              ${request.reason ? `<div class="text-xs text-gray-500">${escapeHtml(request.reason)} Approving it also books the override requester.</div>` : ''}
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
    }

  function renderMoves() {
    if (!viewMoves) return;

    const moves = state.moveRequests.filter(matchSearch);
    viewMoves.innerHTML = moves.length
      ? moves.map(moveCard).join('')
      : emptyState('No pending move requests.', 'event_available');

    if (moveBadge) moveBadge.textContent = `${state.moveRequests.length}`;
  }

  /**
   * A cancellation request: the requester wants an already-approved booking
   * released. The reason is theirs, in their words, so it is shown verbatim —
   * it is the whole basis for the decision.
   */
  function cancelRequestCard(request) {
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
    }

  function renderCancelRequests() {
    if (!viewCancels) return;

    const cancels = state.cancelRequests.filter(matchSearch);
    viewCancels.innerHTML = cancels.length
      ? cancels.map(cancelRequestCard).join('')
      : emptyState('No pending cancellation requests.', 'assignment_turned_in');

    if (cancelReqBadge) cancelReqBadge.textContent = `${state.cancelRequests.length}`;
  }

  /** "Mar 10, 2031 · 9:00 AM – 11:00 AM", or a range "Mar 10 – Mar 12, 2031 · 9:00 AM – 11:00 AM daily". */
  function formatWindow(start, end) {
    const sameDay = String(start).slice(0, 10) === String(end).slice(0, 10);
    const times = `${formatTime(start)} – ${formatTime(end)}`;
    if (sameDay) return `${formatDay(start)} · ${times}`;
    const s = parseDate(start);
    const from = s ? s.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) : '—';
    return `${from} – ${formatDay(end)} · ${times} daily`;
  }

  /**
   * A conflict override request: a customer wants a slot that another
   * customer's Approved booking holds. Staff see who is asking and why, and
   * both time ranges side by side — but not who holds the slot; the
   * requester was never told that either.
   */
  function overrideCard(request) {
    const id = escapeHtml(request.request_id);
    return `
      <div class="relative bg-white rounded-2xl border border-violet-200 shadow-sm overflow-hidden transition-all hover:shadow-md mb-4" data-override-id="${id}">
        <div class="p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-5">
          <div class="flex-1 min-w-0">
            <div class="flex flex-wrap items-center gap-2 mb-2">
              <span class="px-2 py-1 rounded bg-violet-50 text-violet-700 text-xs font-bold tracking-wide border border-violet-100">Override REQ #${shortId(id)}</span>
              <h3 class="text-base font-bold text-gray-900 truncate">${escapeHtml(request.requester_name || 'Requester')}</h3>
              ${request.requester_email ? `<span class="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-bold uppercase truncate">${escapeHtml(request.requester_email)}</span>` : ''}
              ${request.category ? `<span class="px-2 py-0.5 rounded border border-gray-200 text-gray-500 text-xs">${escapeHtml(request.category)}</span>` : ''}
            </div>
            <div class="text-sm text-gray-700 mt-2">
              <span class="font-semibold text-violet-700">Urgency reason:</span> ${escapeHtml(request.reason)}
            </div>
            <div class="text-xs text-gray-500 mt-1">Purpose: ${escapeHtml(request.purpose)}</div>
            <div class="flex flex-col md:flex-row gap-4 text-sm mt-4 items-stretch">
              <div class="flex-1 p-4 bg-violet-50 rounded-xl border border-violet-100">
                <div class="text-[10px] font-bold text-violet-600 uppercase tracking-wider mb-1">Requested slot</div>
                <div class="font-bold text-gray-900">${escapeHtml(request.room_name)}</div>
                <div class="text-xs text-gray-600 mt-1">${escapeHtml(formatWindow(request.start_time, request.end_time))}</div>
              </div>
              <div class="flex-1 p-4 bg-gray-50 rounded-xl border border-gray-100">
                <div class="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Conflicting booking (${escapeHtml(request.conflict_status || 'Approved')})</div>
                <div class="font-bold text-gray-900">${escapeHtml(request.room_name)}</div>
                <div class="text-xs text-gray-600 mt-1">${escapeHtml(formatWindow(request.conflict_start_time, request.conflict_end_time))}</div>
              </div>
            </div>
            <div class="text-xs text-gray-400 mt-2">Requested on ${formatDateTime(request.created_at)}</div>
          </div>
          <div class="flex flex-wrap items-center gap-2 shrink-0 border-t xl:border-t-0 border-gray-100 pt-4 xl:pt-0">
            <button type="button" onclick="window.CampusRoomStaff.openOverrideModal('${id}')" class="px-6 py-2.5 text-sm font-bold text-white bg-violet-600 rounded-xl hover:bg-violet-700 transition-colors shadow-sm">Review Override</button>
          </div>
        </div>
      </div>`;
  }

  function renderOverrides() {
    if (!viewOverrides) return;

    const overrides = state.overrideRequests.filter(matchSearch);
    viewOverrides.innerHTML = overrides.length
      ? overrides.map(overrideCard).join('')
      : emptyState('No pending override requests.', 'verified');

    if (overrideBadge) overrideBadge.textContent = `${state.overrideRequests.length}`;
  }

  function facilityCard(room) {
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
    }

  function renderFacilities() {
    if (!facilityGrid) return;

    const filtered = state.rooms.filter((room) => {
      if (state.wingFilter === 'all') return true;
      if (state.wingFilter === '__maintenance__') return room.status === 'Maintenance';
      return (room.room_type || 'Unclassified') === state.wingFilter;
    });

    facilityGrid.innerHTML = filtered.length
      ? filtered.map(facilityCard).join('')
      : `<div class="p-5 text-gray-500 text-sm ">No rooms match this filter.</div>`;

    if (maintenanceBadge) maintenanceBadge.textContent = `${state.rooms.length} Rooms`;
  }

  function renderFacilityFilter() {
    if (!facilityFilter) return;

    const types = [...new Set(state.rooms.map((r) => r.room_type || 'Unclassified'))].sort();
    const previous = state.wingFilter;

    facilityFilter.innerHTML =
      `<option value="all">All Rooms (${state.rooms.length})</option>` +
      `<option value="__maintenance__">Under Maintenance Only</option>` +
      types
        .map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`)
        .join('');

    facilityFilter.value = previous;
    if (!facilityFilter.value) {
      facilityFilter.value = 'all';
      state.wingFilter = 'all';
    }
  }

  function renderMaintenanceAlert() {
    if (!alertBox || !alertBtn) return;

    // Decommissioned rooms are already out of service and can only be
    // brought back by an Admin (is_active), so they don't belong in the
    // Staff "flip it back to Available" quick-action alert.
    const offline = state.rooms.find((room) => room.status === 'Maintenance' && Number(room.is_active) !== 0);

    if (!offline) {
      alertBtn.dataset.roomId = '';
      alertBox.classList.add('hidden');
      return;
    }

    alertBtn.dataset.roomId = offline.room_id;
    alertBtn.dataset.roomName = offline.name;
    if (alertLocation) alertLocation.textContent = roomMeta(offline);
    if (alertTitle) alertTitle.textContent = `Instant Facility Action • ${offline.name} State Alert`;
    if (alertBody) {
      alertBody.textContent =
        `${offline.name} is currently tagged Offline and is excluded from booking. `
        + 'Restore it once servicing has been verified by the Operations Lead.';
    }
    if (alertBtnLabel) alertBtnLabel.textContent = `Toggle ${offline.name} to Available (Active)`;

    alertBox.classList.toggle('hidden', state.activeTab !== 'maintenance');
  }

  function renderKpis() {
    const pending = state.reservations.filter((r) => r.status === 'Pending').length;
    const offline = state.rooms.filter((r) => r.status === 'Maintenance' && Number(r.is_active) !== 0).length;
    const approvedToday = state.reservations.filter(
      (r) => r.status === 'Approved' && isToday(r.processed_at)
    ).length;

    if (kpiPending) kpiPending.textContent = String(pending);
    if (kpiMaintenance) kpiMaintenance.textContent = String(offline);
    if (kpiAuth) kpiAuth.textContent = String(approvedToday);
  }

  function renderAll() {
    renderPending();
    renderMoves();
    renderCancelRequests();
    renderOverrides();
    renderAllRequests();
    renderFacilityFilter();
    renderFacilities();
    renderMaintenanceAlert();
    renderKpis();
    stampSync();
  }

  function stampSync() {}

  // ---------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------

  async function loadAll(options = {}) {
    if (state.loading) return;
    state.loading = true;
    
    

    const [reservations, rooms, moves, cancels, overrides, conflicts, suggestions] = await Promise.all([
      api('api/reservations'),
      api('api/rooms'),
      api('api/reservations/move-requests?status=Pending'),
      api('api/reservations/cancel-requests?status=Pending'),
      api('api/conflict-override-requests?status=Pending'),
      api('api/reservations/conflicts'),
      api('api/facility-suggestions')
    ]);

    state.loading = false;


    const failed = [reservations, rooms, moves, cancels, overrides].find((r) => !r.ok);
    if (failed && handleAuthFailure(failed)) return;

    if (reservations.ok) state.reservations = reservations.data || [];
    if (rooms.ok) state.rooms = rooms.data || [];
    if (moves.ok) state.moveRequests = moves.data || [];
    if (cancels.ok) state.cancelRequests = cancels.data || [];
    if (overrides.ok) state.overrideRequests = overrides.data || [];

    // Conflict reasons keyed by reservation (Pending rows that fail validation now).
    state.conflicts = {};
    if (conflicts.ok) (conflicts.data || []).forEach((c) => { state.conflicts[c.reservation_id] = c.reason; });

    // Latest facility suggestion per booking (the list is newest-first).
    state.suggestionsByRes = {};
    if (suggestions.ok) (suggestions.data || []).forEach((s) => {
      if (!state.suggestionsByRes[s.reservation_id]) state.suggestionsByRes[s.reservation_id] = s;
    });

    renderAll();

    if (failed) {
      showToast(failed.error, 'error');
    } else if (options.notify) {
      showToast('Dispatch queue refreshed.', 'success');
    }
  }

  // ---------------------------------------------------------------
  // Session guard — a Customer should never see this terminal
  // ---------------------------------------------------------------

  async function start() {
    const me = await api('api/auth/me');

    if (!me.ok) {
      if (me.status === 401) {
        window.location.href = 'index.html';
        return;
      }
      showAccessNotice(me.error);
      return;
    }

    const role = String(me.data && me.data.role || '');
    if (role !== 'Staff' && role !== 'Admin') {
      showAccessNotice(
        `You are signed in as ${role || 'Customer'}. Only Staff and Admin accounts can dispatch reservations.`
      );
      return;
    }

    switchTab('pending');
    await loadAll();
  }

  function showAccessNotice(message) {
    if (accessNotice) accessNotice.classList.remove('hidden');
    if (accessText) accessText.textContent = message;
    if (viewPending) viewPending.innerHTML = emptyState('Queue unavailable.', 'lock');
    if (viewMoves) viewMoves.innerHTML = '';
    if (viewCancels) viewCancels.innerHTML = '';
    if (viewOverrides) viewOverrides.innerHTML = '';
    if (facilityGrid) facilityGrid.innerHTML = '';
    [batchApproveBtn, exportLogBtn].forEach((btn) => {
      if (btn) btn.disabled = true;
    });
    if (syncTimestamp) syncTimestamp.textContent = 'Dispatch offline';
    if (syncIndicator) syncIndicator.classList.remove('animate-pulse');
  }

  // ---------------------------------------------------------------
  // Actions: approve / reject / inspect  (event delegation, so the
  // handlers survive every re-render)
  // ---------------------------------------------------------------

  async function decide(reservationId, status, requesterName, triggerBtn) {
    const card = document.querySelector(`[data-card-id="${CSS.escape(reservationId)}"]`);
    if (card) card.style.opacity = '0.4';
    if (triggerBtn) triggerBtn.disabled = true;

    const result = await api(`api/reservations/${encodeURIComponent(reservationId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });

    if (card) card.style.opacity = '1';
    if (triggerBtn) triggerBtn.disabled = false;

    if (!result.ok) {
      if (handleAuthFailure(result)) return false;
      showToast(`Could not ${status.toLowerCase()} #${shortId(reservationId)}: ${result.error}`, 'error');
      return false;
    }

    const reservation = state.reservations.find((r) => r.reservation_id === reservationId);
    if (reservation) {
      reservation.status = status;
      reservation.processed_at = (result.data && result.data.processed_at) || reservation.processed_at;
    }

    renderAll();

    showToast(
      status === 'Approved'
        ? `Application #${shortId(reservationId)} (${requesterName}) approved.`
        : `Application #${shortId(reservationId)} (${requesterName}) rejected.`,
      'success'
    );
    return true;
  }

  document.addEventListener('click', (event) => {
    // Any click outside the open action menu (and not on its own trigger,
    // which handles its own toggle below) closes it first.
    if (
      actionMenuOpenId
      && actionMenuEl
      && !actionMenuEl.contains(event.target)
      && !event.target.closest('.btn-actions-menu')
    ) {
      closeActionMenu();
    }

    const approveBtn = event.target.closest('.btn-approve-req');
    if (approveBtn) {
      decide(approveBtn.dataset.id, 'Approved', approveBtn.dataset.name || 'Requester', approveBtn);
      return;
    }

    const rejectBtn = event.target.closest('.btn-reject-req');
    if (rejectBtn) {
      const name = rejectBtn.dataset.name || 'this requester';
      if (window.confirm(`Reject the reservation from ${name}? The requester will be notified.`)) {
        decide(rejectBtn.dataset.id, 'Rejected', name, rejectBtn);
      }
      return;
    }

    const menuTrigger = event.target.closest('.btn-actions-menu');
    if (menuTrigger) {
      event.stopPropagation();
      if (actionMenuOpenId === menuTrigger.dataset.id) {
        closeActionMenu();
      } else {
        openActionMenu(menuTrigger.dataset.id, menuTrigger);
      }
      return;
    }

    const menuItem = event.target.closest('[data-menu-action]');
    if (menuItem) {
      const action = menuItem.dataset.menuAction;
      const id = menuItem.dataset.id;
      closeActionMenu();
      handleMenuAction(action, id);
      return;
    }

    const reviewBtn = event.target.closest('.btn-review-move');
    if (reviewBtn) {
      openMoveModal(reviewBtn.dataset.id);
      return;
    }

    const cancelReviewBtn = event.target.closest('.btn-review-cancel');
    if (cancelReviewBtn) {
      openCancelRequestModal(cancelReviewBtn.dataset.id);
      return;
    }

    const facilityBtn = event.target.closest('.btn-toggle-facility');
    if (facilityBtn) {
      toggleFacility,
    updateBatchButton(
        facilityBtn.dataset.roomId,
        facilityBtn.dataset.nextStatus,
        facilityBtn.dataset.roomName,
        facilityBtn
      );
    }
  });

  // ---------------------------------------------------------------
  // Batch approve
  // ---------------------------------------------------------------

  if (batchApproveBtn) {
    
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = (e.target.value || '').trim().toLowerCase();
      renderAll();
    });
  }

  if (batchApproveBtn) batchApproveBtn.addEventListener('click', async () => {
      const pending = state.reservations.filter((r) => r.status === 'Pending' && matchSearch(r));
      if (!pending.length) {
        showToast('No pending reservations available for batch approval.');
        return;
      }

      if (!window.confirm(`Approve all ${pending.length} pending application(s)?`)) return;

      batchApproveBtn.disabled = true;
      if (batchApproveLabel) batchApproveLabel.textContent = 'Approving…';

      let approved = 0;
      const failures = [];

      for (const reservation of pending) {
        const result = await api(`api/reservations/${encodeURIComponent(reservation.reservation_id)}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'Approved' })
        });

        if (result.ok) {
          reservation.status = 'Approved';
          reservation.processed_at = (result.data && result.data.processed_at) || reservation.processed_at;
          approved += 1;
        } else {
          if (handleAuthFailure(result)) return;
          failures.push(`#${shortId(reservation.reservation_id)}`);
        }
      }

      batchApproveBtn.disabled = false;
      renderAll();

      if (failures.length) {
        showToast(
          `Batch finished: ${approved} approved, ${failures.length} failed (${failures.join(', ')}).`,
          'error'
        );
      } else {
        showToast(`Batch approved ${approved} reservation(s). Digital door schedules updated.`, 'success');
      }
    });
  }

  // ---------------------------------------------------------------
  // ---------------------------------------------------------------
  // Facility maintenance toggle
  // ---------------------------------------------------------------

  async function toggleFacility(roomId, nextStatus, roomName, triggerBtn) {
    if (!roomId || !nextStatus) return;

    if (triggerBtn) triggerBtn.disabled = true;

    const result = await api(`api/rooms/${encodeURIComponent(roomId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: nextStatus })
    });

    if (triggerBtn) triggerBtn.disabled = false;

    if (!result.ok) {
      if (handleAuthFailure(result)) return;
      showToast(`Could not update ${roomName || 'room'}: ${result.error}`, 'error');
      return;
    }

    const room = state.rooms.find((r) => r.room_id === roomId);
    if (room) {
      room.status = nextStatus;
      if (result.data && result.data.status) room.status = result.data.status;
      room.live_status = room.status === 'Maintenance' ? 'Maintenance' : room.live_status;
    }

    renderFacilities();
    renderMaintenanceAlert();
    renderKpis();

    showToast(
      nextStatus === 'Maintenance'
        ? `${roomName || 'Room'} flagged for maintenance inspection and removed from booking inventory.`
        : `${roomName || 'Room'} restored to the available booking inventory.`,
      'success'
    );
  }

  if (alertBtn) {
    if (alertBtn) alertBtn.addEventListener('click', () => {
      const roomId = alertBtn.dataset.roomId;
      if (!roomId) return;
      toggleFacility,
    updateBatchButton(roomId, 'Available', alertBtn.dataset.roomName, alertBtn);
    });
  }

  if (facilityFilter) {
    if (facilityFilter) facilityFilter.addEventListener('change', () => {
      state.wingFilter = facilityFilter.value;
      renderFacilities();
    });
  }

  // ---------------------------------------------------------------
  // Audit log archive (Section 13) — replaces the old direct CSV export,
  // which pulled an unbounded/near-unbounded api/logs?limit=500 with no
  // filters. The shared component (js/logArchive.js) has its own paging,
  // date/actor/text filters, and CSV export (current page or all matching).
  // ---------------------------------------------------------------

  if (exportLogBtn) {
    if (exportLogBtn) exportLogBtn.addEventListener('click', () => {
      window.CampusRoomLogArchive.openGlobal();
    });
  }

  // ---------------------------------------------------------------
  // Application detail modal
  // ---------------------------------------------------------------

  function detailRow(label, value) {
      return `
        <div class="flex justify-between items-start gap-4 py-3 border-b border-gray-100 last:border-0">
          <span class="text-sm font-semibold text-gray-500 whitespace-nowrap">${escapeHtml(label)}</span>
          <span class="text-sm font-medium text-gray-900 text-right break-words">${escapeHtml(value)}</span>
        </div>`;
    }

  function openDetailModal(reservationId) {
    const reservation = state.reservations.find((r) => r.reservation_id === reservationId);
    if (!reservation || !detailOverlay || !detailBody) return;

    detailBody.innerHTML =
      detailRow('Permit Reference', `#${shortId(reservation.reservation_id)}`) +
      detailRow('Full Reservation ID', reservation.reservation_id) +
      detailRow('Requester', reservation.customer_name || '—') +
      detailRow('Email', reservation.customer_email || '—') +
      detailRow('Room', reservation.room_name || '—') +
      detailRow('Room Details', roomMeta(reservation)) +
      detailRow('Category', reservation.category || '—') +
      detailRow('Purpose', reservation.purpose || '—') +
      detailRow('Start', formatDateTime(reservation.start_time)) +
      detailRow('End', formatDateTime(reservation.end_time)) +
      detailRow('Status', reservation.status) +
      detailRow('Filed On', formatDateTime(reservation.created_at));

    detailOverlay.classList.remove('opacity-0', 'pointer-events-none');
    detailOverlay.setAttribute('aria-hidden', 'false');
  }

  function closeDetailModal() {
    if (!detailOverlay) return;
    detailOverlay.classList.add('opacity-0', 'pointer-events-none');
    detailOverlay.setAttribute('aria-hidden', 'true');
  }

  const detailCloseIcon = el('detailModalCloseIcon');
  const detailCloseBtn = el('detailModalCloseBtn');
  if (detailCloseIcon) detailCloseIcon.addEventListener('click', closeDetailModal);
  if (detailCloseBtn) detailCloseBtn.addEventListener('click', closeDetailModal);
  if (detailOverlay) {
    if (detailOverlay) detailOverlay.addEventListener('click', (event) => {
      if (event.target === detailOverlay) closeDetailModal();
    });
  }

  // ---------------------------------------------------------------
  // Action menu (kebab) — anchored popup replacing the old "always opens
  // the detail modal" behavior of the three-dots button. Appended to
  // <body> rather than nested in the card, since cards live inside an
  // `overflow-hidden` wrapper that would clip an absolutely-positioned
  // child (Section 11).
  // ---------------------------------------------------------------

  let actionMenuEl = null;
  let actionMenuOpenId = null;
  let actionMenuTriggerBtn = null;

  function ensureActionMenu() {
    if (actionMenuEl) return actionMenuEl;
    actionMenuEl = document.createElement('div');
    actionMenuEl.id = 'staffActionMenu';
    actionMenuEl.setAttribute('role', 'menu');
    actionMenuEl.className =
      'fixed z-[70] hidden min-w-[220px] py-1 bg-white rounded-lg shadow-xl border border-outline-variant';
    document.body.appendChild(actionMenuEl);
    return actionMenuEl;
  }

  /** Which menu items apply to a reservation, per its status (Section 11 table). */
  function actionMenuItems(reservation) {
    const status = reservation.status;
    const items = [{ key: 'inspect', label: 'Inspect Details', icon: 'visibility' }];

    if (status === 'Approved' || status === 'Completed') {
      items.push({ key: 'slip', label: 'View Confirmation Slip', icon: 'receipt_long' });
    }

    items.push({ key: 'logs', label: 'View Log Archive', icon: 'folder_open' });

    if (status === 'Pending' || status === 'Approved') {
      items.push({ key: 'cancel', label: 'Cancel Booking', icon: 'cancel', danger: true });
    }

    if (status === 'Completed' || status === 'Rejected' || status === 'Cancelled') {
      items.push({ key: 'rebook', label: 'Re-book Space', icon: 'sync' });
    }

    return items;
  }

  function positionActionMenu(triggerBtn, menu) {
    const rect = triggerBtn.getBoundingClientRect();
    const menuHeight = menu.offsetHeight;
    const menuWidth = menu.offsetWidth;
    const spaceBelow = window.innerHeight - rect.bottom;

    // Flip upward when the trigger sits in the bottom third of the viewport
    // and there's more room above than below.
    const shouldFlipUp = spaceBelow < menuHeight + 12 && rect.top > menuHeight + 12;
    const top = shouldFlipUp ? rect.top - menuHeight - 4 : rect.bottom + 4;

    let left = rect.right - menuWidth;
    left = Math.max(8, Math.min(left, window.innerWidth - menuWidth - 8));

    menu.style.top = `${Math.max(8, top)}px`;
    menu.style.left = `${left}px`;
  }

  function openActionMenu(reservationId, triggerBtn) {
    const reservation = state.reservations.find((r) => r.reservation_id === reservationId);
    if (!reservation) return;

    const menu = ensureActionMenu();
    actionMenuOpenId = reservationId;
    actionMenuTriggerBtn = triggerBtn;

    menu.innerHTML = actionMenuItems(reservation).map((item) => `
      <button type="button" role="menuitem"
              class="w-full flex items-center gap-2 px-4 py-2 text-left text-xs font-semibold  transition-colors ${
                item.danger ? 'text-red-600 hover:bg-red-600-container' : 'text-gray-900 hover:bg-[#f8f9fb]'
              }"
              data-menu-action="${item.key}" data-id="${escapeHtml(reservationId)}">
        <span class="material-symbols-outlined text-[18px]">${item.icon}</span>
        <span>${escapeHtml(item.label)}</span>
      </button>`).join('');

    menu.classList.remove('hidden');
    triggerBtn.setAttribute('aria-expanded', 'true');
    positionActionMenu(triggerBtn, menu);
  }

  function closeActionMenu() {
    if (!actionMenuEl) return;
    actionMenuEl.classList.add('hidden');
    if (actionMenuTriggerBtn) actionMenuTriggerBtn.setAttribute('aria-expanded', 'false');
    actionMenuOpenId = null;
    actionMenuTriggerBtn = null;
  }

  function handleMenuAction(action, reservationId) {
    switch (action) {
      case 'inspect':
        openDetailModal(reservationId);
        break;
      case 'slip':
        // Shared component (js/slip.js): fetches fresh data from the API.
        window.CampusRoomSlip.open(reservationId);
        break;
      case 'logs':
        // Shared component (js/logArchive.js): fetches fresh data from the API.
        window.CampusRoomLogArchive.open(reservationId);
        break;
      case 'cancel': {
        const reservation = state.reservations.find((r) => r.reservation_id === reservationId);
        openStaffCancelModal(reservationId, reservation);
        break;
      }
      case 'rebook':
        // Section 14, Option B: a self-contained modal, so the operator never
        // leaves the dispatch terminal. It posts to the same rebook endpoint
        // the customer path uses (js/rebook.js), which files the new booking
        // under the ORIGINAL requester — POST api/reservations is
        // Customer-only and could not do this.
        window.CampusRoomRebook.openStaffModal(reservationId, {
          onSuccess: async (created) => {
            showToast(
              `Re-booked as REQ-${shortId(created && created.reservation_id)} — filed as Pending.`,
              'success'
            );
            await loadAll();
          }
        });
        break;
      default:
        break;
    }
  }

  // Close the menu on scroll anywhere (capture phase catches scroll inside
  // any inner scroll container, not just the window).
  window.addEventListener('scroll', () => {
    if (actionMenuOpenId) closeActionMenu();
  }, true);

  // ---------------------------------------------------------------
  // Staff cancellation modal — PATCH api/reservations/{id}/cancel returns
  // 422 without a reason when the actor isn't the booking's owner, which
  // staff/admin never are. Reason is required client-side too, so the
  // operator sees an inline message instead of a raw validation-error toast.
  // ---------------------------------------------------------------

  function openStaffCancelModal(reservationId, reservation) {
    state.currentCancelId = reservationId;

    if (staffCancelReasonInput) staffCancelReasonInput.value = '';
    if (staffCancelError) staffCancelError.classList.add('hidden');

    if (staffCancelSummary) {
      staffCancelSummary.innerHTML = reservation
        ? `
          <div><span class="font-semibold text-gray-900">Requester:</span> ${escapeHtml(reservation.customer_name || reservation.customer_email || '—')}</div>
          <div><span class="font-semibold text-gray-900">Room:</span> ${escapeHtml(reservation.room_name || '—')}</div>
          <div><span class="font-semibold text-gray-900">Permit:</span> #${shortId(reservationId)}</div>`
        : `<div><span class="font-semibold text-gray-900">Permit:</span> #${shortId(reservationId)}</div>`;
    }

    if (staffCancelOverlay) {
      staffCancelOverlay.classList.remove('opacity-0', 'pointer-events-none');
      staffCancelOverlay.setAttribute('aria-hidden', 'false');
    }
  }

  function closeStaffCancelModal() {
    state.currentCancelId = null;
    if (staffCancelOverlay) {
      staffCancelOverlay.classList.add('opacity-0', 'pointer-events-none');
      staffCancelOverlay.setAttribute('aria-hidden', 'true');
    }
  }

  if (staffCancelCloseIcon) staffCancelCloseIcon.addEventListener('click', closeStaffCancelModal);
  if (staffCancelCancelBtn) staffCancelCancelBtn.addEventListener('click', closeStaffCancelModal);
  if (staffCancelOverlay) {
    if (staffCancelOverlay) staffCancelOverlay.addEventListener('click', (event) => {
      if (event.target === staffCancelOverlay) closeStaffCancelModal();
    });
  }

  async function submitStaffCancel() {
    if (!state.currentCancelId) return;

    const reason = staffCancelReasonInput ? staffCancelReasonInput.value.trim() : '';

    if (!reason) {
      if (staffCancelError) {
        staffCancelError.textContent = 'A cancellation reason is required.';
        staffCancelError.classList.remove('hidden');
      }
      return;
    }

    if (staffCancelConfirmBtn) staffCancelConfirmBtn.disabled = true;

    const result = await api(`api/reservations/${encodeURIComponent(state.currentCancelId)}/cancel`, {
      method: 'PATCH',
      body: JSON.stringify({ reason })
    });

    if (staffCancelConfirmBtn) staffCancelConfirmBtn.disabled = false;

    if (!result.ok) {
      if (handleAuthFailure(result)) return;
      if (staffCancelError) {
        staffCancelError.textContent = result.error;
        staffCancelError.classList.remove('hidden');
      }
      return;
    }

    const cancelledId = state.currentCancelId;
    closeStaffCancelModal();
    showToast(`Reservation #${shortId(cancelledId)} cancelled.`, 'success');

    // Cancel changes more than `status` (writes cancellation_reason and
    // cancelled_by), so refetch rather than patching state.reservations by
    // hand — same rule the plan calls out for re-book.
    await loadAll();
  }

  if (staffCancelConfirmBtn) staffCancelConfirmBtn.addEventListener('click', submitStaffCancel);

  // ---------------------------------------------------------------
  // Move request review modal
  // ---------------------------------------------------------------

  function openMoveModal(requestId) {
      const request = state.moveRequests.find((m) => m.request_id === requestId);
      if (!request || !moveOverlay || !moveSummary) return;

      state.currentMoveId = requestId;
      
      moveSummary.innerHTML = `
        <div class="space-y-4">
           <div class="bg-blue-50 p-4 rounded-xl border border-blue-100">
             <div class="text-[10px] font-bold text-blue-600 tracking-wider uppercase mb-1">Target Booking</div>
             <div class="text-sm font-bold text-gray-900">${escapeHtml(request.room_name)}</div>
             <div class="text-xs text-gray-600 mt-1">Ref #${shortId(request.reservation_id)}</div>
           </div>
           
           <div class="grid grid-cols-2 gap-3">
             <div class="p-3 bg-gray-50 rounded-xl border border-gray-100">
                <div class="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Current</div>
                <div class="text-xs text-gray-900 font-semibold">${formatDateTime(request.original_start_time)}</div>
             </div>
             <div class="p-3 bg-white rounded-xl border border-blue-200 ring-1 ring-blue-50">
                <div class="text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-1">Requested</div>
                <div class="text-xs text-blue-700 font-bold">${formatDateTime(request.requested_start_time)}</div>
             </div>
           </div>
        </div>
      `;

      if (moveComment) moveComment.value = '';
      if (moveError) moveError.classList.add('hidden');
      if (moveApproveBtn) moveApproveBtn.disabled = false;
      if (moveRejectBtn) moveRejectBtn.disabled = false;

      moveOverlay.classList.remove('opacity-0', 'pointer-events-none');
      moveOverlay.setAttribute('aria-hidden', 'false');
    }

  function closeMoveModal() {
    state.currentMoveId = null;
    if (moveOverlay) {
      moveOverlay.classList.add('opacity-0', 'pointer-events-none');
      moveOverlay.setAttribute('aria-hidden', 'true');
    }
  }

  const moveCloseIcon = el('moveReviewCloseIcon');
  const moveCancelBtn = el('moveReviewCancelBtn');
  if (moveCloseIcon) moveCloseIcon.addEventListener('click', closeMoveModal);
  if (moveCancelBtn) moveCancelBtn.addEventListener('click', closeMoveModal);
  if (moveOverlay) {
    if (moveOverlay) moveOverlay.addEventListener('click', (event) => {
      if (event.target === moveOverlay) closeMoveModal();
    });
  }

  async function submitMoveReview(status) {
    if (!state.currentMoveId) return;

    const comment = moveComment ? moveComment.value.trim() : '';

    if (status === 'Rejected' && !comment) {
      if (moveError) {
        moveError.textContent = 'A comment is required for rejection.';
        moveError.classList.remove('hidden');
      }
      return;
    }

    if (moveApproveBtn) moveApproveBtn.disabled = true;
    if (moveRejectBtn) moveRejectBtn.disabled = true;

    const result = await api(
      `api/reservations/move-requests/${encodeURIComponent(state.currentMoveId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status, staff_comment: comment })
      }
    );

    if (moveApproveBtn) moveApproveBtn.disabled = false;
    if (moveRejectBtn) moveRejectBtn.disabled = false;

    if (!result.ok) {
      if (handleAuthFailure(result)) return;
      if (moveError) {
        moveError.textContent = result.error;
        moveError.classList.remove('hidden');
      }
      return;
    }

    closeMoveModal();
    // A move proposed for a conflict override also books (or doesn't) the requester; say which.
    const overrideNote = result.data && result.data.override_note;
    showToast(`Move request ${status.toLowerCase()}.` + (overrideNote ? ` ${overrideNote}` : ''), 'success');
    await loadAll();
  }

  if (moveApproveBtn) moveApproveBtn.addEventListener('click', () => submitMoveReview('Approved'));
  if (moveRejectBtn) moveRejectBtn.addEventListener('click', () => submitMoveReview('Rejected'));

  // ---------------------------------------------------------------
  // Cancellation request review modal
  // ---------------------------------------------------------------

  function openCancelRequestModal(requestId) {
    const request = state.cancelRequests.find((r) => r.request_id === requestId);
    state.currentCancelReqId = requestId;

    if (cancelReqComment) cancelReqComment.value = '';
    if (cancelReqError) cancelReqError.classList.add('hidden');

    if (cancelReqSummary) {
      cancelReqSummary.innerHTML = request
        ? `
          <div><span class="font-semibold text-gray-900">Requester:</span> ${escapeHtml(request.customer_name || request.customer_email || '—')}</div>
          <div><span class="font-semibold text-gray-900">Room:</span> ${escapeHtml(request.room_name || '—')}</div>
          <div><span class="font-semibold text-gray-900">Booked:</span> ${escapeHtml(formatDateTime(request.start_time))} – ${escapeHtml(formatTime(request.end_time))}</div>
          <div><span class="font-semibold text-gray-900">Purpose:</span> ${escapeHtml(request.purpose || '—')}</div>
          <div><span class="font-semibold text-red-600">Reason given:</span> ${escapeHtml(request.reason || '—')}</div>`
        : '';
    }

    if (cancelReqOverlay) {
      cancelReqOverlay.classList.remove('opacity-0', 'pointer-events-none');
      cancelReqOverlay.setAttribute('aria-hidden', 'false');
    }
  }

  function closeCancelRequestModal() {
    state.currentCancelReqId = null;
    if (cancelReqOverlay) {
      cancelReqOverlay.classList.add('opacity-0', 'pointer-events-none');
      cancelReqOverlay.setAttribute('aria-hidden', 'true');
    }
  }

  const cancelReqCloseIcon = el('cancelReviewCloseIcon');
  const cancelReqCancelBtn = el('cancelReviewCancelBtn');
  if (cancelReqCloseIcon) cancelReqCloseIcon.addEventListener('click', closeCancelRequestModal);
  if (cancelReqCancelBtn) cancelReqCancelBtn.addEventListener('click', closeCancelRequestModal);
  if (cancelReqOverlay) {
    if (cancelReqOverlay) cancelReqOverlay.addEventListener('click', (event) => {
      if (event.target === cancelReqOverlay) closeCancelRequestModal();
    });
  }

  async function submitCancelReview(status) {
    if (!state.currentCancelReqId) return;

    const comment = cancelReqComment ? cancelReqComment.value.trim() : '';

    // The booking stands after a rejection, so the requester is owed a why.
    if (status === 'Rejected' && !comment) {
      if (cancelReqError) {
        cancelReqError.textContent = 'A comment is required for rejection.';
        cancelReqError.classList.remove('hidden');
      }
      return;
    }

    if (cancelReqApproveBtn) cancelReqApproveBtn.disabled = true;
    if (cancelReqRejectBtn) cancelReqRejectBtn.disabled = true;

    const result = await api(
      `api/reservations/cancel-requests/${encodeURIComponent(state.currentCancelReqId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status, staff_comment: comment })
      }
    );

    if (cancelReqApproveBtn) cancelReqApproveBtn.disabled = false;
    if (cancelReqRejectBtn) cancelReqRejectBtn.disabled = false;

    if (!result.ok) {
      if (handleAuthFailure(result)) return;
      if (cancelReqError) {
        cancelReqError.textContent = result.error;
        cancelReqError.classList.remove('hidden');
      }
      return;
    }

    closeCancelRequestModal();
    showToast(
      status === 'Approved'
        ? 'Cancellation approved. The room has been released.'
        : 'Cancellation rejected. The booking still stands.',
      'success'
    );
    await loadAll();
  }

  if (cancelReqApproveBtn) cancelReqApproveBtn.addEventListener('click', () => submitCancelReview('Approved'));
  if (cancelReqRejectBtn) cancelReqRejectBtn.addEventListener('click', () => submitCancelReview('Rejected'));

  // ---------------------------------------------------------------
  // Conflict override review modal
  //
  // Approve = propose moving the conflicting booking to a new time (a
  // regular move request, reviewed later in Move Requests). When that move
  // is approved, the requester's booking is created as Pending. Reject =
  // optional comment the requester sees in My Reservations.
  // ---------------------------------------------------------------

  let overrideModal = null;

  function buildOverrideModal() {
    const wrap = document.createElement('div');
    wrap.className = 'fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 hidden items-center justify-center p-4';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'overrideReviewTitle');
    wrap.innerHTML = `
      <div class="w-full max-w-lg bg-white rounded-2xl shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div class="flex items-start justify-between gap-3">
          <h2 id="overrideReviewTitle" class="text-lg font-bold text-gray-900">Review override request</h2>
          <button type="button" data-ov-close class="text-gray-400 hover:text-gray-600" aria-label="Close"><span class="material-symbols-outlined">close</span></button>
        </div>
        <div data-ov-summary class="text-sm text-gray-700 space-y-1"></div>
        <fieldset class="p-4 rounded-xl border border-violet-100 bg-violet-50/50 space-y-3">
          <legend class="px-1 text-[11px] font-bold uppercase tracking-wider text-violet-700">If approving: move the conflicting booking to</legend>
          <div class="grid grid-cols-3 gap-2">
            <label class="flex flex-col gap-1 text-xs font-semibold text-gray-600 col-span-3 sm:col-span-1">Date
              <input type="date" data-ov-date class="p-2 border border-gray-200 rounded-lg text-sm bg-white">
            </label>
            <label class="flex flex-col gap-1 text-xs font-semibold text-gray-600">Start
              <input type="time" step="1800" data-ov-start class="p-2 border border-gray-200 rounded-lg text-sm bg-white">
            </label>
            <label class="flex flex-col gap-1 text-xs font-semibold text-gray-600">End
              <input type="time" step="1800" data-ov-end class="p-2 border border-gray-200 rounded-lg text-sm bg-white">
            </label>
          </div>
          <p data-ov-hint class="text-xs text-gray-500"></p>
        </fieldset>
        <label class="block text-sm font-semibold text-gray-800">Comment <span class="font-normal text-gray-400">(optional; the requester sees it)</span>
          <textarea data-ov-comment rows="3" maxlength="500" class="mt-1 w-full p-3 border border-gray-200 rounded-xl text-sm"></textarea>
        </label>
        <p data-ov-error class="hidden text-sm font-semibold text-red-600" role="alert"></p>
        <div class="flex flex-col sm:flex-row gap-2 sm:justify-end">
          <button type="button" data-ov-close class="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="button" data-ov-reject class="px-4 py-2 rounded-xl border border-red-200 text-sm font-semibold text-red-600 hover:bg-red-50">Reject</button>
          <button type="button" data-ov-approve class="px-5 py-2 rounded-xl bg-violet-600 text-white text-sm font-bold hover:bg-violet-700">Approve &amp; propose move</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const q = (sel) => wrap.querySelector(sel);
    wrap.querySelectorAll('[data-ov-close]').forEach((b) => b.addEventListener('click', closeOverrideModal));
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeOverrideModal(); });
    q('[data-ov-approve]').addEventListener('click', () => submitOverrideReview('Approved'));
    q('[data-ov-reject]').addEventListener('click', () => submitOverrideReview('Rejected'));
    return { wrap, q, requestId: null };
  }

  function openOverrideModal(requestId) {
    const request = state.overrideRequests.find((r) => r.request_id === requestId);
    if (!request) return;
    if (!overrideModal) overrideModal = buildOverrideModal();
    const { wrap, q } = overrideModal;
    overrideModal.requestId = requestId;

    q('[data-ov-summary]').innerHTML = `
      <div><span class="font-semibold text-gray-900">Requester:</span> ${escapeHtml(request.requester_name || '—')}</div>
      <div><span class="font-semibold text-gray-900">Room:</span> ${escapeHtml(request.room_name || '—')}</div>
      <div><span class="font-semibold text-gray-900">Requested:</span> ${escapeHtml(formatWindow(request.start_time, request.end_time))}</div>
      <div><span class="font-semibold text-gray-900">Conflicting booking:</span> ${escapeHtml(formatWindow(request.conflict_start_time, request.conflict_end_time))}</div>
      <div><span class="font-semibold text-violet-700">Urgency reason:</span> ${escapeHtml(request.reason || '—')}</div>`;
    q('[data-ov-comment]').value = '';
    q('[data-ov-error]').classList.add('hidden');
    q('[data-ov-approve]').disabled = false;
    q('[data-ov-reject]').disabled = false;
    ['[data-ov-date]', '[data-ov-start]', '[data-ov-end]'].forEach((sel) => { q(sel).value = ''; });
    q('[data-ov-hint]').textContent = 'Looking for the first free slot of the same length…';

    wrap.classList.remove('hidden');
    wrap.classList.add('flex');

    suggestMoveSlot(request).then((slot) => {
      if (overrideModal.requestId !== requestId) return;       // another card was opened meanwhile
      if (!slot) {
        q('[data-ov-hint]').textContent = 'No free slot of the same length in the next 14 days. Enter a time manually.';
        return;
      }
      q('[data-ov-date]').value = slot.date;
      q('[data-ov-start]').value = slot.start;
      q('[data-ov-end]').value = slot.end;
      q('[data-ov-hint]').textContent = 'Suggested: the first free slot of the same length in this room. You can change it; the server re-checks it.';
    });
  }

  /**
   * The first free window, the same length as the conflicting booking, in the
   * same room: from its own day onward (up to 14 days), within business
   * hours, skipping closed days and holidays, not inside the requested slot,
   * and not in the past. null if none. Staff can always type another time.
   */
  async function suggestMoveSlot(request) {
    const S = window.CampusSchedule;
    if (!S) return null;
    const rules = await S.loadRules(BASE);
    const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const toHHMM = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

    const firstDay = String(request.conflict_start_time).slice(0, 10);
    const length = toMin(S.hhmm(request.conflict_end_time)) - toMin(S.hhmm(request.conflict_start_time));
    const last = new Date(firstDay + 'T00:00:00');
    last.setDate(last.getDate() + 13);
    const lastDay = last.getFullYear() + '-' + String(last.getMonth() + 1).padStart(2, '0') + '-' + String(last.getDate()).padStart(2, '0');

    const data = await S.fetchRange(BASE, request.room_id, firstDay, lastDay);
    if (!data || length <= 0) return null;

    const requestedDays = S.datesBetween(String(request.start_time).slice(0, 10), String(request.end_time).slice(0, 10));
    const reqStart = S.hhmm(request.start_time), reqEnd = S.hhmm(request.end_time);
    const now = new Date();

    for (const date of S.datesBetween(firstDay, lastDay)) {
      if (S.isClosedDay(date, rules.closedDays)) continue;
      for (let m = Math.ceil(toMin(rules.open) / 30) * 30; m + length <= toMin(rules.close); m += 30) {
        const start = toHHMM(m), end = toHHMM(m + length);
        if (new Date(`${date}T${start}:00`) <= now) continue;
        if (requestedDays.includes(date) && start < reqEnd && end > reqStart) continue;
        if (S.findConflicts(data, date, start, end, { excludeReservationId: request.conflicting_reservation_id }).length) continue;
        return { date, start, end };
      }
    }
    return null;
  }

  function closeOverrideModal() {
    if (!overrideModal) return;
    overrideModal.requestId = null;
    overrideModal.wrap.classList.add('hidden');
    overrideModal.wrap.classList.remove('flex');
  }

  async function submitOverrideReview(status) {
    if (!overrideModal || !overrideModal.requestId) return;
    const { q, requestId } = overrideModal;
    const errorEl = q('[data-ov-error]');
    const fail = (msg) => { errorEl.textContent = msg; errorEl.classList.remove('hidden'); };

    const body = { status, staff_comment: q('[data-ov-comment]').value.trim() };
    if (status === 'Approved') {
      const date = q('[data-ov-date]').value, start = q('[data-ov-start]').value, end = q('[data-ov-end]').value;
      if (!date || !start || !end) return fail('Choose the date and times to move the conflicting booking to.');
      if (end <= start) return fail('The end time must be after the start time.');
      body.move_start_time = `${date} ${start}:00`;
      body.move_end_time = `${date} ${end}:00`;
    }

    q('[data-ov-approve]').disabled = true;
    q('[data-ov-reject]').disabled = true;
    errorEl.classList.add('hidden');

    const result = await api(`api/conflict-override-requests/${encodeURIComponent(requestId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body)
    });

    q('[data-ov-approve]').disabled = false;
    q('[data-ov-reject]').disabled = false;

    if (!result.ok) {
      if (handleAuthFailure(result)) return;
      return fail(result.error);
    }

    closeOverrideModal();
    showToast(
      status === 'Approved'
        ? 'Override approved. A move request is now in Move Requests; approving it books the requester.'
        : 'Override rejected. The requester will see your comment.',
      'success'
    );
    await loadAll();
  }

  // Escape closes whichever modal (or the action menu) is open.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeMoveModal();
    closeCancelRequestModal();
    closeOverrideModal();
    closeDetailModal();
    closeActionMenu();
    closeStaffCancelModal();
  });


  
  // ---------------------------------------------------------------
  // Batch approve
  // ---------------------------------------------------------------
  function updateBatchButton() {
    if (!batchApproveBtn || !batchApproveLabel) return;
    const checkedCount = document.querySelectorAll('.batch-checkbox:checked').length;
    if (checkedCount > 0) {
      batchApproveBtn.disabled = false;
      batchApproveLabel.textContent = `Approve Selected (${checkedCount})`;
    } else {
      batchApproveBtn.disabled = true;
      batchApproveLabel.textContent = 'Approve Selected';
    }
  }

  if (batchApproveBtn) {
    batchApproveBtn.addEventListener('click', async () => {
      const checked = Array.from(document.querySelectorAll('.batch-checkbox:checked')).map(cb => cb.value);
      if (checked.length === 0) return;

      if (!window.confirm(`Approve the ${checked.length} selected reservation(s)?`)) return;

      batchApproveBtn.disabled = true;
      batchApproveLabel.textContent = 'Processing...';

      let successCount = 0;
      let failCount = 0;
      for (const id of checked) {
        try {
          const res = await api(`/api/reservations/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'Approved', staff_comment: 'Batch approved' })
          });
          if (res.ok) successCount++;
          else failCount++;
        } catch (e) {
          failCount++;
        }
      }

      if (successCount > 0) {
        showToast(`Successfully approved ${successCount} reservations.`, 'success');
      }
      if (failCount > 0) {
        showToast(`Failed to approve ${failCount} reservations.`, 'error');
      }
      
      batchApproveLabel.textContent = 'Approve Selected';
      await loadAll();
    });
  }

  // ---------------------------------------------------------------
  // Export Global API for inline HTML onclick handlers
  // ---------------------------------------------------------------
  // ---------------------------------------------------------------
  // Step 4: Find an alternative room for one conflicting booking day and
  // suggest the move to the customer.
  // ---------------------------------------------------------------

  let findAltModal = null;

  function buildFindAltModal() {
    const wrap = document.createElement('div');
    wrap.className = 'fixed inset-0 z-[120] hidden items-center justify-center bg-black/40 p-4';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = `
      <div class="w-full max-w-lg rounded-2xl bg-white shadow-xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-base font-bold text-gray-900">Suggest an alternative room</h2>
            <p class="text-sm text-gray-600 mt-1" data-fa-sub></p>
          </div>
          <button type="button" data-fa-close class="text-gray-400 hover:text-gray-700"><span class="material-symbols-outlined">close</span></button>
        </div>
        <div data-fa-conflict class="hidden text-sm bg-red-50 border border-red-200 text-red-700 rounded-xl p-3"></div>
        <div data-fa-body class="space-y-2"></div>
        <div class="space-y-1">
          <label class="text-sm font-bold text-gray-800" for="faReason">Reason for the customer <span class="text-red-500">*</span></label>
          <textarea id="faReason" rows="3" maxlength="500" class="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#7a1f2b]" placeholder="Explain why this day needs to move and why this room fits."></textarea>
        </div>
        <p data-fa-error class="hidden text-sm font-semibold text-red-600"></p>
        <div class="flex flex-col sm:flex-row gap-2 sm:justify-end pt-1">
          <button type="button" data-fa-close class="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50">Cancel</button>
          <button type="button" data-fa-send disabled class="px-5 py-2 rounded-xl bg-[#7a1f2b] text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed">Send suggestion</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const close = () => { wrap.classList.add('hidden'); wrap.classList.remove('flex'); };
    wrap.querySelectorAll('[data-fa-close]').forEach((b) => b.addEventListener('click', close));
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !wrap.classList.contains('hidden')) close(); });
    return { wrap, close, reservationId: null, affectedDate: null };
  }

  async function openFindAlternativeModal(reservationId) {
    if (!findAltModal) findAltModal = buildFindAltModal();
    const m = findAltModal;
    m.reservationId = reservationId;
    const reservation = state.reservations.find((r) => r.reservation_id === reservationId);

    const sub = m.wrap.querySelector('[data-fa-sub]');
    const body = m.wrap.querySelector('[data-fa-body]');
    const conflictBox = m.wrap.querySelector('[data-fa-conflict]');
    const sendBtn = m.wrap.querySelector('[data-fa-send]');
    const errEl = m.wrap.querySelector('[data-fa-error]');
    const reasonEl = m.wrap.querySelector('#faReason');

    sub.textContent = reservation
      ? `${reservation.room_name} · ${formatDateTime(reservation.start_time)} → ${formatTime(reservation.end_time)}`
      : 'Loading…';
    conflictBox.classList.add('hidden');
    errEl.classList.add('hidden');
    sendBtn.disabled = true;
    reasonEl.value = '';
    body.innerHTML = '<p class="text-sm text-gray-500">Searching for matching rooms…</p>';

    m.wrap.classList.remove('hidden');
    m.wrap.classList.add('flex');

    const res = await api(`api/facility-suggestions/alternatives?reservation_id=${encodeURIComponent(reservationId)}`);
    if (!res.ok) { body.innerHTML = `<p class="text-sm text-red-600">${escapeHtml(res.error || 'Could not search for rooms.')}</p>`; return; }

    const data = res.data || {};
    m.affectedDate = data.affected_date || null;
    if (data.conflict_reason) {
      conflictBox.textContent = data.conflict_reason;
      conflictBox.classList.remove('hidden');
      reasonEl.value = `This day conflicts: ${data.conflict_reason} We can move it to a free room of the same type.`;
    }

    const alts = data.alternatives || [];
    if (!alts.length) {
      body.innerHTML = '<p class="text-sm text-gray-600">No matching room (same type, enough capacity) is free at this time on that day.</p>';
      return;
    }
    body.innerHTML = '<p class="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Pick a room</p>' +
      alts.map((a) => `
        <label class="flex items-center gap-3 p-3 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50">
          <input type="radio" name="faRoom" value="${escapeHtml(a.room_id)}" class="w-4 h-4 text-[#7a1f2b] focus:ring-[#7a1f2b]">
          <span class="flex-1"><span class="font-semibold text-gray-800">${escapeHtml(a.name)}</span>
            <span class="text-xs text-gray-500">· ${escapeHtml(String(a.capacity))} seats${a.floor != null ? ' · Floor ' + escapeHtml(String(a.floor)) : ''}${a.room_type ? ' · ' + escapeHtml(a.room_type) : ''}</span></span>
        </label>`).join('');

    const refresh = () => { sendBtn.disabled = !(body.querySelector('input[name="faRoom"]:checked') && reasonEl.value.trim()); };
    body.querySelectorAll('input[name="faRoom"]').forEach((r) => r.addEventListener('change', refresh));
    reasonEl.addEventListener('input', refresh);

    sendBtn.onclick = async () => {
      const chosen = body.querySelector('input[name="faRoom"]:checked');
      const reason = reasonEl.value.trim();
      if (!chosen || !reason) return;
      sendBtn.disabled = true;
      errEl.classList.add('hidden');
      const out = await api('api/facility-suggestions', {
        method: 'POST',
        body: JSON.stringify({
          reservation_id: reservationId,
          suggested_room_id: chosen.value,
          affected_date: m.affectedDate,
          reason
        })
      });
      if (!out.ok) {
        errEl.textContent = out.error || 'Could not send the suggestion.';
        errEl.classList.remove('hidden');
        sendBtn.disabled = false;
        return;
      }
      m.close();
      showToast('Suggestion sent to the customer.', 'success');
      loadAll({ notify: false });
    };
  }

  window.CampusRoomStaff = {
    decide,
    openDetailModal,
    openStaffCancelModal,
    openMoveModal,
    openCancelRequestModal,
    openOverrideModal,
    openFindAlternativeModal,
    toggleFacility,
    updateBatchButton
  };

  // ---------------------------------------------------------------
  // Go
  // ---------------------------------------------------------------

  start();
});

