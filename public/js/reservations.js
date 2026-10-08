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
  // type this URL directly, so bounce them to the Staff Dashboard instead.
  (function guardStaffAccess() {
    const BASE = window.location.pathname.replace(/[^\/]*$/, '');
    const sessionRequest = window.CampusRoomSession ||
      fetch(BASE + 'api/auth/me', { credentials: 'include' })
        .then(async response => ({ status: response.status, json: await response.json() }));
    sessionRequest
      .then(({ json }) => {
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

  // Cancel-booking confirmation (reason + final confirm, to stop misclicks).
  const cancelBkModal = document.getElementById('cancelBookingModal');
  const cancelBkPermit = document.getElementById('cancelBookingPermitCode');
  const cancelBkReason = document.getElementById('cancelBookingReason');
  const cancelBkError = document.getElementById('cancelBookingError');
  const cancelBkSubmit = document.getElementById('cancelBookingSubmit');
  const cancelBkDismiss = document.getElementById('cancelBookingDismiss');
  const cancelBkKeep = document.getElementById('cancelBookingKeep');

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
    Promise.all([
      fetch(BASE + 'api/reservations/mine', { credentials: 'same-origin' })
        .then(res => {
          if (res.status === 401) {
            window.location.href = 'index.html';
            return null;
          }
          return res.json().catch(() => {
            throw new Error('Server returned an unreadable (non-JSON) response.');
          });
        }),
      fetch(BASE + 'api/conflict-override-requests/mine', { credentials: 'same-origin' })
        .then(res => {
          if (res.status === 401) return null;
          return res.json().catch(() => ({ success: false, data: [] }));
        })
        .catch(() => ({ success: false, data: [] }))
    ])
      .then(([resJson, ovJson]) => {
        if (!resJson) return; // 401 redirecting
        if (!resJson.success) {
          showListError(resJson.error || 'Could not load your reservations.');
          return;
        }
        hideListStates();

        const reservations = groupBySeries(resJson.data || []);
        const overrides = (ovJson && ovJson.success && Array.isArray(ovJson.data)) ? ovJson.data : [];

        // Format active / pending Request Slips (Conflict Override Requests)
        // Booked ones are already converted to real reservations in `reservations`
        const overrideItems = overrides
          .filter(o => o.outcome !== 'Booked')
          .map(o => ({
            is_override: true,
            reservation_id: o.request_id,
            request_id: o.request_id,
            room_id: o.room_id,
            room_name: o.room_name,
            room_type: o.room_type,
            floor: o.floor,
            capacity: o.capacity,
            customer_name: o.customer_name,
            customer_email: o.customer_email,
            start_time: o.start_time,
            end_time: o.end_time,
            purpose: o.purpose,
            category: o.category,
            reason: o.reason,
            request_type: o.request_type || 'Schedule Conflict',
            alt_start_time: o.alt_start_time,
            alt_end_time: o.alt_end_time,
            additional_info: o.additional_info,
            equipment_notes: o.equipment_notes,
            status: o.status,
            staff_comment: o.staff_comment,
            outcome: o.outcome,
            outcome_note: o.outcome_note,
            created_at: o.created_at,
            is_multi_day: String(o.start_time).slice(0, 10) !== String(o.end_time).slice(0, 10),
            series_rows: []
          }));

        // Override items placed first so customer sees newly filed request slips at top
        allReservations = [...overrideItems, ...reservations];
        renderReservations();
        applyFilters();
      })
      .catch(err => {
        console.error('[My Reservations] failed to load:', err);
        const message = (err instanceof TypeError)
          ? 'Network error. Check that the server is reachable.'
          : `Could not load your reservations (${err.message}).`;
        showListError(message);
      })
      .finally(() => setLoading(false));
  }

  if (reservationListRetry) reservationListRetry.addEventListener('click', fetchReservations);

  function withdrawRequestSlip(id) {
    if (!confirm('Are you sure you want to cancel this Request Slip? This will cancel your conflict override request.')) {
      return;
    }
    fetch(BASE + 'api/conflict-override-requests/' + encodeURIComponent(id), {
      method: 'DELETE',
      credentials: 'same-origin'
    })
      .then(res => res.json())
      .then(json => {
        if (json && json.success) {
          showToast('Request Slip cancelled successfully.', 'success');
          fetchReservations();
        } else {
          showToast((json && json.error) || 'Could not cancel Request Slip.', 'error');
        }
      })
      .catch(() => {
        showToast('Network error while cancelling Request Slip.', 'error');
      });
  }

  // ---------------------------------------------------------------
  // View Request Slip Modal (Conformed to Confirmation Slip Design)
  // ---------------------------------------------------------------

  const requestSlipViewModal = document.getElementById('requestSlipViewModal');
  const closeRequestSlipViewBtn = document.getElementById('closeRequestSlipViewBtn');
  const closeRequestSlipViewFooterBtn = document.getElementById('closeRequestSlipViewFooterBtn');
  const rsvWithdrawBtn = document.getElementById('rsvWithdrawBtn');
  const rsvPrintBtn = document.getElementById('rsvPrintBtn');
  let rsvTitleBeforePrint = null;

  const SLIP_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

  function slipWallClock(value) {
    const m = SLIP_DATETIME_PATTERN.exec(String(value ?? ''));
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
  }

  function formatSlipDateTime(value) {
    const d = slipWallClock(value);
    return d ? d.toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZone: 'UTC'
    }) : '—';
  }

  function formatSlipTime(value) {
    const d = slipWallClock(value);
    return d ? d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) : '—';
  }

  function openRequestSlipViewModal(id) {
    const item = allReservations.find(r => r.is_override && (r.request_id === id || r.reservation_id === id));
    if (!item || !requestSlipViewModal) return;

    const rsvCodeBadge = document.getElementById('rsvCodeBadge');
    const rsvUuid = document.getElementById('rsvUuid');
    const rsvStatusChip = document.getElementById('rsvStatusChip');
    const rsvRequesterName = document.getElementById('rsvRequesterName');
    const rsvRequesterEmail = document.getElementById('rsvRequesterEmail');
    const rsvRoomName = document.getElementById('rsvRoomName');
    const rsvRoomDetails = document.getElementById('rsvRoomDetails');
    const rsvCategory = document.getElementById('rsvCategory');
    const rsvPurpose = document.getElementById('rsvPurpose');
    const rsvEquipment = document.getElementById('rsvEquipment');
    const rsvStarts = document.getElementById('rsvStarts');
    const rsvEnds = document.getElementById('rsvEnds');
    const rsvReason = document.getElementById('rsvReason');
    const rsvAltSchedule = document.getElementById('rsvAltSchedule');
    const rsvAdditionalRow = document.getElementById('rsvAdditionalRow');
    const rsvAdditional = document.getElementById('rsvAdditional');
    const rsvFiledOn = document.getElementById('rsvFiledOn');
    const rsvReviewStatus = document.getElementById('rsvReviewStatus');
    const rsvGeneratedTime = document.getElementById('rsvGeneratedTime');

    // Reference & UUID
    const code = '#REQ-SLIP-' + String(item.request_id || '').substring(0, 8).toUpperCase();
    if (rsvCodeBadge) rsvCodeBadge.textContent = code;
    if (rsvUuid) rsvUuid.textContent = item.request_id || '—';

    // Status Chip
    if (rsvStatusChip) {
      if (item.status === 'Pending') {
        rsvStatusChip.textContent = 'Under Review';
        rsvStatusChip.className = 'px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap bg-amber-100 text-amber-800';
      } else if (item.status === 'Approved') {
        rsvStatusChip.textContent = 'Approved (Awaiting Move)';
        rsvStatusChip.className = 'px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap bg-violet-100 text-violet-800';
      } else if (item.status === 'Rejected') {
        rsvStatusChip.textContent = 'Declined';
        rsvStatusChip.className = 'px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap bg-red-100 text-red-800';
      } else if (item.status === 'Cancelled') {
        rsvStatusChip.textContent = 'Cancelled';
        rsvStatusChip.className = 'px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap bg-gray-100 text-gray-700';
      } else {
        rsvStatusChip.textContent = item.status || 'Under Review';
        rsvStatusChip.className = 'px-2.5 py-1 rounded-full text-xs font-bold whitespace-nowrap bg-amber-100 text-amber-800';
      }
    }

    // Requester
    const requesterName = item.customer_name || (window.currentUser && window.currentUser.name) || '—';
    const requesterEmail = item.customer_email || (window.currentUser && window.currentUser.email) || '—';
    if (rsvRequesterName) rsvRequesterName.textContent = requesterName;
    if (rsvRequesterEmail) rsvRequesterEmail.textContent = requesterEmail;

    // Facility
    if (rsvRoomName) rsvRoomName.textContent = item.room_name || item.room_id || '—';
    if (rsvRoomDetails) {
      const parts = [];
      if (item.room_type) parts.push(item.room_type);
      if (item.floor != null) parts.push('Floor ' + item.floor);
      if (item.capacity) parts.push('Capacity ' + item.capacity);
      rsvRoomDetails.textContent = parts.join(' • ') || '—';
    }

    // Booking
    if (rsvCategory) rsvCategory.textContent = item.category || item.request_type || 'Academic / Institutional';
    if (rsvPurpose) rsvPurpose.textContent = item.purpose || 'Campus facility usage';
    if (rsvEquipment) rsvEquipment.textContent = item.equipment_notes || 'Standard Academic Setup';
    if (rsvStarts) rsvStarts.textContent = formatSlipDateTime(item.start_time);
    if (rsvEnds) rsvEnds.textContent = formatSlipDateTime(item.end_time);
    if (rsvReason) rsvReason.textContent = item.reason || 'No justification provided.';

    if (rsvAltSchedule) {
      if (item.alt_start_time) {
        rsvAltSchedule.textContent = `${formatSlipDateTime(item.alt_start_time)} – ${formatSlipTime(item.alt_end_time)}`;
      } else {
        rsvAltSchedule.textContent = 'None provided (Strictly requesting the original slot).';
      }
    }

    if (rsvAdditionalRow && rsvAdditional) {
      if (item.additional_info && String(item.additional_info).trim()) {
        rsvAdditional.textContent = String(item.additional_info).trim();
        rsvAdditionalRow.classList.remove('hidden');
      } else {
        rsvAdditionalRow.classList.add('hidden');
      }
    }

    // Record
    if (rsvFiledOn) rsvFiledOn.textContent = formatSlipDateTime(item.created_at);
    if (rsvReviewStatus) {
      if (item.status === 'Pending') {
        rsvReviewStatus.textContent = 'Under Review by Campus Staff (Evaluating relocation / reschedule)';
      } else if (item.status === 'Approved') {
        rsvReviewStatus.textContent = 'Approved by Campus Staff (Conflicting reservation rescheduled)';
      } else if (item.status === 'Rejected') {
        rsvReviewStatus.textContent = 'Declined' + (item.staff_comment ? ` — Note: ${item.staff_comment}` : '');
      } else if (item.status === 'Cancelled') {
        rsvReviewStatus.textContent = 'Cancelled by Requester';
      } else {
        rsvReviewStatus.textContent = item.status || '—';
      }
    }

    // Generated Time (Manila wall-clock)
    if (rsvGeneratedTime) {
      rsvGeneratedTime.textContent = new Date().toLocaleString('en-US', {
        timeZone: 'Asia/Manila',
        year: 'numeric', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
      });
    }

    // Action button in footer
    if (rsvWithdrawBtn) {
      if (item.status === 'Pending') {
        rsvWithdrawBtn.classList.remove('hidden');
        rsvWithdrawBtn.onclick = () => {
          closeRequestSlipViewModal();
          withdrawRequestSlip(item.request_id);
        };
      } else {
        rsvWithdrawBtn.classList.add('hidden');
      }
    }

    requestSlipViewModal.classList.remove('hidden');
    requestSlipViewModal.classList.add('flex');
  }

  function closeRequestSlipViewModal() {
    if (!requestSlipViewModal) return;
    requestSlipViewModal.classList.add('hidden');
    requestSlipViewModal.classList.remove('flex');
  }

  function printRequestSlip() {
    if (!requestSlipViewModal || requestSlipViewModal.classList.contains('hidden')) return;
    const badgeText = document.getElementById('rsvCodeBadge')?.textContent || '';
    rsvTitleBeforePrint = document.title;
    document.title = `CampusRoom Request Slip ${badgeText}`.trim();
    document.body.classList.add('cr-request-slip-printing');
    window.print();
  }

  if (rsvPrintBtn) {
    rsvPrintBtn.addEventListener('click', printRequestSlip);
  }

  window.addEventListener('beforeprint', () => {
    if (requestSlipViewModal && !requestSlipViewModal.classList.contains('hidden')) {
      const badgeText = document.getElementById('rsvCodeBadge')?.textContent || '';
      if (!rsvTitleBeforePrint) {
        rsvTitleBeforePrint = document.title;
        document.title = `CampusRoom Request Slip ${badgeText}`.trim();
      }
      document.body.classList.add('cr-request-slip-printing');
    }
  });

  window.addEventListener('afterprint', () => {
    if (document.body.classList.contains('cr-request-slip-printing')) {
      document.body.classList.remove('cr-request-slip-printing');
      if (rsvTitleBeforePrint !== null) {
        document.title = rsvTitleBeforePrint;
        rsvTitleBeforePrint = null;
      }
    }
  });

  if (closeRequestSlipViewBtn) closeRequestSlipViewBtn.addEventListener('click', closeRequestSlipViewModal);
  if (closeRequestSlipViewFooterBtn) closeRequestSlipViewFooterBtn.addEventListener('click', closeRequestSlipViewModal);
  if (requestSlipViewModal) {
    requestSlipViewModal.addEventListener('click', (e) => {
      if (e.target === requestSlipViewModal) closeRequestSlipViewModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && requestSlipViewModal && !requestSlipViewModal.classList.contains('hidden')) {
      closeRequestSlipViewModal();
    }
  });

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
    cancel:    'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-red-600 border border-gray-200 hover:bg-red-50 hover:border-red-200 hover:text-red-700 text-xs font-semibold rounded-lg transition-all shadow-sm',
    remove:    'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-red-600 border border-gray-200 hover:bg-red-50 hover:border-red-200 hover:text-red-700 text-xs font-semibold rounded-lg transition-all shadow-sm',
    move:      'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-blue-600 border border-gray-200 hover:bg-blue-50 hover:border-blue-200 hover:text-blue-700 text-xs font-semibold rounded-lg transition-all shadow-sm',
    slip:      'inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#7a1f2b] text-white hover:bg-[#5e1821] border border-transparent text-xs font-semibold rounded-lg transition-all shadow-sm',
    rebook:    'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-emerald-600 border border-gray-200 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700 text-xs font-semibold rounded-lg transition-all shadow-sm',
    logs:      'inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-800 text-xs font-semibold rounded-lg transition-all shadow-sm'
  };

  const ACTION_ICONS = {
    cancel: 'free_cancellation',
    remove: 'free_cancellation',
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
   * Which rows of a booking can be cancelled right now. Pending rows always
   * can; Approved rows only until the day before they start (Business Rules
   * Art. X Sec. 3). Mirrors ReservationController::cancel(); the server is
   * still the authority. A multi-day booking is one row per day.
   */
  function cancellableRows(reservation) {
    const rows = reservation.is_multi_day && Array.isArray(reservation.series_rows)
      ? reservation.series_rows
      : [reservation];
    const today = todayYMD();
    return rows.filter(r =>
      r.status === 'Pending' ||
      (r.status === 'Approved' && String(r.start_time).slice(0, 10) > today)
    );
  }

  /** '' when the booking can be cancelled, otherwise why it can't. */
  function cancelBlockedReason(reservation) {
    if (cancellableRows(reservation).length) return '';
    // Wall-clock date, read literally from the stored value (never device-local).
    return 'An approved booking cannot be cancelled on the day it takes place. Please contact the facilities desk.';
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

  // Which buttons show per status. Pending and Approved bookings are cancelled
  // directly by their owner on the first click, with no staff confirmation.
  function buildActions(reservation) {
    if (reservation.is_override) {
      const buttons = [];
      if (reservation.status === 'Pending') {
        buttons.push(`<button type="button" data-action="withdraw-slip" data-id="${escapeHtml(reservation.request_id)}" class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white text-red-600 border border-gray-200 hover:bg-red-50 hover:border-red-200 hover:text-red-700 text-xs font-semibold rounded-lg transition-all shadow-sm cursor-pointer"><span class="material-symbols-outlined text-[14px]">free_cancellation</span>Cancel</button>`);
      }
      buttons.push(`<button type="button" data-action="view-override-slip" data-id="${escapeHtml(reservation.request_id)}" class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#7a1f2b] text-white hover:bg-[#5e1821] border border-transparent text-xs font-semibold rounded-lg transition-all shadow-sm cursor-pointer"><span class="material-symbols-outlined text-[14px]">receipt_long</span>View Slip</button>`);
      return buttons.join('');
    }

    const id = reservation.reservation_id;
    const buttons = [];

    switch (reservation.status) {
      case 'Pending':
        buttons.push(actionButton('move', id, 'Move', moveRequestBlockedReason(reservation)));
        buttons.push(actionButton('cancel', id, 'Cancel', cancelBlockedReason(reservation)));
        buttons.push(actionButton('slip', id, 'View Slip'));
        break;
      case 'Approved':
        buttons.push(actionButton('move', id, 'Move', moveRequestBlockedReason(reservation)));
        buttons.push(actionButton('cancel', id, 'Cancel', cancelBlockedReason(reservation)));
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
        const diffDays = Math.round((datesObj[i] - datesObj[i-1]) / (1000 * 60 * 60 * 24));
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
      if (reservation.is_override) {
        const isPending = reservation.status === 'Pending';
        const isApproved = reservation.status === 'Approved';
        const isRejected = reservation.status === 'Rejected';
        
        let filterStatus = isPending ? 'pending' : (isApproved ? 'pending' : 'history');
        let statusBadgeCls = 'bg-amber-100 text-amber-800 border border-amber-300';
        let statusBadgeText = 'REQUEST SLIP · PENDING REVIEW';
        if (isApproved) {
          statusBadgeCls = 'bg-violet-100 text-violet-700 border border-violet-200';
          statusBadgeText = 'REQUEST SLIP · AWAITING MOVE';
        } else if (isRejected) {
          statusBadgeCls = 'bg-red-100 text-red-700 border border-red-200';
          statusBadgeText = 'REQUEST SLIP · REJECTED';
        }

        const date = formatDate(reservation.start_time);
        const multi = String(reservation.start_time).slice(0, 10) !== String(reservation.end_time).slice(0, 10);
        const endDateObj = multi ? formatDate(reservation.end_time) : null;
        
        let extraOverrideHtml = '';
        if (multi) {
           let datesText = '';
           if (date.year !== endDateObj.year) {
               datesText = `${date.month} ${date.day}, ${date.year} – ${endDateObj.month} ${endDateObj.day}, ${endDateObj.year}`;
           } else if (date.month !== endDateObj.month) {
               datesText = `${date.month} ${date.day} – ${endDateObj.month} ${endDateObj.day}, ${date.year}`;
           } else {
               datesText = `${date.month} ${date.day}–${endDateObj.day}, ${date.year}`;
           }
           extraOverrideHtml = `
                <span class="text-gray-300 select-none">&bull;</span>
                <span class="flex items-center gap-1">
                  <span class="material-symbols-outlined text-[15px] text-gray-400">calendar_month</span>
                  <span>${datesText}</span>
                </span>
                <span class="text-gray-300 select-none">&bull;</span>
                <span class="flex items-center gap-1">
                  <span class="material-symbols-outlined text-[15px] text-gray-400">style</span>
                  <span>Multiple Days — Consecutive Range</span>
                </span>
           `;
        }

        const dateBlockHtml = `
          <div class="border border-amber-300 rounded-lg overflow-hidden text-center min-w-[68px] shrink-0 flex flex-col bg-white shadow-xs">
            <div class="bg-amber-600 text-white text-[9px] font-bold py-1 px-1 uppercase tracking-widest whitespace-nowrap">${date.month} ${date.year}</div>
            <div class="text-2xl font-bold text-gray-900 py-2 leading-none">${date.day}</div>
          </div>
        `;

        const titleText = reservation.purpose || reservation.request_type || 'Facility Request Slip';

        return `<div data-status="${filterStatus}" class="reservation-card bg-white px-5 py-4 rounded-xl border border-amber-200/80 shadow-sm mb-3 transition-all hover:border-amber-300 hover:shadow">
          <div class="flex items-center gap-5">
            ${dateBlockHtml}

            <!-- Main info -->
            <div class="flex flex-col flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="text-base font-bold text-gray-900 leading-tight">${escapeHtml(titleText)}</h3>
                <span class="text-[10px] font-semibold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded font-mono tracking-wide shrink-0">#REQ-SLIP-${escapeHtml(reservation.request_id).substring(0,8).toUpperCase()}</span>
                <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded shrink-0 ${statusBadgeCls}">${statusBadgeText}</span>
              </div>

              <!-- Subtitle row -->
              <div class="flex items-center gap-3 text-sm text-gray-500 mt-1 flex-wrap">
                <span class="flex items-center gap-1">
                  <span class="material-symbols-outlined text-[15px] text-gray-400">location_on</span>
                  <span class="font-medium text-gray-700">${escapeHtml(reservation.room_name || reservation.room_id)}</span>
                </span>
                <span class="text-gray-300 select-none">&bull;</span>
                <span class="flex items-center gap-1">
                  <span class="material-symbols-outlined text-[15px] text-gray-400">assignment</span>
                  <span class="font-medium text-gray-700">${escapeHtml(reservation.request_type || 'Conflict Override')}</span>
                </span>
                <span class="text-gray-300 select-none">&bull;</span>
                <span class="flex items-center gap-1">
                  <span class="material-symbols-outlined text-[15px] text-gray-400">schedule</span>
                  <span>${formatTime(reservation.start_time)} – ${formatTime(reservation.end_time)}</span>
                </span>
                ${extraOverrideHtml}
              </div>
            </div>

            <!-- Action buttons -->
            <div class="flex items-center gap-2 shrink-0 self-center ml-2">
              ${buildActions(reservation)}
            </div>
          </div>
        </div>`;
      }

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

  // Cancel = two steps, to stop misclicks: the owner gives a reason and then
  // presses a final "Confirm Cancellation". No staff confirmation is needed.
  function openCancelBookingModal(id) {
    const reservation = allReservations.find(r => r.reservation_id === id);
    if (!reservation) return;

    // The button is already disabled in this case; this covers a stale card.
    const blocked = cancelBlockedReason(reservation);
    if (blocked) { showToast(blocked, 'error'); return; }

    currentTargetReservationId = id;
    if (cancelBkPermit) cancelBkPermit.textContent = permitRef(id);
    if (cancelBkReason) cancelBkReason.value = '';
    showCancelBkError('');
    if (cancelBkModal) cancelBkModal.classList.remove('hidden');
    if (cancelBkReason) cancelBkReason.focus();
  }

  function showCancelBkError(message) {
    if (!cancelBkError) return;
    cancelBkError.textContent = message;
    cancelBkError.classList.toggle('hidden', !message);
  }

  function submitCancelBooking() {
    const id = currentTargetReservationId;
    const target = allReservations.find(r => r.reservation_id === id);
    if (!target) { closeModal(); return; }

    const reason = cancelBkReason ? cancelBkReason.value.trim() : '';
    if (!reason) {
      showCancelBkError('Please give a reason for cancelling.');
      if (cancelBkReason) cancelBkReason.focus();
      return;
    }

    const blocked = cancelBlockedReason(target);
    if (blocked) { closeModal(); showToast(blocked, 'error'); return; }

    // A multi-day booking is one row per day: cancel every day still open.
    const rows = cancellableRows(target);
    const skipped = (target.is_multi_day ? target.series_rows : [target])
      .filter(r => (r.status === 'Pending' || r.status === 'Approved') && !rows.includes(r)).length;

    if (cancelBkSubmit) cancelBkSubmit.disabled = true;
    Promise.all(rows.map(r =>
      fetch(BASE + 'api/reservations/' + encodeURIComponent(r.reservation_id) + '/cancel', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      }).then(res => res.json())
    ))
    .then(results => {
      const failed = results.find(json => !json.success);
      if (failed) {
        showCancelBkError(failed.error || 'Could not cancel the booking.');
      } else {
        closeModal();
        showToast(skipped
          ? 'Cancelled the upcoming days. Days that start today or earlier cannot be cancelled.'
          : 'Booking cancelled. The room has been released.', 'success');
      }
      fetchReservations();
    })
    .catch(() => showCancelBkError('Network error. Please try again.'))
    .finally(() => { if (cancelBkSubmit) cancelBkSubmit.disabled = false; });
  }

  let moveCalendarInstance = null;

  function findReservation(id) {
    if (!id || !Array.isArray(allReservations)) return null;
    for (const r of allReservations) {
      if (r.reservation_id === id) return r;
      if (Array.isArray(r.series_rows)) {
        const match = r.series_rows.find(row => row.reservation_id === id);
        if (match) return match;
      }
    }
    return null;
  }

  function nowHHMM() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function refreshMoveTimeOptions() {
    const dateInput = document.getElementById('moveDate');
    const startSelect = document.getElementById('moveStartTime');
    const endSelect = document.getElementById('moveEndTime');
    if (!dateInput || !startSelect || !endSelect) return;

    const isToday = dateInput.value === todayYMD();
    const cutoff = isToday ? nowHHMM() : null;

    [startSelect, endSelect].forEach(select => {
      let clearedSelection = false;
      Array.from(select.options).forEach(opt => {
        if (!opt.value) return; // leave the blank placeholder alone
        const isPastSlot = cutoff !== null && opt.value <= cutoff;
        opt.disabled = isPastSlot;
        if (isPastSlot && select.value === opt.value) clearedSelection = true;
      });
      if (clearedSelection) select.value = '';
    });
  }

  function openMoveModal(id) {
    currentTargetReservationId = id;
    const target = findReservation(id);
    const moveModalOverlay = document.getElementById('moveModalOverlay');
    const moveErrorMsg = document.getElementById('moveErrorMsg');
    const moveConflictBanner = document.getElementById('moveConflictBanner');
    const moveDateInput = document.getElementById('moveDate');
    const moveStartTimeSelect = document.getElementById('moveStartTime');
    const moveEndTimeSelect = document.getElementById('moveEndTime');

    if (moveErrorMsg) moveErrorMsg.classList.add('hidden');
    if (moveConflictBanner) moveConflictBanner.classList.add('hidden');

    if (moveDateInput) {
      moveDateInput.min = todayYMD();
      if (target && target.start_time) {
        const curDate = String(target.start_time).slice(0, 10);
        moveDateInput.value = (curDate >= todayYMD()) ? curDate : todayYMD();
      } else {
        moveDateInput.value = todayYMD();
      }
    }

    if (target && target.start_time && target.end_time) {
      const curStart = String(target.start_time).slice(11, 16);
      const curEnd = String(target.end_time).slice(11, 16);
      if (moveStartTimeSelect) moveStartTimeSelect.value = curStart;
      if (moveEndTimeSelect) moveEndTimeSelect.value = curEnd;
    }

    refreshMoveTimeOptions();

    // Initialize RoomCalendar in move modal if available
    if (typeof RoomCalendar !== 'undefined' && target && target.room_id) {
      const calendarContainer = document.getElementById('move-room-calendar-container');
      if (calendarContainer) {
        calendarContainer.innerHTML = '';
        const initialDate = (moveDateInput && moveDateInput.value) || todayYMD();
        moveCalendarInstance = new RoomCalendar({
          containerId: 'move-room-calendar-container',
          roomId: target.room_id,
          initialDate: initialDate,
          minDate: todayYMD(),
        });
        if (moveStartTimeSelect && moveEndTimeSelect && typeof moveCalendarInstance.setSelectionTimes === 'function') {
          moveCalendarInstance.setSelectionTimes(moveStartTimeSelect.value, moveEndTimeSelect.value);
        }
      }
    }

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
        case 'cancel':
          openCancelBookingModal(id);
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
        case 'withdraw-slip':
          withdrawRequestSlip(id);
          break;
        case 'view-override-slip':
          openRequestSlipViewModal(id);
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
    if (cancelBkModal) cancelBkModal.classList.add('hidden');
    currentTargetReservationId = null;

    const moveModalOverlay = document.getElementById('moveModalOverlay');
    if (moveModalOverlay) moveModalOverlay.classList.add('opacity-0', 'pointer-events-none');
    const moveForm = document.getElementById('moveForm');
    if (moveForm) moveForm.reset();
  }

  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (cancelBkDismiss) cancelBkDismiss.addEventListener('click', closeModal);
  if (cancelBkKeep) cancelBkKeep.addEventListener('click', closeModal);
  if (cancelBkSubmit) cancelBkSubmit.addEventListener('click', submitCancelBooking);
  if (modalDismiss) modalDismiss.addEventListener('click', closeModal);

  const moveModalCloseIcon = document.getElementById('moveModalCloseIcon');
  if (moveModalCloseIcon) moveModalCloseIcon.addEventListener('click', closeModal);
  const moveModalCancelBtn = document.getElementById('moveModalCancelBtn');
  if (moveModalCancelBtn) moveModalCancelBtn.addEventListener('click', closeModal);
  const moveModalOverlay = document.getElementById('moveModalOverlay');
  if (moveModalOverlay) {
    moveModalOverlay.addEventListener('click', (e) => {
      if (e.target === moveModalOverlay) closeModal();
    });
  }

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
    if (!date || !start || !end) return null;
    if (end <= start) return { message: 'End time must be after start time.', isOverrideEligible: false };

    const target = findReservation(currentTargetReservationId);
    if (!target || !window.CampusSchedule) return null;

    const data = await window.CampusSchedule.fetchDay(BASE, target.room_id, date);
    if (!data) return null;   // can't pre-check; the server will
    const clash = window.CampusSchedule.findConflicts(
      data, date, start, end, { excludeReservationId: target.reservation_id }
    );
    if (!clash || !clash.length) return null;

    // A conflict is overridable via Request Slip if it is with another reservation (not an official class or holiday)
    const isOverrideEligible = clash.every(c => c.kind === 'reservation');
    const message = window.CampusSchedule.describe(clash, start, end);
    return { message, isOverrideEligible, clash };
  }

  function showMoveError(problem) {
    const moveErrorMsg = document.getElementById('moveErrorMsg');
    const moveConflictBanner = document.getElementById('moveConflictBanner');
    const moveConflictText = document.getElementById('moveConflictText');
    const moveRequestSlipPrompt = document.getElementById('moveRequestSlipPrompt');

    if (!problem) {
      if (moveErrorMsg) moveErrorMsg.classList.add('hidden');
      if (moveConflictBanner) moveConflictBanner.classList.add('hidden');
      return;
    }

    const message = typeof problem === 'string' ? problem : (problem.message || '');
    const isOverride = typeof problem === 'object' && problem !== null && Boolean(problem.isOverrideEligible);

    if (moveConflictBanner && moveConflictText) {
      moveConflictText.textContent = message;
      moveConflictBanner.classList.remove('hidden');
      if (moveRequestSlipPrompt) {
        moveRequestSlipPrompt.classList.toggle('hidden', !isOverride);
      }
      if (moveErrorMsg) moveErrorMsg.classList.add('hidden');
    } else if (moveErrorMsg) {
      moveErrorMsg.textContent = message;
      moveErrorMsg.classList.remove('hidden');
    }
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

      const moveDate = document.getElementById('moveDate').value;
      const moveStartTime = document.getElementById('moveStartTime').value;
      const moveEndTime = document.getElementById('moveEndTime').value;

      if (!currentTargetReservationId) {
        showMoveError('No reservation selected. Please close and reopen this dialog.');
        return;
      }
      if (!moveDate || !moveStartTime || !moveEndTime) {
        showMoveError('Please choose a date, start time and end time.');
        return;
      }

      if (moveSubmitBtn) {
        moveSubmitBtn.disabled = true;
        moveSubmitBtn.textContent = 'Checking availability…';
      }

      try {
        moveCheckSeq++;

        const timeout = new Promise(resolve => setTimeout(() => resolve(undefined), 8000));
        const rangeProblem = await Promise.race([moveRangeProblem(), timeout]);
        if (rangeProblem === undefined) {
          console.warn('[Move] availability pre-check timed out; submitting anyway, server will validate.');
        } else if (rangeProblem) {
          showMoveError(rangeProblem);
          return;
        }

        const requestedStart = `${moveDate}T${moveStartTime}:00`;
        const requestedEnd = `${moveDate}T${moveEndTime}:00`;

        if (moveSubmitBtn) moveSubmitBtn.textContent = 'Rescheduling…';

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
          const successMsg = (json.data && json.data.message) || 'Reservation successfully moved to the new schedule (Auto-approved).';
          showToast(successMsg, 'success');
          closeModal();
          fetchReservations();
        } else {
          const errMsg = json.error || 'The requested slot is unavailable.';
          const isEligible = json.data && json.data.override_eligible;
          showMoveError({ message: errMsg, isOverrideEligible: Boolean(isEligible) });
        }
      } catch (err) {
        console.error('[Move] submit failed:', err);
        showMoveError('Network error while rescheduling.');
      } finally {
        if (moveSubmitBtn) {
          moveSubmitBtn.disabled = false;
          moveSubmitBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">event_repeat</span> Confirm Reschedule';
        }
      }
    });
  }

  // ---------------------------------------------------------------
  // Move Request Slip Modal Wiring
  // ---------------------------------------------------------------
  const moveOpenRequestSlipBtn = document.getElementById('moveOpenRequestSlipBtn');
  const moveRequestSlipModalOverlay = document.getElementById('moveRequestSlipModalOverlay');
  const closeMoveRequestSlipModalBtn = document.getElementById('closeMoveRequestSlipModalBtn');
  const cancelMoveRequestSlipBtn = document.getElementById('cancelMoveRequestSlipBtn');
  const moveRequestSlipForm = document.getElementById('moveRequestSlipForm');
  const mrsAltSchedule = document.getElementById('mrsAltSchedule');
  const mrsAltScheduleFields = document.getElementById('mrsAltScheduleFields');
  const mrsErrorBanner = document.getElementById('mrsErrorBanner');
  const submitMoveRequestSlipBtn = document.getElementById('submitMoveRequestSlipBtn');

  if (mrsAltSchedule && mrsAltScheduleFields) {
    mrsAltSchedule.addEventListener('change', () => {
      mrsAltScheduleFields.classList.toggle('hidden', mrsAltSchedule.value !== 'Yes');
    });
  }

  function closeMoveRequestSlipModal() {
    if (!moveRequestSlipModalOverlay) return;
    moveRequestSlipModalOverlay.classList.add('hidden');
    moveRequestSlipModalOverlay.classList.remove('flex');
    if (mrsErrorBanner) mrsErrorBanner.classList.add('hidden');
  }

  if (closeMoveRequestSlipModalBtn) closeMoveRequestSlipModalBtn.addEventListener('click', closeMoveRequestSlipModal);
  if (cancelMoveRequestSlipBtn) cancelMoveRequestSlipBtn.addEventListener('click', closeMoveRequestSlipModal);
  if (moveRequestSlipModalOverlay) {
    moveRequestSlipModalOverlay.addEventListener('click', (e) => {
      if (e.target === moveRequestSlipModalOverlay) closeMoveRequestSlipModal();
    });
  }

  if (moveOpenRequestSlipBtn) {
    moveOpenRequestSlipBtn.addEventListener('click', () => {
      const target = findReservation(currentTargetReservationId);
      const moveDate = document.getElementById('moveDate').value;
      const moveStartTime = document.getElementById('moveStartTime').value;
      const moveEndTime = document.getElementById('moveEndTime').value;
      const moveConflictText = document.getElementById('moveConflictText');

      if (!target || !moveDate || !moveStartTime || !moveEndTime) {
        return;
      }

      // Populate preview in Request Slip modal
      const mrsFacility = document.getElementById('mrsFacility');
      const mrsDate = document.getElementById('mrsDate');
      const mrsTime = document.getElementById('mrsTime');
      const mrsConflictInfo = document.getElementById('mrsConflictInfo');

      if (mrsFacility) mrsFacility.textContent = target.room_name || target.room_id || '—';
      if (mrsDate) mrsDate.textContent = moveDate;
      if (mrsTime) mrsTime.textContent = `${moveStartTime} – ${moveEndTime}`;
      if (mrsConflictInfo) mrsConflictInfo.textContent = (moveConflictText && moveConflictText.textContent) || 'Scheduling Conflict';

      // Reset form
      if (moveRequestSlipForm) moveRequestSlipForm.reset();
      if (mrsAltScheduleFields) mrsAltScheduleFields.classList.add('hidden');
      if (mrsErrorBanner) mrsErrorBanner.classList.add('hidden');

      // Close move modal and open request slip modal
      closeModal();
      if (moveRequestSlipModalOverlay) {
        moveRequestSlipModalOverlay.classList.remove('hidden');
        moveRequestSlipModalOverlay.classList.add('flex');
      }
    });
  }

  if (moveRequestSlipForm) {
    moveRequestSlipForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const target = findReservation(currentTargetReservationId);
      const moveDate = document.getElementById('moveDate').value;
      const moveStartTime = document.getElementById('moveStartTime').value;
      const moveEndTime = document.getElementById('moveEndTime').value;

      const setMrsError = (msg) => {
        if (mrsErrorBanner) {
          mrsErrorBanner.textContent = msg;
          mrsErrorBanner.classList.remove('hidden');
        } else {
          showToast(msg, 'error');
        }
      };

      if (mrsErrorBanner) mrsErrorBanner.classList.add('hidden');

      const ack = document.getElementById('mrsAcknowledgement');
      if (ack && !ack.checked) {
        return setMrsError('Please acknowledge that submitting this request does not guarantee approval.');
      }

      const reasonEl = moveRequestSlipForm.querySelector('textarea[name="reason"]');
      const reason = reasonEl ? reasonEl.value.trim() : '';
      if (!reason) {
        return setMrsError('Please provide a justification for this conflict override request.');
      }

      const reqTypeEl = moveRequestSlipForm.querySelector('select[name="request_type"]');
      const requestType = reqTypeEl ? reqTypeEl.value : 'Schedule Conflict';

      const addInfoEl = moveRequestSlipForm.querySelector('textarea[name="additional_info"]');
      const additionalInfo = addInfoEl ? addInfoEl.value.trim() : '';

      const altSchedule = mrsAltSchedule ? mrsAltSchedule.value : 'No';
      const altDateInput = moveRequestSlipForm.querySelector('input[name="alt_date"]');
      const altStartInput = moveRequestSlipForm.querySelector('input[name="alt_start"]');
      const altEndInput = moveRequestSlipForm.querySelector('input[name="alt_end"]');

      const altDate = altDateInput ? altDateInput.value : '';
      const altStart = altStartInput ? altStartInput.value : '';
      const altEnd = altEndInput ? altEndInput.value : '';

      if (altSchedule === 'Yes') {
        if (!altDate || !altStart || !altEnd) {
          return setMrsError('Please fill out all fields for the alternative schedule proposal.');
        }
        if (altEnd <= altStart) {
          return setMrsError('Alternative end time must be after the alternative start time.');
        }
      }

      const payload = {
        room_id: target.room_id,
        purpose: `${target.purpose || requestType}: ${reason}`.substring(0, 250),
        category: target.category || 'Academic Lecture',
        start_time: `${moveDate}T${moveStartTime}:00`,
        end_time: `${moveDate}T${moveEndTime}:00`,
        equipment_notes: target.equipment_notes || 'Standard Academic Setup',
        reason: reason,
        request_type: requestType,
        additional_info: additionalInfo || null,
        alt_start_time: (altSchedule === 'Yes' && altDate && altStart) ? `${altDate} ${altStart}:00` : null,
        alt_end_time: (altSchedule === 'Yes' && altDate && altEnd) ? `${altDate} ${altEnd}:00` : null
      };

      if (submitMoveRequestSlipBtn) {
        submitMoveRequestSlipBtn.disabled = true;
        submitMoveRequestSlipBtn.textContent = 'Submitting…';
      }

      try {
        const res = await fetch(BASE + 'api/conflict-override-requests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload)
        });
        const json = await res.json();

        if (json.success) {
          closeMoveRequestSlipModal();
          showToast('Request Slip submitted successfully! Staff will evaluate the conflict. Your current booking remains active.', 'success');
          fetchReservations();
        } else {
          setMrsError(json.error || 'Failed to submit Request Slip. Please try again.');
        }
      } catch (err) {
        setMrsError('Network error while submitting Request Slip.');
      } finally {
        if (submitMoveRequestSlipBtn) {
          submitMoveRequestSlipBtn.disabled = false;
          submitMoveRequestSlipBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">send</span><span>Submit Request Slip</span>';
        }
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (cancelBkModal && !cancelBkModal.classList.contains('hidden')) closeModal();
      if (moveRequestSlipModalOverlay && !moveRequestSlipModalOverlay.classList.contains('hidden')) {
        closeMoveRequestSlipModal();
      }
      const moveModalOverlay = document.getElementById('moveModalOverlay');
      if (moveModalOverlay && !moveModalOverlay.classList.contains('pointer-events-none')) {
        closeModal();
      }
    }
  });

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

  fetchReservations();
});




