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

  const tabs = document.querySelectorAll('.filter-tab');
  const reservationList = document.getElementById('reservationList');
  const reservationListEmpty = document.getElementById('reservationListEmpty');
  const reservationListError = document.getElementById('reservationListError');
  const reservationListErrorText = document.getElementById('reservationListErrorText');
  const reservationListRetry = document.getElementById('reservationListRetry');
  const searchInput = document.getElementById('reservationSearch');
  const modal = document.getElementById('cancelModal');
  const modalPermitCode = document.getElementById('modalPermitCode');
  const cancelReasonInput = document.getElementById('cancelReasonInput');
  const modalClose = document.getElementById('modalCloseBtn');
  const modalDismiss = document.getElementById('modalDismissBtn');
  const modalConfirm = document.getElementById('modalConfirmBtn');
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
    move:   'px-space-md py-space-sm bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-label-sm text-label-sm font-semibold rounded transition-colors flex items-center gap-1 shadow-sm',
    slip:   'px-space-md py-space-sm bg-surface-container hover:bg-surface-container-high text-on-surface font-label-sm text-label-sm font-semibold rounded transition-colors flex items-center gap-1',
    rebook: 'px-space-md py-space-sm bg-secondary-container hover:bg-secondary-fixed text-on-secondary-fixed font-label-sm text-label-sm font-semibold rounded transition-colors flex items-center gap-1 shadow-sm',
    logs:   'px-space-md py-space-sm bg-surface-container hover:bg-surface-container-high text-on-surface font-label-sm text-label-sm font-semibold rounded transition-colors flex items-center gap-1'
  };
  const ACTION_ICONS = { cancel: 'cancel', move: 'edit_calendar', slip: 'receipt_long', rebook: 'sync', logs: 'folder_open' };

  function actionButton(action, id, label) {
    return `<button class="${ACTION_STYLES[action]}" data-action="${action}" data-id="${escapeHtml(id)}"><span class="material-symbols-outlined text-[16px]">${ACTION_ICONS[action]}</span><span>${label}</span></button>`;
  }

  // Table from the plan (Section 10, step 4): which buttons show per status.
  function buildActions(reservation) {
    const id = reservation.reservation_id;
    const canMove = reservation.move_status !== 'Pending';
    const buttons = [];

    switch (reservation.status) {
      case 'Pending':
        buttons.push(actionButton('cancel', id, 'Cancel Booking'));
        if (canMove) buttons.push(actionButton('move', id, 'Request to Move'));
        buttons.push(actionButton('logs', id, 'View Log Archive'));
        break;
      case 'Approved':
        buttons.push(actionButton('slip', id, 'View Confirmation Slip'));
        buttons.push(actionButton('cancel', id, 'Cancel Booking'));
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

  function openCancelModal(id) {
    currentTargetReservationId = id;
    if (modalPermitCode) modalPermitCode.textContent = 'REQ-' + String(id).substring(0, 8);
    if (cancelReasonInput) cancelReasonInput.value = '';
    if (modal) modal.classList.remove('hidden');
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
      switch (btn.dataset.action) {
        case 'cancel':
          openCancelModal(id);
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
      const rows = ['Permit,Venue,Purpose,Start Time,End Time,Status'];
      allReservations.forEach(r => {
        rows.push([
          csvCell('REQ-' + String(r.reservation_id || '').substring(0, 8)),
          csvCell(r.room_name || r.room_id || ''),
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
  if (moveForm) {
    moveForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const moveDate = document.getElementById('moveDate').value;
      const moveStartTime = document.getElementById('moveStartTime').value;
      const moveEndTime = document.getElementById('moveEndTime').value;
      const moveErrorMsg = document.getElementById('moveErrorMsg');

      if (!currentTargetReservationId || !moveDate || !moveStartTime || !moveEndTime) return;

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

  if (modalConfirm) {
    modalConfirm.addEventListener('click', () => {
      if (!currentTargetReservationId) {
        closeModal();
        return;
      }
      const reason = cancelReasonInput ? cancelReasonInput.value.trim() : '';
      fetch(BASE + 'api/reservations/' + currentTargetReservationId + '/cancel', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      })
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          showToast('Reservation cancelled.', 'success');
          fetchReservations(); // reload entirely
        } else {
          showToast(json.error || 'Failed to cancel reservation.', 'error');
        }
      })
      .catch(err => {
        console.error(err);
        showToast('Network error.', 'error');
      })
      .finally(closeModal);
    });
  }

  fetchReservations();
});
