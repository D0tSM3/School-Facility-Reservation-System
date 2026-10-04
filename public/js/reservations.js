document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // Shared helpers (js/util.js). Declared up here so nothing can call them before they exist.
  const { escapeHtml, parseDate: sharedParseDate } = window.CampusRoomUtil || {};
  // Guard against a stale/older cached copy of util.js that predates
  // parseDate() - without this, every render silently died with
  // "parseDate is not a function" and got reported as a fake network error.
  const parseDate = typeof sharedParseDate === 'function'
    ? sharedParseDate
    : function (value) {
      if (!value) return null;
      const date = new Date(String(value).replace(' ', 'T'));
      return Number.isNaN(date.getTime()) ? null : date;
    };
  if (typeof sharedParseDate !== 'function') {
    console.warn('[My Reservations] window.CampusRoomUtil.parseDate missing - using local fallback. util.js may be stale/cached.');
  }

  // Staff and Admin are not allowed on this page (Customer-only reservation history).
  // Nav-hiding in app.js isn't enough on its own since a Staff/Admin user can still
  // type this URL directly, so bounce them to the Staff Queue instead.
  (function guardStaffAccess() {
    const BASE = window.location.pathname.replace(/[^\/]*$/, '');
    fetch(BASE + 'api/auth/me', { credentials: 'include' })
      .then(res => res.json())
      .then(json => {
        const currentUser = json.success ? json.data : null;
        const role = String(currentUser && currentUser.role || '').toLowerCase();
        if (role === 'staff' || role === 'admin') {
          window.location.replace(BASE + 'staff-dashboard.html');
        }
      })
      .catch(err => console.error('Error checking session role:', err));
  })();

  const urlParams = new URLSearchParams(window.location.search);
  let activeFilter = urlParams.get('filter') || 'all';

  const tabs = document.querySelectorAll('.filter-btn');

  // Sync visual tab state with activeFilter on load
  if (tabs) {
    tabs.forEach(t => {
      t.classList.remove('bg-white', 'shadow-sm', 'text-gray-800', 'font-semibold');
      t.classList.add('text-gray-500', 'hover:text-gray-700', 'font-medium');
    });
    const initialTab = Array.from(tabs).find(t => t.getAttribute('data-filter') === activeFilter) ||
      Array.from(tabs).find(t => t.getAttribute('data-filter') === 'all');
    if (initialTab) {
      initialTab.classList.remove('text-gray-500', 'hover:text-gray-700', 'font-medium');
      initialTab.classList.add('bg-white', 'shadow-sm', 'text-gray-800', 'font-semibold');
    }
  }

  const reservationList = document.getElementById('reservationList');
  const reservationListEmpty = document.getElementById('reservationListEmpty');
  const reservationListError = document.getElementById('reservationListError');
  const reservationListErrorText = document.getElementById('reservationListErrorText');
  const reservationListRetry = document.getElementById('reservationListRetry');
  const searchInput = document.getElementById('reservationSearch');
  const modal = document.getElementById('cancelModal');
  const removeModalTitle = document.getElementById('removeModalTitle');
  const removeModalText = document.getElementById('removeModalText');
  const modalClose = document.getElementById('modalCloseBtn');
  const modalDismiss = document.getElementById('modalDismissBtn');
  const modalConfirm = document.getElementById('modalConfirmBtn');

  // Cancellation request (approved bookings only).
  const cancelReqModal = document.getElementById('cancelRequestModal');
  const cancelReqPermit = document.getElementById('cancelRequestPermitCode');
  const cancelReqReason = document.getElementById('cancelRequestReason');
  const cancelReqError = document.getElementById('cancelRequestError');
  const cancelReqSubmit = document.getElementById('cancelRequestSubmit');
  const cancelReqDismiss = document.getElementById('cancelRequestDismiss');
  const newReservationBtn = document.getElementById('newReservationBtn');
  const exportSlipBtn = document.getElementById('exportSlipBtn');

  // Notification toast (same markup/behavior pattern as staff-queue.js).
  const toast = document.getElementById('action-toast');
  const toastText = document.getElementById('action-toast-text');
  const toastIcon = document.getElementById('action-toast-icon');
  const toastDismiss = document.getElementById('btn-dismiss-toast');
  let toastTimer;

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

  let currentTargetReservationId = null;
  let allReservations = [];

  const BASE = window.location.pathname.replace(/[^\/]*$/, '');

  // ---------------------------------------------------------------
  // Fetching: loading / success / empty / error states
  // ---------------------------------------------------------------

  function skeletonCardHtml() {
    return `<div class="reservation-card bg-white p-6 rounded-2xl border border-gray-100 shadow-sm relative overflow-hidden animate-pulse">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-space-md">
        <div class="flex items-start gap-space-md w-full">
          <div class="rounded bg-surface-container min-w-[56px] h-[52px]"></div>
          <div class="flex flex-col space-y-space-xs flex-1">
            <div class="h-4 w-1/3 bg-surface-container rounded"></div>
            <div class="h-5 w-1/2 bg-surface-container rounded"></div>
            <div class="h-4 w-2/3 bg-surface-container rounded"></div>
          </div>
        </div>
      </div>
    </div>`;
  }

  function setLoading(isLoading) {
    if (!reservationList) return;
    reservationList.setAttribute('aria-busy', String(isLoading));
    if (isLoading) {
      reservationList.innerHTML = skeletonCardHtml().repeat(3);
    }
  }

  function hideListStates() {
    if (reservationListError) reservationListError.classList.add('hidden');
    if (reservationListEmpty) reservationListEmpty.classList.add('hidden');
  }

  function showListError(message) {
    allReservations = [];
    if (reservationList) reservationList.innerHTML = '';
    if (reservationListErrorText) reservationListErrorText.textContent = message;
    if (reservationListError) reservationListError.classList.remove('hidden');
    if (reservationListEmpty) reservationListEmpty.classList.add('hidden');
  }

  function fetchReservations() {
    setLoading(true);
    fetch(BASE + 'api/reservations/mine', { credentials: 'same-origin' })
      // Parse the body inside its own catch so a bad/non-JSON response is
      // reported as a bad response, not confused with the request never
      // reaching the server at all.
      .then(res =>
        res
          .json()
          .catch(() => {
            throw new Error('Server returned an unreadable (non-JSON) response.');
          })
          .then(json => ({ status: res.status, json }))
      )
      .then(({ status, json }) => {
        if (status === 401) {
          window.location.href = 'index.html';
          return;
        }
        if (!json.success) {
          showListError(json.error || 'Could not load your reservations.');
          return;
        }
        hideListStates();
        allReservations = groupBySeries(json.data || []);
        renderReservations();
        applyFilters();
        fetchOverrideRequests();
        fetchFacilitySuggestions();
      })
      .catch(err => {
        // Log the real cause instead of silently swallowing it - this is
        // what actually failed, whether that's a dropped connection, a bad
        // response body, or a bug while rendering the data.
        console.error('[My Reservations] failed to load:', err);
        const message = (err instanceof TypeError)
          ? 'Network error. Check that the server is reachable.'
          : `Could not load your reservations (${err.message}).`;
        showListError(message);
      })
      .finally(() => setLoading(false));
  }

  if (reservationListRetry) reservationListRetry.addEventListener('click', fetchReservations);

  // ---------------------------------------------------------------
  // Urgent (conflict override) requests: shown in their own panel above the
  // list. They aren't reservations yet, so the status filters don't apply.
  // ---------------------------------------------------------------

  let overridePanel = null;

  function ensureOverridePanel() {
    if (overridePanel || !reservationList || !reservationList.parentNode) return overridePanel;
    overridePanel = document.createElement('section');
    overridePanel.id = 'overrideRequestsPanel';
    overridePanel.className = 'hidden mb-4';
    overridePanel.setAttribute('aria-label', 'Urgent override requests');
    reservationList.parentNode.insertBefore(overridePanel, reservationList);
    return overridePanel;
  }

  /** Label + colors + detail line for an override request's current state. */
  function overrideState(o) {
    if (o.status === 'Pending') {
      return { label: 'Pending review', cls: 'bg-yellow-100 text-yellow-700', note: 'Staff will decide whether to ask the current holder to move.' };
    }
    if (o.status === 'Rejected') {
      return { label: 'Rejected', cls: 'bg-red-100 text-red-700', note: o.staff_comment ? `Staff comment: ${o.staff_comment}` : 'Staff declined this request.' };
    }
    switch (o.outcome) {
      case 'Booked':
        return { label: 'Approved · booked', cls: 'bg-green-100 text-green-700', note: 'Your reservation was created and is awaiting normal approval — see it in the list below.' };
      case 'Move rejected':
        return { label: 'Not fulfilled', cls: 'bg-red-100 text-red-700', note: 'The current booking could not be moved, so the slot stays with its holder.' + (o.outcome_note ? ` Staff comment: ${o.outcome_note}` : '') };
      case 'Booking failed':
        return { label: 'Not fulfilled', cls: 'bg-red-100 text-red-700', note: `The slot was freed, but your booking couldn't be created: ${o.outcome_note || 'the room is no longer free.'}` };
      default:
        return { label: 'Approved · awaiting move', cls: 'bg-violet-100 text-violet-700', note: 'Staff approved your request and asked the current booking to move. Your reservation is created once that move is confirmed.' + (o.staff_comment ? ` Staff comment: ${o.staff_comment}` : '') };
    }
  }

  function renderOverrideRequests(list) {
    const panel = ensureOverridePanel();
    if (!panel) return;
    panel.classList.toggle('hidden', !list.length);
    if (!list.length) { panel.innerHTML = ''; return; }

    panel.innerHTML = `
      <h2 class="text-sm font-bold text-gray-800 mb-2 flex items-center gap-1.5">
        <span class="material-symbols-outlined text-[18px] text-violet-600">priority_high</span>Urgent override requests
      </h2>` + list.map(o => {
      const s = overrideState(o);
      const d = formatDate(o.start_time);
      const multi = String(o.start_time).slice(0, 10) !== String(o.end_time).slice(0, 10);
      const days = multi ? ` to ${formatDate(o.end_time).month} ${formatDate(o.end_time).day}` : '';
      return `<div class="bg-white px-5 py-3 rounded-xl border border-violet-200 shadow-sm mb-2">
          <div class="flex items-center gap-2 flex-wrap">
            <h3 class="text-sm font-bold text-gray-900">${escapeHtml(o.purpose)}</h3>
            <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded ${s.cls}">${escapeHtml(s.label)}</span>
          </div>
          <div class="text-xs text-gray-500 mt-1">
            ${escapeHtml(o.room_name)} • ${escapeHtml(d.month)} ${escapeHtml(String(d.day))}${escapeHtml(days)} • ${formatTime(o.start_time)} – ${formatTime(o.end_time)}${multi ? ' daily' : ''}
          </div>
          <div class="text-xs text-gray-600 mt-1.5">${escapeHtml(s.note)}</div>
        </div>`;
    }).join('');
  }

  function fetchOverrideRequests() {
    fetch(BASE + 'api/conflict-override-requests/mine', { credentials: 'same-origin' })
      .then(res => res.json())
      .then(json => renderOverrideRequests(json && json.success && Array.isArray(json.data) ? json.data : []))
      .catch(err => console.error('[My Reservations] override requests failed to load:', err));
  }

  // ---------------------------------------------------------------
  // Facility suggestions: staff propose moving ONE conflicting day of a
  // booking to a different room. Shown in their own panel above everything,
  // with Accept / Decline. (Step 5)
  // ---------------------------------------------------------------

  let facilityPanel = null;

  function ensureFacilityPanel() {
    if (facilityPanel || !reservationList || !reservationList.parentNode) return facilityPanel;
    facilityPanel = document.createElement('section');
    facilityPanel.id = 'facilitySuggestionsPanel';
    facilityPanel.className = 'hidden mb-4';
    facilityPanel.setAttribute('aria-label', 'Facility suggestions from staff');
    // Above the override panel when it exists, otherwise directly above the list.
    reservationList.parentNode.insertBefore(facilityPanel, overridePanel || reservationList);
    return facilityPanel;
  }

  function renderFacilitySuggestions(list) {
    const panel = ensureFacilityPanel();
    if (!panel) return;
    panel.classList.toggle('hidden', !list.length);
    if (!list.length) { panel.innerHTML = ''; return; }

    panel.innerHTML = `
      <h2 class="text-sm font-bold text-gray-800 mb-2 flex items-center gap-1.5">
        <span class="material-symbols-outlined text-[18px] text-sky-600">swap_horiz</span>Room change suggested by staff
      </h2>` + list.map(s => {
      const d = formatDate(s.affected_date);
      return `<div class="bg-white px-5 py-4 rounded-xl border-2 border-sky-200 shadow-sm mb-2" data-suggestion-card="${escapeHtml(s.suggestion_id)}">
          <p class="text-sm text-gray-800">
            Staff suggests moving your <span class="font-bold">${escapeHtml(d.month)} ${escapeHtml(String(d.day))}</span> booking
            from <span class="font-bold">${escapeHtml(s.original_room_name)}</span>
            to <span class="font-bold text-sky-800">${escapeHtml(s.suggested_room_name)}</span>
            because ${escapeHtml(s.reason)}
            <span class="text-gray-500">The rest of your booking is unaffected.</span>
          </p>
          <div class="text-xs text-gray-500 mt-1.5">${escapeHtml(s.purpose || '')} • ${formatTime(s.start_time)} – ${formatTime(s.end_time)}</div>
          <p data-suggestion-error class="hidden text-xs font-semibold text-red-600 mt-2"></p>
          <div class="flex items-center gap-2 mt-3">
            <button type="button" data-suggestion-accept="${escapeHtml(s.suggestion_id)}"
              class="inline-flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 text-white hover:bg-emerald-700 text-xs font-semibold rounded-lg transition-all shadow-sm">
              <span class="material-symbols-outlined text-[14px]">check</span>Accept
            </button>
            <button type="button" data-suggestion-decline="${escapeHtml(s.suggestion_id)}"
              class="inline-flex items-center gap-1.5 px-4 py-1.5 bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 hover:border-gray-300 text-xs font-semibold rounded-lg transition-all shadow-sm">
              <span class="material-symbols-outlined text-[14px]">close</span>Decline
            </button>
          </div>
        </div>`;
    }).join('');

    panel.querySelectorAll('[data-suggestion-accept]').forEach(b =>
      b.addEventListener('click', () => respondToSuggestion(b.getAttribute('data-suggestion-accept'), 'Accepted', b)));
    panel.querySelectorAll('[data-suggestion-decline]').forEach(b =>
      b.addEventListener('click', () => respondToSuggestion(b.getAttribute('data-suggestion-decline'), 'Declined', b)));
  }

  function respondToSuggestion(suggestionId, status, btn) {
    const card = btn.closest('[data-suggestion-card]');
    const errEl = card ? card.querySelector('[data-suggestion-error]') : null;
    // Lock both buttons while the request is in flight.
    const buttons = card ? card.querySelectorAll('button') : [btn];
    buttons.forEach(b => { b.disabled = true; b.classList.add('opacity-50', 'cursor-not-allowed'); });
    if (errEl) errEl.classList.add('hidden');

    fetch(BASE + 'api/facility-suggestions/' + encodeURIComponent(suggestionId), {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    })
      .then(res => res.json().catch(() => null).then(json => ({ status: res.status, json })))
      .then(({ status: code, json }) => {
        if (code === 401) { window.location.href = 'index.html'; return; }
        if (!json || !json.success) {
          const msg = (json && json.error) || 'Could not record your response. Please try again.';
          if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
          buttons.forEach(b => { b.disabled = false; b.classList.remove('opacity-50', 'cursor-not-allowed'); });
          return;
        }
        // Drop the answered card immediately so the panel updates even before
        // the reload lands; hide the whole panel once nothing is left.
        if (card) card.remove();
        if (facilityPanel && !facilityPanel.querySelector('[data-suggestion-card]')) {
          facilityPanel.classList.add('hidden');
          facilityPanel.innerHTML = '';
        }
        // Accepting changes the booking's room; reload so the list (and its room
        // labels) reflect the room that is now assigned (and re-syncs the panel).
        fetchReservations();
      })
      .catch(err => {
        console.error('[My Reservations] suggestion response failed:', err);
        if (errEl) { errEl.textContent = 'Network error. Check your connection and try again.'; errEl.classList.remove('hidden'); }
        buttons.forEach(b => { b.disabled = false; b.classList.remove('opacity-50', 'cursor-not-allowed'); });
      });
  }

  function fetchFacilitySuggestions() {
    fetch(BASE + 'api/facility-suggestions/mine?status=Pending', { credentials: 'same-origin' })
      .then(res => res.json())
      .then(json => renderFacilitySuggestions(json && json.success && Array.isArray(json.data) ? json.data : []))
      .catch(err => console.error('[My Reservations] facility suggestions failed to load:', err));
  }

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------

  function formatDate(value) {
    // parseDate() (js/util.js) swaps the space in "YYYY-MM-DD HH:MM:SS" for
    // a "T" before handing it to `new Date()` — strict-spec browsers like
    // Safari refuse to parse the space-separated form and silently return
    // an Invalid Date, which is why reservations were vanishing from the
    // Upcoming/Past tiles there.
    const date = parseDate(value);
    return date
      ? {
        month: date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
        day: date.toLocaleDateString('en-US', { day: '2-digit' }),
        year: date.getFullYear()
      }
      : { month: '---', day: '--', year: '----' };
  }

  function formatTime(value) {
    const date = parseDate(value);
    return date
      ? date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : 'Time unavailable';
  }

  // Same Tailwind class strings the six hand-written cards used, so the
  // action buttons look identical to before now that they're generated.

  const ACTION_STYLES = {
    cancel: 'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-red-600 border border-gray-200 hover:bg-red-50 hover:border-red-200 hover:text-red-700 text-xs font-semibold rounded-lg transition-all shadow-sm',
    remove: 'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-800 text-xs font-semibold rounded-lg transition-all shadow-sm',
    reqcancel: 'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-red-600 border border-gray-200 hover:bg-red-50 hover:border-red-200 hover:text-red-700 text-xs font-semibold rounded-lg transition-all shadow-sm',
    move: 'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-blue-600 border border-gray-200 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 text-xs font-semibold rounded-lg transition-all shadow-sm',
    slip: 'inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#7a1f2b] text-white hover:bg-[#5e1821] border border-transparent text-xs font-semibold rounded-lg transition-all shadow-sm',
    rebook: 'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-emerald-600 border border-gray-200 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 text-xs font-semibold rounded-lg transition-all shadow-sm',
    logs: 'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-800 text-xs font-semibold rounded-lg transition-all shadow-sm'
  };

  const ACTION_ICONS = {
    cancel: 'cancel',
    remove: 'delete',
    reqcancel: 'free_cancellation',
    move: 'edit_calendar',
    slip: 'receipt_long',
    rebook: 'event_repeat',
    logs: 'history'
  };

  function actionButton(action, id, label, disabledReason) {
    const icon = ACTION_ICONS[action] ? `<span class="material-symbols-outlined text-[14px]">${ACTION_ICONS[action]}</span>` : '';
    const off = disabledReason
      ? ` disabled title="${escapeHtml(disabledReason)}" class="${ACTION_STYLES[action]} opacity-50 cursor-not-allowed"`
      : ` class="${ACTION_STYLES[action]}"`;
    return `<button${off} data-action="${action}" data-id="${escapeHtml(id)}">${icon}${label}</button>`;
  }

  /** Today as 'YYYY-MM-DD' in local time â€” never via toISOString(), which is UTC. */
  function todayYMD() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /**
   * Whether a reservation's end_time is already in the past. Uses parseDate()
   * rather than a bare `new Date(reservation.end_time) < new Date()` â€” on a
   * strict-spec browser the bare form is an Invalid Date, and `Invalid < x`
   * silently evaluates to false either way, so unparseable values fall back
   * to "not past" here too rather than to whatever `null < new Date()` would do.
   */
  function isPastEnd(reservation) {
    const end = parseDate(reservation.end_time);
    return end ? end < new Date() : false;
  }

  /**
   * '' when a cancellation request may still be filed, otherwise why it can't.
   * Mirrors the server rule in ReservationController::requestCancel(); the
   * server is still the authority and repeats every one of these checks.
   */
  function cancelRequestBlockedReason(reservation) {
    if (reservation.cancel_status === 'Pending') {
      return 'A cancellation request for this booking is already awaiting staff review.';
    }
    // Wall-clock date, read literally from the stored value (never device-local).
    if (String(reservation.start_time).slice(0, 10) <= todayYMD()) {
      return 'Cancellation requests close the day before the booking. Please contact the facilities desk.';
    }
    return '';
  }

  /**
   * '' when a move request may still be filed, otherwise why it can't.
   * Mirrors the server rule in ReservationController::requestMove(); the
   * server is still the authority and repeats every one of these checks.
   */
  function moveRequestBlockedReason(reservation) {
    if (reservation.move_status === 'Pending') {
      return 'A move request for this booking is already awaiting staff review.';
    }
    if (isPastEnd(reservation)) {
      return 'This booking has already passed and can no longer be moved.';
    }
    return '';
  }

  // Which buttons show per status. An approved booking is deliberately NOT
  // cancellable here: the room is committed, so it goes through a request.
  function buildActions(reservation) {
    const id = reservation.reservation_id;
    const buttons = [];

    switch (reservation.status) {
      case 'Pending':
        buttons.push(actionButton('slip', id, 'View Request Slip'));
        buttons.push(actionButton('move', id, 'Move', moveRequestBlockedReason(reservation)));
        buttons.push(actionButton('remove', id, 'Withdraw'));
        break;
      case 'Approved':
        buttons.push(actionButton('move', id, 'Move', moveRequestBlockedReason(reservation)));
        buttons.push(actionButton('reqcancel', id, 'Cancel', cancelRequestBlockedReason(reservation)));
        buttons.push(actionButton('slip', id, 'View Slip'));
        break;
      case 'Completed':
      case 'Cancelled':
      case 'Rejected':
        buttons.push(actionButton('logs', id, 'View Logs'));
        buttons.push(actionButton('rebook', id, 'Re-book'));
        break;
    }
    return buttons.join('');
  }

  function groupBySeries(rows) {
    const groups = {};
    const result = [];
    rows.forEach(row => {
      if (!row.series_id) {
        result.push(row);
      } else {
        if (!groups[row.series_id]) {
          const parent = JSON.parse(JSON.stringify(row));
          parent.series_rows = [row];
          parent.is_multi_day = true;
          groups[row.series_id] = parent;
          result.push(parent);
        } else {
          groups[row.series_id].series_rows.push(row);
        }
      }
    });

    result.forEach(parent => {
      if (parent.is_multi_day) {
        parent.series_rows.sort((a, b) => a.start_time.localeCompare(b.start_time));

        const statuses = parent.series_rows.map(r => r.status);
        if (statuses.includes('Pending')) parent.status = 'Pending';
        else if (statuses.includes('Rejected')) parent.status = 'Rejected';
        else if (statuses.includes('Cancelled')) parent.status = 'Cancelled';
        else parent.status = statuses[0];

        const datesObj = parent.series_rows.map(r => parseDate(r.start_time));
        let isConsecutive = true;
        for (let i = 1; i < datesObj.length; i++) {
          const diffDays = Math.round((datesObj[i] - datesObj[i - 1]) / (1000 * 60 * 60 * 24));
          if (diffDays !== 1) {
            isConsecutive = false;
            break;
          }
        }
        parent.is_consecutive = isConsecutive;
        parent.datesObj = datesObj;
      }
    });

    return result;
  }

  function renderReservations() {
    if (!reservationList) return;

    // No longer filters out Cancelled â€” every status renders, and the
    // existing 'history' tab filter (below) already accepts it.
    reservationList.innerHTML = allReservations.map(reservation => {
      const date = formatDate(reservation.start_time);
      const isPast = isPastEnd(reservation);

      // Guard against a row with a missing/null status (e.g. bad data,
      // a schema change) - throwing here would abort the whole list and
      // get misreported upstream as a "network error".
      const status = reservation.status || 'Unknown';
      let statusColor = 'bg-gray-100 text-gray-700';
      let statusText = status.toUpperCase();
      if (reservation.status === 'Approved') statusColor = 'bg-green-100 text-green-700';
      else if (reservation.status === 'Pending') statusColor = 'bg-yellow-100 text-yellow-700';
      else if (reservation.status === 'Cancelled' || reservation.status === 'Rejected') statusColor = 'bg-red-100 text-red-700';

      let moveStatusBadge = '';
      if (reservation.move_status === 'Pending' && reservation.move_reason) {
        // Staff proposed this move (an urgent override request needs the slot);
        // the holder didn't ask for it, so say what and why.
        const to = reservation.move_requested_start_time
          ? ` to ${formatDate(reservation.move_requested_start_time).month} ${formatDate(reservation.move_requested_start_time).day}, ${formatTime(reservation.move_requested_start_time)} – ${formatTime(reservation.move_requested_end_time)}`
          : '';
        moveStatusBadge = `<div class="mt-2 text-xs font-medium text-violet-800 bg-violet-50 px-2.5 py-1.5 rounded-lg border border-violet-200/60">Staff have proposed moving this booking${escapeHtml(to)}: ${escapeHtml(reservation.move_reason)} Your booking stays as it is until staff confirm the move.</div>`;
      } else if (reservation.move_status === 'Pending') {
        moveStatusBadge = `<div class="mt-2 text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-200/60">Move Request Pending review.</div>`;
      } else if (reservation.move_status === 'Rejected' && reservation.move_comment) {
        moveStatusBadge = `<div class="mt-2 text-xs font-medium text-red-700 bg-red-50 px-2.5 py-1.5 rounded-lg border border-red-200/60">Move Request Rejected: ${escapeHtml(reservation.move_comment)}</div>`;
      }

      if (reservation.cancel_status === 'Pending') {
        moveStatusBadge += `<div class="mt-2 text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-200/60">Cancellation Request pending review. Your booking stands until decided.</div>`;
      } else if (reservation.cancel_status === 'Rejected' && reservation.cancel_comment) {
        moveStatusBadge += `<div class="mt-2 text-xs font-medium text-red-700 bg-red-50 px-2.5 py-1.5 rounded-lg border border-red-200/60">Cancellation Request Rejected: ${escapeHtml(reservation.cancel_comment)}</div>`;
      }

      const action = buildActions(reservation);

      let filterStatus = reservation.status.toLowerCase();
      if (isPast && reservation.status !== 'Rejected' && reservation.status !== 'Cancelled') {
        filterStatus = 'history';
      }

      let dateBlockHtml = '';
      let extraInfoHtml = '';

      if (reservation.is_multi_day && reservation.datesObj && reservation.datesObj.length > 0) {
        const first = reservation.datesObj[0];
        const last = reservation.datesObj[reservation.datesObj.length - 1];
        const monthFirst = first.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();

        let displayType = reservation.is_consecutive ? 'Multiple Days — Consecutive Range' : 'Multiple Days — Specific Days';

        let datesText = '';
        if (reservation.is_consecutive) {
          const mFirst = first.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
          const mLast = last.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
          const yFirst = first.getFullYear();
          const yLast = last.getFullYear();

          if (yFirst !== yLast) {
            datesText = `${mFirst} ${first.getDate()}, ${yFirst} – ${mLast} ${last.getDate()}, ${yLast}`;
          } else if (mFirst !== mLast) {
            datesText = `${mFirst} ${first.getDate()} – ${mLast} ${last.getDate()}, ${yFirst}`;
          } else {
            datesText = `${mFirst} ${first.getDate()}–${last.getDate()}, ${yFirst}`;
          }
        } else {
          datesText = reservation.datesObj.map(d => `${d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()} ${d.getDate()}`).join(', ') + `, ${first.getFullYear()}`;
        }

        let topHeader = `${monthFirst} ${first.getFullYear()}`;
        let mainContent = '';

        if (reservation.is_consecutive) {
          const mFirst = first.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
          const mLast = last.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
          const yFirst = first.getFullYear();
          const yLast = last.getFullYear();

          if (yFirst !== yLast) {
            topHeader = 'MULTI-DAY';
            mainContent = `${mFirst} ${first.getDate()}<br>–<br>${mLast} ${last.getDate()}`;
          } else if (mFirst !== mLast) {
            topHeader = `${yFirst}`;
            mainContent = `${mFirst} ${first.getDate()}<br>–<br>${mLast} ${last.getDate()}`;
          } else {
            topHeader = `${mFirst} ${yFirst}`;
            mainContent = `${first.getDate()}–${last.getDate()}`;
          }
        } else {
          const mFirst = first.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
          const mLast = last.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();

          if (mFirst !== mLast || first.getFullYear() !== last.getFullYear()) {
            topHeader = 'MULTI-DAY';
            mainContent = reservation.datesObj.length + '<br><span class="text-[10px] font-normal text-gray-500 uppercase tracking-widest">Days</span>';
          } else {
            topHeader = `${mFirst} ${first.getFullYear()}`;
            mainContent = reservation.datesObj.map(d => d.getDate()).join(', ');
          }
        }

        dateBlockHtml = `
          <!-- Date block: MULTI-DAY -->
          <div class="border border-gray-200 rounded-lg overflow-hidden text-center min-w-[76px] shrink-0 flex flex-col bg-white">
            <div class="bg-[#7a1f2b] text-white text-[9px] font-bold py-1 px-1 uppercase tracking-widest whitespace-nowrap">${topHeader}</div>
            <div class="text-[15px] font-bold text-gray-900 py-2 px-1 leading-tight flex items-center justify-center flex-1">${mainContent}</div>
          </div>
        `;

        let datesTextHtml = '';
        if (reservation.series_rows.some(r => r.status !== reservation.status)) {
          // Display specific dates with their statuses if they differ
          datesTextHtml = reservation.series_rows.map(r => {
            const d = parseDate(r.start_time);
            const statusColor = r.status === 'Pending' ? 'text-yellow-600' : (r.status === 'Approved' ? 'text-green-600' : 'text-gray-600');
            return `<span class="${statusColor}">${d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()} ${d.getDate()} (${r.status})</span>`;
          }).join(', ') + `, ${first.getFullYear()}`;
        } else {
          datesTextHtml = escapeHtml(datesText);
        }

        extraInfoHtml = `
              <span class="text-gray-300 select-none">&bull;</span>
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-[15px] text-gray-400">calendar_month</span>
                <span>${datesTextHtml}</span>
              </span>
              <span class="text-gray-300 select-none">&bull;</span>
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-[15px] text-gray-400">style</span>
                <span>${escapeHtml(displayType)}</span>
              </span>
        `;
      } else {
        dateBlockHtml = `
          <!-- Date block: month + year on same header line, large day below -->
          <div class="border border-gray-200 rounded-lg overflow-hidden text-center min-w-[68px] shrink-0 flex flex-col bg-white">
            <div class="bg-[#7a1f2b] text-white text-[9px] font-bold py-1 px-1 uppercase tracking-widest whitespace-nowrap">${date.month} ${date.year}</div>
            <div class="text-2xl font-bold text-gray-900 py-2 leading-none">${date.day}</div>
          </div>
        `;
      }

      return `<div data-status="${escapeHtml(filterStatus)}" class="reservation-card bg-white px-5 py-4 rounded-xl border border-gray-200 shadow-sm mb-3 transition-all hover:border-gray-300 hover:shadow">
          <div class="flex items-center gap-5">
  
            ${dateBlockHtml}

          <!-- Main info -->
          <div class="flex flex-col flex-1 min-w-0">

            <!-- Title row: Detailed Purpose Description + ref badge + status badge -->
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="text-base font-bold text-gray-900 leading-tight">${escapeHtml(reservation.purpose)}</h3>
              <span class="text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-mono tracking-wide shrink-0">#RES-${escapeHtml(reservation.reservation_id).substring(0, 8).toUpperCase()}</span>
              <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded shrink-0 ${statusColor}">${statusText}</span>
            </div>

            <!-- Subtitle row: Selected Facility • Classification • Time -->
            <div class="flex items-center gap-3 text-sm text-gray-500 mt-1 flex-wrap">
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-[15px] text-gray-400">location_on</span>
                <span class="font-medium text-gray-700">${escapeHtml(reservation.room_name || reservation.room_id)}</span>
              </span>
              ${reservation.category ? `
              <span class="text-gray-300 select-none">•</span>
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-[15px] text-gray-400">supervisor_account</span>
                <span>${escapeHtml(reservation.category)}</span>
              </span>` : ''}
              <span class="text-gray-300 select-none">•</span>
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-[15px] text-gray-400">schedule</span>
                <span>${formatTime(reservation.start_time)} – ${formatTime(reservation.end_time)}</span>
                </span>
                ${extraInfoHtml}
            </div>

            ${moveStatusBadge}
          </div>

          <!-- Action buttons -->
          <div class="flex items-center gap-2 shrink-0 self-center ml-2">
            ${action}
          </div>

        </div>
      </div>`;
    }).join('');

    if (reservationListEmpty) {
      reservationListEmpty.classList.toggle('hidden', allReservations.length > 0);
    }
  }


  // ---------------------------------------------------------------
  // Action handlers (Section 10 step 5: one delegated listener,
  // bound once, instead of re-binding per-element on every render)
  // ---------------------------------------------------------------

  function permitRef(id) {
    return 'REQ-' + String(id).substring(0, 8).toUpperCase();
  }

  /**
   * "Remove" clears the booking out of this list. For something still Pending
   * that also withdraws the request and frees the room, so the wording has to
   * say which of the two is happening.
   */
  function openRemoveModal(id) {
    const reservation = allReservations.find(r => r.reservation_id === id);
    if (!reservation) return;
    currentTargetReservationId = id;

    const ref = permitRef(id);
    const isPending = reservation.status === 'Pending';
    if (removeModalTitle) {
      removeModalTitle.textContent = isPending ? 'Cancel this request?' : 'Remove this booking?';
    }
    if (removeModalText) {
      removeModalText.textContent = isPending
        ? `${ref} is still awaiting review. Cancelling it withdraws the request and immediately frees ${reservation.room_name || 'the room'}. It will be preserved in the system archive for 30 days before permanent deletion.`
        : `${ref} will be cleared from your active list and preserved in the system archive for 30 days before permanent deletion. Staff keep the record, and you can still re-book the space.`;
    }
    if (modalConfirm) modalConfirm.textContent = isPending ? 'Cancel' : 'Remove';
    if (modal) modal.classList.remove('hidden');
  }

  function openCancelRequestModal(id) {
    const reservation = allReservations.find(r => r.reservation_id === id);
    if (!reservation) return;

    // The button is already disabled in these cases; this covers a stale card.
    const blocked = cancelRequestBlockedReason(reservation);
    if (blocked) {
      showToast(blocked, 'error');
      return;
    }

    currentTargetReservationId = id;
    if (cancelReqPermit) cancelReqPermit.textContent = permitRef(id);
    if (cancelReqReason) cancelReqReason.value = '';
    if (cancelReqError) cancelReqError.classList.add('hidden');
    if (cancelReqModal) cancelReqModal.classList.remove('hidden');
    if (cancelReqReason) cancelReqReason.focus();
  }

  let moveCalendarInstance = null;

  function openMoveModal(id) {
    currentTargetReservationId = id;
    const moveModalOverlay = document.getElementById('moveModalOverlay');
    const moveErrorMsg = document.getElementById('moveErrorMsg');
    const moveDateInput = document.getElementById('moveDate');
    if (moveErrorMsg) moveErrorMsg.classList.add('hidden');
    // Can't pick a date before today at all; native browser UI enforces this.
    if (moveDateInput) moveDateInput.min = todayYMD();
    refreshMoveTimeOptions();
    if (moveModalOverlay) {
      moveModalOverlay.classList.remove('opacity-0', 'pointer-events-none');
    }
  }

  // Confirmation slip (Section 12), log archive (Section 13) and re-book
  // (Section 14) are all shared components.
  function openSlipModal(id) {
    window.CampusRoomSlip.open(id); // shared component, js/slip.js (Section 12)
  }

  // Section 14, Option A: hand off to the real booking form rather than
  // rebuilding it in a modal. book-room.html + booking.js already own the
  // room calendar, the collision banner and the validation messaging, and
  // booking.js posts to the rebook endpoint when ?rebook= is present.
  function openRebookModal(id) {
    window.CampusRoomRebook.start(id); // shared component, js/rebook.js (Section 14)
  }

  function openLogModal(id) {
    window.CampusRoomLogArchive.open(id); // shared component, js/logArchive.js (Section 13)
  }

  if (reservationList) {
    reservationList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.disabled) return;
      switch (btn.dataset.action) {
        case 'remove':
          openRemoveModal(id);
          break;
        case 'reqcancel':
          openCancelRequestModal(id);
          break;
        case 'move':
          openMoveModal(id);
          break;
        case 'slip':
          openSlipModal(id); // Section 12
          break;
        case 'rebook':
          openRebookModal(id); // Section 14
          break;
        case 'logs':
          openLogModal(id); // Section 13
          break;
      }
    });
  }

  if (newReservationBtn) {
    newReservationBtn.addEventListener('click', () => {
      window.location.href = 'rooms.html';
    });
  }

  // ---------------------------------------------------------------
  // CSV export
  // ---------------------------------------------------------------

  // Same quote-escaping helper staff-queue.js uses for its log export.
  function csvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  if (exportSlipBtn) {
    exportSlipBtn.addEventListener('click', () => {
      if (!allReservations.length) {
        showToast('No reservations to export yet.');
        return;
      }
      const rows = ['Permit,Venue,Category,Purpose,Start Time,End Time,Status'];
      allReservations.forEach(r => {
        rows.push([
          csvCell('REQ-' + String(r.reservation_id || '').substring(0, 8)),
          csvCell(r.room_name || r.room_id || ''),
          csvCell(r.category || ''),
          csvCell(r.purpose || ''),
          csvCell(r.start_time || ''),
          csvCell(r.end_time || ''),
          csvCell(r.status || '')
        ].join(','));
      });
      const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Reservations_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  // ---------------------------------------------------------------
  // Filtering / search
  // ---------------------------------------------------------------

  // Pagination State
  const ITEMS_PER_PAGE = 5;
  let currentPage = 1;
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  const pageIndicator = document.getElementById('pageIndicator');
  const resetResFilters = document.getElementById('resetResFilters');

  function applyFilters() {
    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();
    const cards = Array.from(document.querySelectorAll('.reservation-card'));

    let visibleCards = [];

    cards.forEach(card => {
      const cardStatus = (card.getAttribute('data-status') || '').toLowerCase();
      const text = card.textContent.toLowerCase();

      let matchesFilter = false;
      if (activeFilter === 'all') matchesFilter = true;
      else if (activeFilter === 'history' || activeFilter === 'past') {
        matchesFilter = ['history', 'past', 'completed', 'rejected', 'cancelled'].includes(cardStatus);
      } else {
        matchesFilter = (cardStatus === activeFilter);
      }

      const matchesSearch = !query || text.includes(query);

      if (matchesFilter && matchesSearch) {
        visibleCards.push(card);
      } else {
        card.classList.add('hidden');
        card.style.display = 'none';
      }
    });

    const totalPages = Math.max(1, Math.ceil(visibleCards.length / ITEMS_PER_PAGE));
    if (currentPage > totalPages) currentPage = totalPages;

    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;

    visibleCards.forEach((card, index) => {
      if (index >= startIndex && index < endIndex) {
        card.classList.remove('hidden');
        card.style.display = 'block';
      } else {
        card.classList.add('hidden');
        card.style.display = 'none';
      }
    });

    if (prevPageBtn) prevPageBtn.disabled = currentPage === 1;
    if (nextPageBtn) nextPageBtn.disabled = currentPage === totalPages;
    if (pageIndicator) pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;

    const countEl = document.getElementById('visibleResCount');
    if (countEl) countEl.textContent = visibleCards.length;

    if (reservationListEmpty) {
      reservationListEmpty.classList.toggle('hidden', visibleCards.length > 0);
    }
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => {
        t.classList.remove('bg-white', 'shadow-sm', 'text-gray-800', 'font-semibold');
        t.classList.add('text-gray-500', 'hover:text-gray-700', 'font-medium');
      });
      tab.classList.remove('text-gray-500', 'hover:text-gray-700', 'font-medium');
      tab.classList.add('bg-white', 'shadow-sm', 'text-gray-800', 'font-semibold');

      activeFilter = tab.getAttribute('data-filter') || 'all';
      currentPage = 1;
      applyFilters();
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      currentPage = 1;
      applyFilters();
    });
  }

  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        applyFilters();
      }
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
      currentPage++;
      applyFilters();
    });
  }

  if (resetResFilters) {
    resetResFilters.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      activeFilter = 'all';
      tabs.forEach(t => {
        t.classList.remove('bg-white', 'shadow-sm', 'text-gray-800', 'font-semibold');
        t.classList.add('text-gray-500', 'hover:text-gray-700', 'font-medium');
      });
      const allTab = Array.from(tabs).find(t => t.getAttribute('data-filter') === 'all');
      if (allTab) {
        allTab.classList.remove('text-gray-500', 'hover:text-gray-700', 'font-medium');
        allTab.classList.add('bg-white', 'shadow-sm', 'text-gray-800', 'font-semibold');
      }
      currentPage = 1;
      applyFilters();
    });
  }

  // View-toggle (list / grid)
  const btnViewList = document.getElementById('btn-view-list');
  const btnViewGrid = document.getElementById('btn-view-grid');

  function setViewMode(mode) {
    if (!reservationList) return;
    if (mode === 'grid') {
      reservationList.className = 'grid grid-cols-1 xl:grid-cols-2 gap-4';
      btnViewGrid?.classList.add('bg-white', 'shadow-xs', 'text-[#7a1f2b]');
      btnViewGrid?.classList.remove('text-gray-400', 'hover:text-gray-700');
      btnViewList?.classList.remove('bg-white', 'shadow-xs', 'text-[#7a1f2b]');
      btnViewList?.classList.add('text-gray-400', 'hover:text-gray-700');
    } else {
      reservationList.className = 'flex flex-col gap-4';
      btnViewList?.classList.add('bg-white', 'shadow-xs', 'text-[#7a1f2b]');
      btnViewList?.classList.remove('text-gray-400', 'hover:text-gray-700');
      btnViewGrid?.classList.remove('bg-white', 'shadow-xs', 'text-[#7a1f2b]');
      btnViewGrid?.classList.add('text-gray-400', 'hover:text-gray-700');
    }
  }

  if (btnViewList) btnViewList.addEventListener('click', () => setViewMode('list'));
  if (btnViewGrid) btnViewGrid.addEventListener('click', () => setViewMode('grid'));

  // ---------------------------------------------------------------
  // Cancel modal
  // ---------------------------------------------------------------

  function closeModal() {
    if (modal) modal.classList.add('hidden');
    if (cancelReqModal) cancelReqModal.classList.add('hidden');
    currentTargetReservationId = null;

    const moveModalOverlay = document.getElementById('moveModalOverlay');
    if (moveModalOverlay) moveModalOverlay.classList.add('opacity-0', 'pointer-events-none');
    const moveForm = document.getElementById('moveForm');
    if (moveForm) moveForm.reset();
  }

  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modalDismiss) modalDismiss.addEventListener('click', closeModal);

  const moveModalCloseIcon = document.getElementById('moveModalCloseIcon');
  if (moveModalCloseIcon) moveModalCloseIcon.addEventListener('click', closeModal);
  const moveModalCancelBtn = document.getElementById('moveModalCancelBtn');
  if (moveModalCancelBtn) moveModalCancelBtn.addEventListener('click', closeModal);

  const moveForm = document.getElementById('moveForm');

  /**
   * Why the requested move can't work, or '' if it can (or can't be checked).
   * The new start..end must be free for its WHOLE length â€” no class, holiday or
   * other reservation may touch any part of it. The reservation being moved is
   * ignored, so sliding it 30 minutes doesn't "conflict" with its own old slot.
   * Convenience only; the server re-validates on submit and again on approval.
   */
  async function moveRangeProblem() {
    const date = document.getElementById('moveDate').value;
    const start = document.getElementById('moveStartTime').value;
    const end = document.getElementById('moveEndTime').value;
    if (!date || !start || !end) return '';
    if (end <= start) return 'End time must be after start time.';

    const target = allReservations.find(r => r.reservation_id === currentTargetReservationId);
    if (!target || !window.CampusSchedule) return '';

    const data = await window.CampusSchedule.fetchDay(BASE, target.room_id, date);
    if (!data) return '';   // can't pre-check; the server will
    const clash = window.CampusSchedule.findConflicts(
      data, date, start, end, { excludeReservationId: target.reservation_id }
    );
    return window.CampusSchedule.describe(clash, start, end);
  }

  function showMoveError(message) {
    const moveErrorMsg = document.getElementById('moveErrorMsg');
    if (!moveErrorMsg) return;
    moveErrorMsg.textContent = message;
    moveErrorMsg.classList.toggle('hidden', !message);
  }

  if (moveForm) {
    // Warn as soon as the range stops fitting, not only on submit. The
    // sequence guard drops answers that arrive after a newer edit.
    let moveCheckSeq = 0;

    const moveStartTimeSelect = document.getElementById('moveStartTime');
    const moveEndTimeSelect = document.getElementById('moveEndTime');

    if (moveStartTimeSelect && moveEndTimeSelect) {
      const ALL_END_OPTIONS = Array.from(moveEndTimeSelect.options)
        .filter(o => o.value)
        .map(o => ({ value: o.value, text: o.textContent }));

      const syncMoveEndOptions = () => {
        const start = moveStartTimeSelect.value;
        const previous = moveEndTimeSelect.value;

        moveEndTimeSelect.innerHTML = '<option value="">End time</option>';
        ALL_END_OPTIONS.forEach(o => {
          const opt = document.createElement('option');
          opt.value = o.value;
          opt.textContent = o.text;

          if (start && o.value <= start) {
            opt.disabled = true;
            opt.hidden = true; // hide/disable before or equal
          }
          moveEndTimeSelect.appendChild(opt);
        });

        if (previous && previous > start) {
          moveEndTimeSelect.value = previous;
        }
      };

      moveStartTimeSelect.addEventListener('change', syncMoveEndOptions);
      // Run once
      syncMoveEndOptions();
    }

    ['moveDate', 'moveStartTime', 'moveEndTime'].forEach(id => {

      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener('change', async () => {
        if (moveCalendarInstance) {
          if (id === 'moveDate') {
            moveCalendarInstance.goToDate(document.getElementById('moveDate').value);
          }
          moveCalendarInstance.setSelectionTimes(
            document.getElementById('moveStartTime').value,
            document.getElementById('moveEndTime').value
          );
        }

        const seq = ++moveCheckSeq;
        const problem = await moveRangeProblem();
        if (seq === moveCheckSeq) showMoveError(problem);
      });
    });

    const moveSubmitBtn = moveForm.querySelector('button[type="submit"]');

    moveForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      console.log('[Move] submit clicked'); // remove once confirmed fixed

      const moveDate = document.getElementById('moveDate').value;
      const moveStartTime = document.getElementById('moveStartTime').value;
      const moveEndTime = document.getElementById('moveEndTime').value;
      const moveErrorMsg = document.getElementById('moveErrorMsg');

      // Previously a bare `return` here - with the form's `novalidate`
      // attribute disabling native "please fill this field" prompts, a
      // missing field made the button look completely dead. Now it says why.
      if (!currentTargetReservationId) {
        showMoveError('No reservation selected. Please close and reopen this dialog.');
        return;
      }
      if (!moveDate || !moveStartTime || !moveEndTime) {
        showMoveError('Please choose a date, start time and end time.');
        return;
      }

      // Visible feedback the instant the click registers, so a slow
      // pre-check or request never again looks like a dead button.
      if (moveSubmitBtn) {
        moveSubmitBtn.disabled = true;
        moveSubmitBtn.textContent = 'Checking availability…';
      }

      try {
        moveCheckSeq++;   // any in-flight live check is now stale

        // moveRangeProblem() calls out to the room-calendar endpoint with no
        // timeout of its own; race it so a hung request can't leave the
        // button stuck forever with no explanation.
        const timeout = new Promise(resolve => setTimeout(() => resolve(undefined), 8000));
        const rangeProblem = await Promise.race([moveRangeProblem(), timeout]);
        if (rangeProblem === undefined) {
          console.warn('[Move] availability pre-check timed out; submitting anyway, server will validate.');
        } else if (rangeProblem) {
          showMoveError(rangeProblem);
          return;
        }

        // Same shape booking.js sends. (The server accepts either; 'T' is used
        // because new Date() parses it in every browser, the space form is not.)
        const requestedStart = `${moveDate}T${moveStartTime}:00`;
        const requestedEnd = `${moveDate}T${moveEndTime}:00`;

        if (moveSubmitBtn) moveSubmitBtn.textContent = 'Submitting…';

        const res = await fetch(`${BASE}api/reservations/${currentTargetReservationId}/move-request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requested_start_time: requestedStart,
            requested_end_time: requestedEnd
          })
        });
        const json = await res.json();

        if (json.success) {
          fetchReservations(); // reload to show pending badge
          closeModal();
        } else {
          moveErrorMsg.textContent = json.error || 'Failed to submit move request.';
          moveErrorMsg.classList.remove('hidden');
        }
      } catch (err) {
        console.error('[Move] submit failed:', err);
        moveErrorMsg.textContent = 'Network error.';
        moveErrorMsg.classList.remove('hidden');
      } finally {
        if (moveSubmitBtn) {
          moveSubmitBtn.disabled = false;
          moveSubmitBtn.textContent = 'Submit Move';
        }
      }
    });
  }

  // Remove = DELETE. The server soft-hides the row (and cancels it first if it
  // was still Pending), so nothing is destroyed.
  if (modalConfirm) {
    modalConfirm.addEventListener('click', () => {
      if (!currentTargetReservationId) {
        closeModal();
        return;
      }
      const wasPending = (allReservations.find(r => r.reservation_id === currentTargetReservationId) || {}).status === 'Pending';
      fetch(BASE + 'api/reservations/' + encodeURIComponent(currentTargetReservationId), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      })
        .then(res => res.json())
        .then(json => {
          if (json.success || json.removed) {
            showToast(wasPending ? 'Request cancelled and moved to archive (retained for 30 days).' : 'Booking moved to archive (retained for 30 days before permanent deletion).', 'success');
            fetchReservations(); // reload entirely
          } else {
            showToast(json.error || 'Failed to remove the booking.', 'error');
          }
        })
        .catch(err => {
          console.error(err);
          showToast('Network error.', 'error');
        })
        .finally(closeModal);
    });
  }

  // ---------------------------------------------------------------
  // Cancellation request (approved bookings)
  // ---------------------------------------------------------------

  if (cancelReqDismiss) cancelReqDismiss.addEventListener('click', closeModal);

  function showCancelReqError(message) {
    if (!cancelReqError) return;
    cancelReqError.textContent = message;
    cancelReqError.classList.toggle('hidden', !message);
  }

  if (cancelReqSubmit) {
    cancelReqSubmit.addEventListener('click', () => {
      if (!currentTargetReservationId) {
        closeModal();
        return;
      }
      const reason = cancelReqReason ? cancelReqReason.value.trim() : '';
      if (!reason) {
        showCancelReqError('Please give a reason so staff can decide.');
        if (cancelReqReason) cancelReqReason.focus();
        return;
      }

      cancelReqSubmit.disabled = true;
      const targetId = currentTargetReservationId;
      const target = allReservations.find(r => r.reservation_id === currentTargetReservationId) || {};
      const ids = target.is_multi_day ? target.series_rows.map(r => r.reservation_id) : [currentTargetReservationId];

      Promise.all(ids.map(id => fetch(BASE + 'api/reservations/' + encodeURIComponent(id) + '/cancel-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      }).then(res => res.json())))
        .then(results => {
          const failed = results.find(json => !json.success);
          if (!failed) {
            closeModal();
            showToast('Cancellation request submitted. Your booking stands until staff review it.', 'success');
            fetchReservations();
          } else {
            showCancelReqError(failed.error || 'Could not submit the request.');
          }
        })
        .catch(err => {
          console.error(err);
          showCancelReqError('Network error. Please try again.');
        })
        .finally(() => { cancelReqSubmit.disabled = false; });
    });
  }

  fetchReservations();
});






