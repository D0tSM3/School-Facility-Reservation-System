document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // Shared helper (js/util.js). Declared up here so nothing can call it before it exists.
  const { escapeHtml } = window.CampusRoomUtil;

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
          window.location.replace(BASE + 'staff-queue.html');
        }
      })
      .catch(err => console.error('Error checking session role:', err));
  })();

  const tabs = document.querySelectorAll('.filter-btn');
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
  const urlParams = new URLSearchParams(window.location.search);
  let activeFilter = urlParams.get('filter') || 'all';
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
      .then(res => res.json().then(json => ({ status: res.status, json })))
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
        allReservations = json.data || [];
        renderReservations();
        applyFilters();
      })
      .catch(() => showListError('Network error. Check that the server is reachable.'))
      .finally(() => setLoading(false));
  }

  if (reservationListRetry) reservationListRetry.addEventListener('click', fetchReservations);

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? { month: '---', day: '--', year: '----' }
      : {
          month: date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
          day: date.toLocaleDateString('en-US', { day: '2-digit' }),
          year: date.getFullYear()
        };
  }

  function formatTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? 'Time unavailable'
      : date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  // Same Tailwind class strings the six hand-written cards used, so the
  // action buttons look identical to before now that they're generated.
  
  const ACTION_STYLES = {
    cancel:    'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-red-600 border border-gray-200 hover:bg-red-50 hover:border-red-200 hover:text-red-700 text-xs font-semibold rounded-lg transition-all shadow-sm',
    remove:    'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-800 text-xs font-semibold rounded-lg transition-all shadow-sm',
    reqcancel: 'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-red-600 border border-gray-200 hover:bg-red-50 hover:border-red-200 hover:text-red-700 text-xs font-semibold rounded-lg transition-all shadow-sm',
    move:      'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-blue-600 border border-gray-200 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 text-xs font-semibold rounded-lg transition-all shadow-sm',
    slip:      'inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#7a1f2b] text-white hover:bg-[#5e1821] border border-transparent text-xs font-semibold rounded-lg transition-all shadow-sm',
    rebook:    'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-emerald-600 border border-gray-200 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 text-xs font-semibold rounded-lg transition-all shadow-sm',
    logs:      'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-800 text-xs font-semibold rounded-lg transition-all shadow-sm'
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

  // Which buttons show per status. An approved booking is deliberately NOT
  // cancellable here: the room is committed, so it goes through a request.
  function buildActions(reservation) {
    const id = reservation.reservation_id;
    const canMove = reservation.move_status !== 'Pending';
    const buttons = [];
    const isPast = new Date(reservation.end_time) < new Date();

    switch (reservation.status) {
      case 'Pending':
        if (canMove) buttons.push(actionButton('move', id, 'Move'));
        buttons.push(actionButton('remove', id, 'Cancel'));
        break;
      case 'Approved':
        if (canMove) buttons.push(actionButton('move', id, 'Move'));
        buttons.push(actionButton('reqcancel', id, 'Cancel', 'Only staff can cancel an Approved reservation. Please contact the Registrar.'));
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

  function renderReservations() {
    if (!reservationList) return;

    // No longer filters out Cancelled â€” every status renders, and the
    // existing 'history' tab filter (below) already accepts it.
    reservationList.innerHTML = allReservations.map(reservation => {
      const date = formatDate(reservation.start_time);
      const isPast = new Date(reservation.end_time) < new Date();

      let statusColor = 'bg-gray-100 text-gray-700';
      let statusText = reservation.status.toUpperCase();
      if (reservation.status === 'Approved') statusColor = 'bg-green-100 text-green-700';
      else if (reservation.status === 'Pending') statusColor = 'bg-yellow-100 text-yellow-700';
      else if (reservation.status === 'Cancelled' || reservation.status === 'Rejected') statusColor = 'bg-red-100 text-red-700';

      let moveStatusBadge = '';
      if (reservation.move_status === 'Pending') {
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

      return `<div data-status="${escapeHtml(filterStatus)}" class="reservation-card bg-white px-5 py-4 rounded-xl border border-gray-200 shadow-sm mb-3 transition-all hover:border-gray-300 hover:shadow">
        <div class="flex items-center gap-5">

          <!-- Date block: month + year on same header line, large day below -->
          <div class="border border-gray-200 rounded-lg overflow-hidden text-center min-w-[68px] shrink-0 flex flex-col bg-white">
            <div class="bg-[#7a1f2b] text-white text-[9px] font-bold py-1 px-1 uppercase tracking-widest whitespace-nowrap">${date.month} ${date.year}</div>
            <div class="text-2xl font-bold text-gray-900 py-2 leading-none">${date.day}</div>
          </div>

          <!-- Main info -->
          <div class="flex flex-col flex-1 min-w-0">

            <!-- Title row: Detailed Purpose Description + ref badge + status badge -->
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="text-base font-bold text-gray-900 leading-tight">${escapeHtml(reservation.purpose)}</h3>
              <span class="text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-mono tracking-wide shrink-0">#RES-${escapeHtml(reservation.reservation_id).substring(0,8).toUpperCase()}</span>
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
        ? `${ref} is still awaiting review. Cancelling it withdraws the request and immediately frees ${reservation.room_name || 'the room'} for other departments. Staff keep a record of it.`
        : `${ref} will be cleared from your list. Nothing is deleted â€” staff keep the record, and you can still re-book the space.`;
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
    if (moveErrorMsg) moveErrorMsg.classList.add('hidden');
    if (moveModalOverlay) {
      moveModalOverlay.classList.remove('opacity-0', 'pointer-events-none');
    }

    const target = allReservations.find(r => r.reservation_id === id);
    if (target && typeof RoomCalendar !== 'undefined') {
      const initDate = String(target.start_time).slice(0, 10);
      const initStartTime = String(target.start_time).slice(11, 16);
      const initEndTime = String(target.end_time).slice(11, 16);

      const moveDate = document.getElementById('moveDate');
      const moveStartTime = document.getElementById('moveStartTime');
      const moveEndTime = document.getElementById('moveEndTime');

      if (moveDate) moveDate.value = initDate;
      if (moveStartTime) moveStartTime.value = initStartTime;
      if (moveEndTime) moveEndTime.value = initEndTime;

      if (moveCalendarInstance && moveCalendarInstance.roomId === target.room_id) {
        moveCalendarInstance.goToDate(initDate, true);
      } else {
        moveCalendarInstance = new RoomCalendar({
          containerId: 'move-room-calendar-container',
          roomId: target.room_id,
          initialDate: initDate
        });
      }
      
      moveCalendarInstance.setSelectionTimes(initStartTime, initEndTime);
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

    moveForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const moveDate = document.getElementById('moveDate').value;
      const moveStartTime = document.getElementById('moveStartTime').value;
      const moveEndTime = document.getElementById('moveEndTime').value;
      const moveErrorMsg = document.getElementById('moveErrorMsg');

      if (!currentTargetReservationId || !moveDate || !moveStartTime || !moveEndTime) return;

      moveCheckSeq++;   // any in-flight live check is now stale
      const rangeProblem = await moveRangeProblem();
      if (rangeProblem) {
        showMoveError(rangeProblem);
        return;
      }

      // Same shape booking.js sends. (The server accepts either; 'T' is used
      // because new Date() parses it in every browser, the space form is not.)
      const requestedStart = `${moveDate}T${moveStartTime}:00`;
      const requestedEnd = `${moveDate}T${moveEndTime}:00`;

      fetch(`${BASE}api/reservations/${currentTargetReservationId}/move-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requested_start_time: requestedStart,
          requested_end_time: requestedEnd
        })
      })
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          fetchReservations(); // reload to show pending badge
          closeModal();
        } else {
          moveErrorMsg.textContent = json.error || 'Failed to submit move request.';
          moveErrorMsg.classList.remove('hidden');
        }
      })
      .catch(err => {
        console.error(err);
        moveErrorMsg.textContent = 'Network error.';
        moveErrorMsg.classList.remove('hidden');
      });
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
        if (json.success) {
          showToast(wasPending ? 'Request cancelled and the room released.' : 'Booking removed from your list.', 'success');
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
      fetch(BASE + 'api/reservations/' + encodeURIComponent(targetId) + '/cancel-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      })
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          closeModal();
          showToast('Cancellation request submitted. Your booking stands until staff review it.', 'success');
          fetchReservations();
        } else {
          // 422s here are the real rules (day-of, duplicate request); show them
          // in the form rather than closing it out from under the customer.
          showCancelReqError(json.error || 'Could not submit the request.');
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



