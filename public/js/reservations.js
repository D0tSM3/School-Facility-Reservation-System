document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // Shared helper (js/util.js). Declared up here so nothing can call it before it exists.
  const { escapeHtml } = window.CampusRoomUtil;

  let canViewAllReservations = false;

  // Customers see their own history. Staff/Admin see the complete reservation
  // register, but their cards are rendered without customer actions.
  const sessionReady = (function loadReservationAccess() {
    const BASE = window.location.pathname.replace(/[^\/]*$/, '');
    return fetch(BASE + 'api/auth/me', { credentials: 'include' })
      .then(res => res.json())
      .then(json => {
        const currentUser = json.success ? json.data : null;
        const role = String(currentUser && currentUser.role || '').toLowerCase();
        canViewAllReservations = role === 'staff' || role === 'admin';
        if (!currentUser) window.location.href = 'index.html';
      })
      .catch(err => console.error('Error checking session role:', err));
  })();

  const tabs = document.querySelectorAll('.filter-tab');
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
  let activeFilter = 'all';
  let allReservations = [];

  const BASE = window.location.pathname.replace(/[^\/]*$/, '');

  // ---------------------------------------------------------------
  // Fetching: loading / success / empty / error states
  // ---------------------------------------------------------------

  function skeletonCardHtml() {
    return `<div class="reservation-card bg-surface-container-lowest p-space-md rounded shadow-sm relative overflow-hidden animate-pulse">
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
    const endpoint = canViewAllReservations ? 'api/reservations' : 'api/reservations/mine';
    fetch(BASE + endpoint, { credentials: 'same-origin' })
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
      ? { month: '---', day: '--' }
      : {
          month: date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
          day: date.toLocaleDateString('en-US', { day: '2-digit' })
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
    cancel: 'px-space-md py-space-sm bg-[#DC2626] hover:bg-[#B91C1C] text-[#FFFFFF] font-label-sm text-label-sm font-semibold rounded transition-colors flex items-center gap-1 shadow-sm',
    remove: 'px-space-md py-space-sm bg-[#DC2626] hover:bg-[#B91C1C] text-[#FFFFFF] font-label-sm text-label-sm font-semibold rounded transition-colors flex items-center gap-1 shadow-sm',
    reqcancel: 'px-space-md py-space-sm bg-[#DC2626] hover:bg-[#B91C1C] text-[#FFFFFF] font-label-sm text-label-sm font-semibold rounded transition-colors flex items-center gap-1 shadow-sm',
    move:   'px-space-md py-space-sm bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-label-sm text-label-sm font-semibold rounded transition-colors flex items-center gap-1 shadow-sm',
    slip:   'px-space-md py-space-sm bg-surface-container hover:bg-surface-container-high text-on-surface font-label-sm text-label-sm font-semibold rounded transition-colors flex items-center gap-1',
    rebook: 'px-space-md py-space-sm bg-secondary-container hover:bg-secondary-fixed text-on-secondary-fixed font-label-sm text-label-sm font-semibold rounded transition-colors flex items-center gap-1 shadow-sm',
    logs:   'px-space-md py-space-sm bg-surface-container hover:bg-surface-container-high text-on-surface font-label-sm text-label-sm font-semibold rounded transition-colors flex items-center gap-1'
  };
  const ACTION_ICONS = {
    cancel: 'cancel', move: 'edit_calendar', slip: 'receipt_long', rebook: 'sync', logs: 'folder_open',
    remove: 'delete_sweep', reqcancel: 'assignment_return'
  };

  function actionButton(action, id, label, disabledReason) {
    const off = disabledReason
      ? ` disabled title="${escapeHtml(disabledReason)}" class="${ACTION_STYLES[action]} opacity-50 cursor-not-allowed"`
      : ` class="${ACTION_STYLES[action]}"`;
    return `<button${off} data-action="${action}" data-id="${escapeHtml(id)}"><span class="material-symbols-outlined text-[16px]">${ACTION_ICONS[action]}</span><span>${label}</span></button>`;
  }

  /** Today as 'YYYY-MM-DD' in local time — never via toISOString(), which is UTC. */
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
    if (canViewAllReservations) {
      const buttons = [];
      if (reservation.status === 'Approved' || reservation.status === 'Completed') {
        buttons.push(actionButton('slip', id, 'View Confirmation Slip'));
      }
      buttons.push(actionButton('logs', id, 'View Log Archive'));
      return buttons.join('');
    }

    const canMove = reservation.move_status !== 'Pending';
    const buttons = [];

    switch (reservation.status) {
      case 'Pending':
        buttons.push(actionButton('remove', id, 'Remove Booking'));
        if (canMove) buttons.push(actionButton('move', id, 'Request to Move'));
        buttons.push(actionButton('logs', id, 'View Log Archive'));
        break;
      case 'Approved':
        buttons.push(actionButton('slip', id, 'View Confirmation Slip'));
        buttons.push(actionButton('reqcancel', id, 'Request Cancellation', cancelRequestBlockedReason(reservation)));
        if (canMove) buttons.push(actionButton('move', id, 'Request to Move'));
        buttons.push(actionButton('logs', id, 'View Log Archive'));
        break;
      case 'Completed':
        buttons.push(actionButton('slip', id, 'Archived Slip'));
        buttons.push(actionButton('rebook', id, 'Re-book Space'));
        buttons.push(actionButton('logs', id, 'View Log Archive'));
        break;
      case 'Rejected':
      case 'Cancelled':
        buttons.push(actionButton('rebook', id, 'Re-book Space'));
        buttons.push(actionButton('remove', id, 'Remove'));
        buttons.push(actionButton('logs', id, 'View Log Archive'));
        break;
      default:
        buttons.push(actionButton('logs', id, 'View Log Archive'));
    }
    return buttons.join('');
  }

  function renderReservations() {
    if (!reservationList) return;

    // No longer filters out Cancelled — every status renders, and the
    // existing 'history' tab filter (below) already accepts it.
    reservationList.innerHTML = allReservations.map(reservation => {
      const date = formatDate(reservation.start_time);
      const isPast = new Date(reservation.end_time) < new Date();

      const statusClass = reservation.status === 'Approved'
        ? 'bg-[#DCFCE7] text-[#15803D]'
        : reservation.status === 'Rejected' || reservation.status === 'Cancelled'
          ? 'bg-[#FEE2E2] text-[#B91C1C]'
          : reservation.status === 'Completed'
            ? 'bg-[#F1F5F9] text-[#475569]'
            : 'bg-[#FEF3C7] text-[#B45309]';
      const statusIcon = reservation.status === 'Approved'
        ? 'check_circle'
        : reservation.status === 'Rejected' || reservation.status === 'Cancelled'
          ? 'error'
          : reservation.status === 'Completed'
            ? 'check_circle'
            : 'schedule';

      let moveStatusBadge = '';
      if (reservation.move_status === 'Pending') {
        moveStatusBadge = `<div class="mt-2 text-label-sm font-medium text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">Move Request Pending review.</div>`;
      } else if (reservation.move_status === 'Rejected' && reservation.move_comment) {
        moveStatusBadge = `<div class="mt-2 text-label-sm font-medium text-red-600 bg-red-50 px-2 py-1 rounded border border-red-200">Move Request Rejected: ${escapeHtml(reservation.move_comment)}</div>`;
      }

      // Cancellation request state. Approved is deliberately not shown: the
      // booking itself has already flipped to Cancelled, which the status
      // chip says more clearly than a second badge would.
      if (reservation.cancel_status === 'Pending') {
        moveStatusBadge += `<div class="mt-2 text-label-sm font-medium text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">Cancellation Request pending review. This booking still stands until staff decide.</div>`;
      } else if (reservation.cancel_status === 'Rejected' && reservation.cancel_comment) {
        moveStatusBadge += `<div class="mt-2 text-label-sm font-medium text-red-600 bg-red-50 px-2 py-1 rounded border border-red-200">Cancellation Request Rejected: ${escapeHtml(reservation.cancel_comment)}</div>`;
      }

      const action = buildActions(reservation);

      let filterStatus = reservation.status.toLowerCase();
      if (isPast && reservation.status !== 'Rejected' && reservation.status !== 'Cancelled') {
        filterStatus = 'history';
      }

      return `<div data-status="${escapeHtml(filterStatus)}" class="reservation-card bg-surface-container-lowest p-space-md rounded shadow-sm relative overflow-hidden transition-all duration-150 hover:shadow-md">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-space-md">
          <div class="flex items-start gap-space-md">
            <div class="p-space-sm rounded bg-surface-container flex flex-col items-center justify-center min-w-[56px] text-center">
              <span class="font-label-sm text-label-sm text-secondary font-bold uppercase">${date.month}</span>
              <span class="font-headline-md text-headline-md text-on-surface font-bold leading-none">${date.day}</span>
            </div>
            <div class="flex flex-col space-y-space-xs">
              <div class="flex items-center gap-space-sm flex-wrap">
                <span class="font-label-md text-label-md text-primary font-bold">REQ-${escapeHtml(reservation.reservation_id).substring(0,8)}</span>
                <span class="px-2 py-0.5 rounded font-label-sm text-label-sm font-bold ${statusClass} flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">${statusIcon}</span>${escapeHtml(reservation.status)}</span>
                <span class="text-body-sm font-body-sm text-on-surface-variant flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">schedule</span>${formatTime(reservation.start_time)} - ${formatTime(reservation.end_time)}</span>
              </div>
              <div class="font-headline-sm text-headline-sm text-on-surface font-semibold">${escapeHtml(reservation.purpose)}</div>
              ${reservation.category ? `<div><span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant font-label-sm text-label-sm font-semibold"><span class="material-symbols-outlined text-[14px]">category</span>${escapeHtml(reservation.category)}</span></div>` : ''}
              <div class="flex items-center gap-space-md text-body-sm font-body-sm text-on-surface-variant flex-wrap">
                <span class="flex items-center gap-1 font-medium text-on-surface"><span class="material-symbols-outlined text-[16px] text-secondary">meeting_room</span>${escapeHtml(reservation.room_name || reservation.room_id)}</span>
              </div>
              ${moveStatusBadge}
            </div>
          </div>
          <div class="flex items-center gap-space-xs shrink-0 self-end md:self-center">${action}</div>
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
      removeModalTitle.textContent = isPending ? 'Withdraw this request?' : 'Remove this booking?';
    }
    if (removeModalText) {
      removeModalText.textContent = isPending
        ? `${ref} is still awaiting review. Removing it withdraws the request and immediately frees ${reservation.room_name || 'the room'} for other departments. Staff keep a record of it.`
        : `${ref} will be cleared from your list. Nothing is deleted — staff keep the record, and you can still re-book the space.`;
    }
    if (modalConfirm) modalConfirm.textContent = isPending ? 'Withdraw' : 'Remove';
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

  function openMoveModal(id) {
    currentTargetReservationId = id;
    const moveModalOverlay = document.getElementById('moveModalOverlay');
    const moveErrorMsg = document.getElementById('moveErrorMsg');
    if (moveErrorMsg) moveErrorMsg.classList.add('hidden');
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

  function applyFilters() {
    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();
    const cards = document.querySelectorAll('.reservation-card');

    cards.forEach(card => {
      const cardStatus = (card.getAttribute('data-status') || '').toLowerCase();
      const text = card.textContent.toLowerCase();

      let matchesFilter = false;
      if (activeFilter === 'all') matchesFilter = true;
      else if (activeFilter === 'history') {
        matchesFilter = ['history', 'completed', 'rejected', 'cancelled'].includes(cardStatus);
      } else {
        matchesFilter = (cardStatus === activeFilter);
      }

      const matchesSearch = !query || text.includes(query);

      if (matchesFilter && matchesSearch) {
        card.classList.remove('hidden');
        card.style.display = 'block';
      } else {
        card.classList.add('hidden');
        card.style.display = 'none';
      }
    });
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => {
        t.classList.remove('bg-primary', 'text-on-primary', 'font-semibold', 'shadow-sm');
        t.classList.add('text-on-surface-variant', 'hover:text-on-surface', 'hover:bg-surface-container');
      });
      tab.classList.add('bg-primary', 'text-on-primary', 'font-semibold', 'shadow-sm');
      tab.classList.remove('text-on-surface-variant', 'hover:text-on-surface', 'hover:bg-surface-container');

      activeFilter = tab.getAttribute('data-filter') || 'all';
      applyFilters();
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', applyFilters);
  }

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
   * The new start..end must be free for its WHOLE length — no class, holiday or
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
    ['moveDate', 'moveStartTime', 'moveEndTime'].forEach(id => {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener('change', async () => {
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
          showToast(wasPending ? 'Request withdrawn and the room released.' : 'Booking removed from your list.', 'success');
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

  sessionReady.then(fetchReservations);
});
