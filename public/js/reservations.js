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

  // Page ownership (Customer-only) is enforced centrally in app.js
  // (bounceWrongRole), which routes Staff/Admin to their own home — instantly
  // from the client hint and again after the server confirms the session.

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
    // Direct booking: reservations only — there are no conflict-override
    // "Request Slips" to merge in anymore.
    fetch(BASE + 'api/reservations/mine', { credentials: 'same-origin' })
      .then(res => {
        if (res.status === 401) {
          window.location.href = 'index.html';
          return null;
        }
        return res.json().catch(() => {
          throw new Error('Server returned an unreadable (non-JSON) response.');
        });
      })
      .then((resJson) => {
        if (!resJson) return; // 401 redirecting
        if (!resJson.success) {
          showListError(resJson.error || 'Could not load your reservations.');
          return;
        }
        hideListStates();

        allReservations = groupBySeries(resJson.data || []);
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


  // Which buttons show per status. Pending and Approved bookings are cancelled
  // directly by their owner on the first click, with no staff confirmation.
  function buildActions(reservation) {
    const id = reservation.reservation_id;
    const buttons = [];

    switch (reservation.status) {
      // Direct booking: self-service cancel (no Move Request, no View Slip).
      case 'Pending':
      case 'Approved':
        buttons.push(actionButton('cancel', id, 'Cancel', cancelBlockedReason(reservation)));
        buttons.push(actionButton('logs', id, 'View Logs'));
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

      // Cancellation-request notices (the move/override workflow is retired).
      let noticeBadge = '';
      if (reservation.cancel_status === 'Pending') {
        noticeBadge += `<div class="mt-2 text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1.5 rounded-lg border border-amber-200/60">Cancellation Request pending review. Your booking stands until decided.</div>`;
      } else if (reservation.cancel_status === 'Rejected' && reservation.cancel_comment) {
        noticeBadge += `<div class="mt-2 text-xs font-medium text-red-700 bg-red-50 px-2.5 py-1.5 rounded-lg border border-red-200/60">Cancellation Request Rejected: ${escapeHtml(reservation.cancel_comment)}</div>`;
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

            ${noticeBadge}
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


  // Confirmation slip (Section 12), log archive (Section 13) and re-book
  // (Section 14) are all shared components.

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
    if (cancelBkModal) cancelBkModal.classList.add('hidden');
    currentTargetReservationId = null;
  }

  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (cancelBkDismiss) cancelBkDismiss.addEventListener('click', closeModal);
  if (cancelBkKeep) cancelBkKeep.addEventListener('click', closeModal);
  if (cancelBkSubmit) cancelBkSubmit.addEventListener('click', submitCancelBooking);
  if (modalDismiss) modalDismiss.addEventListener('click', closeModal);


  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (cancelBkModal && !cancelBkModal.classList.contains('hidden')) closeModal();
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






