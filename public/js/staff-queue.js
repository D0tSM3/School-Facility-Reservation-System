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

  // Shared helper (js/util.js). Declared up here so nothing can call it before it exists.
  const { escapeHtml } = window.CampusRoomUtil;

  // ---------------------------------------------------------------
  // Element handles
  // ---------------------------------------------------------------

  const el = (id) => document.getElementById(id);

  const tabPending      = el('tab-pending');
  const tabMoves        = el('tab-moves');
  const tabAll          = el('tab-all');
  const tabMaintenance  = el('tab-maintenance');
  const viewPending     = el('view-pending');
  const viewMoves       = el('view-moves');
  const viewAll         = el('view-all');
  const viewAllList     = el('view-all-list');
  const viewMaintenance = el('view-maintenance');
  const allStatusFilter = el('all-status-filter');

  const pendingBadge     = el('pending-badge-count');
  const moveBadge        = el('move-badge-count');
  const allBadge         = el('all-badge-count');
  const maintenanceBadge = el('maintenance-badge-count');
  const kpiPending       = el('kpi-pending-count');
  const kpiMaintenance   = el('kpi-maintenance-count');
  const kpiAuth          = el('kpi-auth-count');

  const batchApproveBtn   = el('btn-batch-approve');
  const batchApproveLabel = el('batch-approve-label');
  const refreshBtn        = el('btn-refresh-queue');
  const refreshIcon       = el('btn-refresh-icon');
  const exportLogBtn      = el('btn-export-log');

  const toast       = el('action-toast');
  const toastText   = el('action-toast-text');
  const toastIcon   = el('action-toast-icon');
  const toastDismiss = el('btn-dismiss-toast');

  const facilityFilter = el('facility-filter');
  const facilityGrid   = el('facility-grid');

  const alertBox      = el('maintenance-alert');
  const alertLocation = el('maintenance-alert-location');
  const alertTitle    = el('maintenance-alert-title');
  const alertBody     = el('maintenance-alert-body');
  const alertBtn      = el('btn-maintenance-alert-toggle');
  const alertBtnLabel = el('btn-maintenance-alert-label');

  const syncTimestamp = el('sync-timestamp');
  const syncIndicator = el('sync-indicator');
  const accessNotice  = el('access-notice');
  const accessText    = el('access-notice-text');

  // Move review modal
  const moveOverlay    = el('moveReviewModalOverlay');
  const moveSummary    = el('moveReviewSummary');
  const moveComment    = el('moveReviewComment');
  const moveError      = el('moveReviewErrorMsg');
  const moveApproveBtn = el('moveReviewApproveBtn');
  const moveRejectBtn  = el('moveReviewRejectBtn');

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
    activeTab: 'pending',
    wingFilter: 'all',
    allStatusFilter: 'all',
    currentMoveId: null,
    currentCancelId: null,
    loading: false
  };

  // ---------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------

  /** MySQL DATETIME ("2024-10-26 10:00:00") → Date, parsed as local time. */
  function parseDate(value) {
    if (!value) return null;
    const date = new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? null : date;
  }

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
        (kind === 'error' ? 'text-error' : kind === 'success' ? 'text-[#15803D]' : 'text-secondary');
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

  const ACTIVE_TAB_CLASSES = ['bg-surface-container-lowest', 'text-primary', 'shadow-sm'];

  function switchTab(tab) {
    state.activeTab = tab;

    const pairs = [
      ['pending', tabPending, viewPending],
      ['moves', tabMoves, viewMoves],
      ['all', tabAll, viewAll],
      ['maintenance', tabMaintenance, viewMaintenance]
    ];

    pairs.forEach(([name, tabEl, viewEl]) => {
      const active = name === tab;
      if (tabEl) {
        tabEl.classList.toggle('text-on-surface-variant', !active);
        ACTIVE_TAB_CLASSES.forEach((cls) => tabEl.classList.toggle(cls, active));
        tabEl.setAttribute('aria-selected', active ? 'true' : 'false');
      }
      if (viewEl) viewEl.classList.toggle('hidden', !active);
    });

    // The maintenance banner only belongs to the facility tab.
    if (alertBox) {
      alertBox.classList.toggle('hidden', tab !== 'maintenance' || !alertBtn.dataset.roomId);
    }
  }

  if (tabPending) tabPending.addEventListener('click', () => switchTab('pending'));
  if (tabMoves) tabMoves.addEventListener('click', () => switchTab('moves'));
  if (tabAll) tabAll.addEventListener('click', () => switchTab('all'));
  if (tabMaintenance) tabMaintenance.addEventListener('click', () => switchTab('maintenance'));

  // ---------------------------------------------------------------
  // Renderers
  // ---------------------------------------------------------------

  function emptyState(message, icon = 'inbox') {
    return `
      <div class="p-space-lg flex flex-col items-center gap-space-xs text-center bg-surface-container-lowest rounded-lg shadow-sm">
        <span class="material-symbols-outlined text-[32px] text-outline">${icon}</span>
        <p class="font-body-md text-body-md text-on-surface-variant">${escapeHtml(message)}</p>
      </div>`;
  }

  function reservationCard(reservation) {
    const id = escapeHtml(reservation.reservation_id);
    const requester = escapeHtml(reservation.customer_name || reservation.customer_email || 'Unknown requester');
    const meta = statusMeta(reservation.status);
    const isPending = reservation.status === 'Pending';

    return `
      <div class="relative bg-surface-container-lowest rounded-lg shadow-sm overflow-hidden transition-all hover:shadow-md"
           data-card-id="${id}">
        <div class="absolute left-0 top-0 bottom-0 w-1.5 ${meta.accent}"></div>
        <div class="p-space-md pl-space-lg flex flex-col xl:flex-row xl:items-center justify-between gap-space-md">
          <div class="flex flex-col md:flex-row md:items-start gap-space-md flex-1">
            <div class="flex-shrink-0">
              <span class="px-space-xs py-1 rounded bg-secondary-fixed text-on-secondary-fixed font-label-sm tracking-wide">
                #${shortId(reservation.reservation_id)}
              </span>
            </div>
            <div class="space-y-1 flex-1">
              <div class="flex flex-wrap items-center gap-space-xs">
                <h3 class="font-headline-sm text-headline-sm text-on-surface font-bold">${requester}</h3>
                ${reservation.customer_email
                  ? `<span class="px-space-xs py-0.5 rounded bg-surface-container text-on-surface-variant font-label-sm">${escapeHtml(reservation.customer_email)}</span>`
                  : ''}
                <span class="px-space-xs py-0.5 rounded ${meta.badgeClass} font-label-sm font-semibold flex items-center gap-0.5">
                  <span class="material-symbols-outlined text-[14px]">${meta.icon}</span>
                  ${escapeHtml(meta.label)}
                </span>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-space-md gap-y-1 pt-space-xs text-on-surface-variant font-body-sm text-body-sm">
                <div class="flex items-center gap-1">
                  <span class="material-symbols-outlined text-[16px] text-primary">meeting_room</span>
                  <span class="font-semibold text-on-surface">${escapeHtml(reservation.room_name || 'Room')}</span>
                  <span>(${escapeHtml(roomMeta(reservation))})</span>
                </div>
                <div class="flex items-center gap-1">
                  <span class="material-symbols-outlined text-[16px] text-secondary">calendar_today</span>
                  <span class="font-semibold text-on-surface">${escapeHtml(formatDay(reservation.start_time))}</span>
                  <span>${escapeHtml(formatTime(reservation.start_time))} – ${escapeHtml(formatTime(reservation.end_time))}</span>
                </div>
                <div class="flex items-center gap-1">
                  <span class="material-symbols-outlined text-[16px] text-tertiary">category</span>
                  <span>Purpose:</span>
                  <span class="font-semibold text-on-surface">${escapeHtml(reservation.purpose || '—')}</span>
                </div>
              </div>
              <div class="pt-space-xs flex flex-wrap items-center gap-space-xs font-body-sm text-body-sm text-on-surface-variant">
                <span class="font-label-sm text-label-sm text-on-tertiary-fixed-variant">Filed:</span>
                <span class="bg-surface-container-high px-2 py-0.5 rounded text-on-surface font-medium">${escapeHtml(formatDateTime(reservation.created_at))}</span>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-space-xs justify-end flex-shrink-0 pt-space-xs xl:pt-0">
            ${isPending ? `
            <button type="button"
                    class="btn-approve-req flex items-center gap-space-xs px-space-md py-2 rounded-lg bg-surface-container-lowest text-[#15803D] hover:bg-[#DCFCE7] shadow-sm font-label-lg transition-all disabled:opacity-40 disabled:pointer-events-none"
                    data-id="${id}" data-name="${requester}" title="Approve Reservation">
              <span class="material-symbols-outlined text-[18px]">check</span>
              <span>Approve</span>
            </button>
            <button type="button"
                    class="btn-reject-req flex items-center gap-space-xs px-space-md py-2 rounded-lg bg-surface-container-lowest text-error hover:bg-error-container shadow-sm font-label-lg transition-all disabled:opacity-40 disabled:pointer-events-none"
                    data-id="${id}" data-name="${requester}" title="Decline Reservation">
              <span class="material-symbols-outlined text-[18px]">close</span>
              <span>Reject</span>
            </button>` : ''}
            <button type="button"
                    class="btn-actions-menu p-2 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
                    data-id="${id}" aria-haspopup="menu" aria-expanded="false" title="More actions">
              <span class="material-symbols-outlined text-[20px]">more_vert</span>
            </button>
          </div>
        </div>
      </div>`;
  }

  function renderPending() {
    if (!viewPending) return;

    const pending = state.reservations.filter((r) => r.status === 'Pending');

    viewPending.innerHTML = pending.length
      ? pending.map(reservationCard).join('')
      : emptyState('No pending applications. The dispatch queue is clear.', 'task_alt');

    if (pendingBadge) pendingBadge.textContent = `${pending.length} Requests`;
    if (batchApproveLabel) {
      batchApproveLabel.textContent = pending.length
        ? `Batch Approve All Pending (${pending.length})`
        : 'Batch Approve All Pending';
    }
    if (batchApproveBtn) batchApproveBtn.disabled = pending.length === 0;
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
    allStatusFilter.addEventListener('change', () => {
      state.allStatusFilter = allStatusFilter.value;
      renderAllRequests();
    });
  }

  function moveCard(request) {
    const id = escapeHtml(request.request_id);
    return `
      <div class="relative bg-surface-container-lowest rounded-lg shadow-sm overflow-hidden transition-all hover:shadow-md">
        <div class="absolute left-0 top-0 bottom-0 w-1.5 bg-secondary"></div>
        <div class="p-space-md pl-space-lg flex flex-col xl:flex-row xl:items-center justify-between gap-space-md">
          <div class="space-y-1 flex-1">
            <div class="flex flex-wrap items-center gap-space-xs">
              <span class="px-space-xs py-1 rounded bg-secondary-fixed text-on-secondary-fixed font-label-sm tracking-wide">#${shortId(request.reservation_id)}</span>
              <h3 class="font-headline-sm text-headline-sm text-on-surface font-bold">${escapeHtml(request.customer_name || request.customer_email || 'Requester')}</h3>
              <span class="px-space-xs py-0.5 rounded bg-secondary-container/30 text-on-secondary-container font-label-sm font-semibold">MOVE REQUEST</span>
            </div>
            <div class="flex items-center gap-1 pt-space-xs font-body-sm text-body-sm text-on-surface-variant">
              <span class="material-symbols-outlined text-[16px] text-primary">meeting_room</span>
              <span class="font-semibold text-on-surface">${escapeHtml(request.room_name || 'Room')}</span>
            </div>
            <div class="font-body-md text-body-md text-on-surface">
              <span class="font-semibold text-on-surface-variant">Original:</span>
              ${escapeHtml(formatDateTime(request.original_start_time))} – ${escapeHtml(formatTime(request.original_end_time))}
            </div>
            <div class="font-body-md text-body-md text-on-surface">
              <span class="font-semibold text-secondary">Requested:</span>
              ${escapeHtml(formatDateTime(request.requested_start_time))} – ${escapeHtml(formatTime(request.requested_end_time))}
            </div>
          </div>
          <div class="flex items-center gap-space-xs justify-end flex-shrink-0 pt-space-xs xl:pt-0">
            <button type="button"
                    class="btn-review-move flex items-center gap-space-xs px-space-md py-2 rounded-lg bg-surface-container-high text-on-surface hover:bg-surface-container-highest shadow-sm font-label-lg transition-all"
                    data-id="${id}">
              <span class="material-symbols-outlined text-[18px]">rate_review</span>
              <span>Review Request</span>
            </button>
          </div>
        </div>
      </div>`;
  }

  function renderMoves() {
    if (!viewMoves) return;

    viewMoves.innerHTML = state.moveRequests.length
      ? state.moveRequests.map(moveCard).join('')
      : emptyState('No pending move requests.', 'event_available');

    if (moveBadge) moveBadge.textContent = `${state.moveRequests.length} Requests`;
  }

  function facilityCard(room) {
    const offline = room.status === 'Maintenance';
    const occupied = room.live_status === 'Occupied';

    const badge = offline
      ? '<span class="px-2 py-0.5 rounded text-label-sm bg-surface-container-highest text-tertiary font-bold">MAINTENANCE</span>'
      : occupied
        ? '<span class="px-2 py-0.5 rounded text-label-sm bg-secondary-fixed text-on-secondary-fixed font-bold">OCCUPIED</span>'
        : '<span class="px-2 py-0.5 rounded text-label-sm bg-[#DCFCE7] text-[#15803D] font-bold">AVAILABLE</span>';

    return `
      <div class="p-space-md rounded-lg bg-surface-container flex flex-col justify-between space-y-space-sm">
        <div class="flex items-start justify-between gap-space-xs">
          <div>
            <span class="font-headline-sm text-headline-sm text-on-surface font-bold">${escapeHtml(room.name)}</span>
            <p class="font-body-sm text-body-sm text-on-surface-variant">${escapeHtml(roomMeta(room))}</p>
          </div>
          ${badge}
        </div>
        <div class="flex items-center justify-between pt-space-xs gap-space-xs">
          <span class="font-label-sm text-label-sm text-on-surface-variant">Lockout Override</span>
          <button type="button"
                  class="btn-toggle-facility px-3 py-1 rounded font-label-md transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                    offline
                      ? 'bg-secondary-fixed text-on-secondary-fixed hover:bg-secondary-fixed-dim'
                      : 'bg-surface-container-highest text-on-surface hover:bg-outline-variant'
                  }"
                  data-room-id="${escapeHtml(room.room_id)}"
                  data-room-name="${escapeHtml(room.name)}"
                  data-next-status="${offline ? 'Available' : 'Maintenance'}">
            ${offline ? 'Set Available' : 'Set Maintenance'}
          </button>
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
      : `<div class="p-space-md text-on-surface-variant font-body-md text-body-md">No rooms match this filter.</div>`;

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

    const offline = state.rooms.find((room) => room.status === 'Maintenance');

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
    const offline = state.rooms.filter((r) => r.status === 'Maintenance').length;
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
    renderAllRequests();
    renderFacilityFilter();
    renderFacilities();
    renderMaintenanceAlert();
    renderKpis();
    stampSync();
  }

  function stampSync() {
    if (!syncTimestamp) return;
    try {
      const now = new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Manila',
        month: 'short',
        day: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      syncTimestamp.textContent = `Sync: ${now} PHT`;
    } catch (_) {
      syncTimestamp.textContent = `Sync: ${new Date().toLocaleString()}`;
    }
  }

  // ---------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------

  async function loadAll(options = {}) {
    if (state.loading) return;
    state.loading = true;
    if (refreshIcon) refreshIcon.classList.add('animate-spin');
    if (syncIndicator) syncIndicator.classList.add('animate-pulse');

    const [reservations, rooms, moves] = await Promise.all([
      api('api/reservations'),
      api('api/rooms'),
      api('api/reservations/move-requests?status=Pending')
    ]);

    state.loading = false;
    if (refreshIcon) refreshIcon.classList.remove('animate-spin');

    const failed = [reservations, rooms, moves].find((r) => !r.ok);
    if (failed && handleAuthFailure(failed)) return;

    if (reservations.ok) state.reservations = reservations.data || [];
    if (rooms.ok) state.rooms = rooms.data || [];
    if (moves.ok) state.moveRequests = moves.data || [];

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
    if (facilityGrid) facilityGrid.innerHTML = '';
    [batchApproveBtn, refreshBtn, exportLogBtn].forEach((btn) => {
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

    const facilityBtn = event.target.closest('.btn-toggle-facility');
    if (facilityBtn) {
      toggleFacility(
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
    batchApproveBtn.addEventListener('click', async () => {
      const pending = state.reservations.filter((r) => r.status === 'Pending');
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
  // Refresh
  // ---------------------------------------------------------------

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => loadAll({ notify: true }));
  }

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
    alertBtn.addEventListener('click', () => {
      const roomId = alertBtn.dataset.roomId;
      if (!roomId) return;
      toggleFacility(roomId, 'Available', alertBtn.dataset.roomName, alertBtn);
    });
  }

  if (facilityFilter) {
    facilityFilter.addEventListener('change', () => {
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
    exportLogBtn.addEventListener('click', () => {
      window.CampusRoomLogArchive.openGlobal();
    });
  }

  // ---------------------------------------------------------------
  // Application detail modal
  // ---------------------------------------------------------------

  function detailRow(label, value) {
    return `
      <div class="flex justify-between gap-space-md py-space-xs border-b border-outline-variant last:border-0">
        <span class="font-label-md text-label-md text-on-surface-variant">${escapeHtml(label)}</span>
        <span class="font-body-md text-body-md text-on-surface text-right">${escapeHtml(value)}</span>
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
    detailOverlay.addEventListener('click', (event) => {
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
      'fixed z-[70] hidden min-w-[220px] py-1 bg-surface-container-lowest rounded-lg shadow-xl border border-outline-variant';
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
              class="w-full flex items-center gap-space-xs px-space-md py-2 text-left font-label-md text-label-md transition-colors ${
                item.danger ? 'text-error hover:bg-error-container' : 'text-on-surface hover:bg-surface-container'
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
          <div><span class="font-semibold text-on-surface">Requester:</span> ${escapeHtml(reservation.customer_name || reservation.customer_email || '—')}</div>
          <div><span class="font-semibold text-on-surface">Room:</span> ${escapeHtml(reservation.room_name || '—')}</div>
          <div><span class="font-semibold text-on-surface">Permit:</span> #${shortId(reservationId)}</div>`
        : `<div><span class="font-semibold text-on-surface">Permit:</span> #${shortId(reservationId)}</div>`;
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
    staffCancelOverlay.addEventListener('click', (event) => {
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
    const request = state.moveRequests.find((r) => r.request_id === requestId);
    state.currentMoveId = requestId;

    if (moveComment) moveComment.value = '';
    if (moveError) moveError.classList.add('hidden');

    if (moveSummary) {
      moveSummary.innerHTML = request
        ? `
          <div><span class="font-semibold text-on-surface">Requester:</span> ${escapeHtml(request.customer_name || request.customer_email || '—')}</div>
          <div><span class="font-semibold text-on-surface">Room:</span> ${escapeHtml(request.room_name || '—')}</div>
          <div><span class="font-semibold text-on-surface">Original:</span> ${escapeHtml(formatDateTime(request.original_start_time))} – ${escapeHtml(formatTime(request.original_end_time))}</div>
          <div><span class="font-semibold text-secondary">Requested:</span> ${escapeHtml(formatDateTime(request.requested_start_time))} – ${escapeHtml(formatTime(request.requested_end_time))}</div>`
        : '';
    }

    if (moveOverlay) {
      moveOverlay.classList.remove('opacity-0', 'pointer-events-none');
      moveOverlay.setAttribute('aria-hidden', 'false');
    }
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
    moveOverlay.addEventListener('click', (event) => {
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
    showToast(`Move request ${status.toLowerCase()}.`, 'success');
    await loadAll();
  }

  if (moveApproveBtn) moveApproveBtn.addEventListener('click', () => submitMoveReview('Approved'));
  if (moveRejectBtn) moveRejectBtn.addEventListener('click', () => submitMoveReview('Rejected'));

  // Escape closes whichever modal (or the action menu) is open.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    closeMoveModal();
    closeDetailModal();
    closeActionMenu();
    closeStaffCancelModal();
  });

  // ---------------------------------------------------------------
  // Go
  // ---------------------------------------------------------------

  start();
});
