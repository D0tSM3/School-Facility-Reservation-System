/**
 * CampusRoom — Confirmation slip (shared component, Section 12)
 *
 * One renderer used by the customer page (my-reservations.html) and the
 * staff dispatch queue (staff-queue.html):
 *
 *   window.CampusRoomSlip.open(reservationId)   fetch + render + show
 *   window.CampusRoomSlip.close()
 *   window.CampusRoomSlip.print()
 *
 * Load order on a page:
 *   <script src="js/util.js"></script>   (escapeHtml)
 *   <script src="js/slip.js"></script>
 *   <script src="js/<page>.js"></script>
 *
 * Design notes
 *   - Always fetches GET api/reservations/{id} on open. A slip is a document
 *     of record, so it must never be built from a list cached on the page.
 *   - Builds its own DOM and injects its own <style>, so the two pages need
 *     nothing but the script tags and render identically.
 *   - Printing uses @media print on the live page (no window.open popup,
 *     which gets blocked and loses the stylesheet). While the slip is open,
 *     everything else on the page is hidden for print.
 *   - The API returns zone-less DATETIME strings that are already Asia/Manila
 *     wall-clock time (Section 9). They are formatted literally, never through
 *     the viewer's device timezone, so a slip reads the same everywhere.
 */
(function () {
  'use strict';

  if (!window.CampusRoomUtil) {
    console.error('[slip] js/util.js must be loaded before js/slip.js');
    return;
  }

  const { escapeHtml } = window.CampusRoomUtil;
  const BASE = window.location.pathname.replace(/[^\/]*$/, '');

  // ---------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------

  /** A slip is only "valid" for these statuses; anything else is watermarked. */
  const VALID_STATUSES = ['Approved', 'Completed'];

  /** Same palette as public/js/reservations.js so a status reads the same everywhere. */
  const STATUS_STYLES = {
    Approved:  { bg: '#DCFCE7', fg: '#15803D' },
    Rejected:  { bg: '#FEE2E2', fg: '#B91C1C' },
    Cancelled: { bg: '#FEE2E2', fg: '#B91C1C' },
    Completed: { bg: '#F1F5F9', fg: '#475569' },
    Pending:   { bg: '#FEF3C7', fg: '#B45309' }
  };

  const STYLE_ID = 'crSlipStyles';
  const ROOT_ID = 'crSlipRoot';
  const OPEN_CLASS = 'cr-slip-open';

  const state = {
    ticket: 0,            // bumped per load so a slow, stale response can't overwrite a newer one
    currentId: null,
    reservation: null,
    returnFocusTo: null,
    titleBeforePrint: null
  };

  let root = null;
  let bodyEl = null;
  let printBtn = null;

  // ---------------------------------------------------------------
  // Formatting helpers
  // ---------------------------------------------------------------

  function has(value) {
    return value !== null && value !== undefined && String(value).trim() !== '';
  }

  /** Escaped value, or an em dash when the database has nothing. */
  function textOrDash(value) {
    return has(value) ? escapeHtml(value) : '—';
  }

  const DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

  /**
   * '2026-09-25 10:00:00' → a Date whose UTC fields equal that wall-clock time.
   * Formatting it with timeZone:'UTC' prints the stored Manila time unchanged,
   * whatever timezone the viewer's device is set to.
   */
  function wallClock(value) {
    const m = DATETIME_PATTERN.exec(String(value ?? ''));
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
  }

  function fmt(value, options) {
    const date = wallClock(value);
    return date ? date.toLocaleString('en-US', { ...options, timeZone: 'UTC' }) : '—';
  }

  const formatLong = (value) => fmt(value, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });

  const formatDayShort = (value) => fmt(value, { year: 'numeric', month: 'short', day: 'numeric' });
  const formatTimeShort = (value) => fmt(value, { hour: 'numeric', minute: '2-digit' });

  function formatRangeShort(start, end) {
    const sameDay = String(start).slice(0, 10) === String(end).slice(0, 10);
    return sameDay
      ? `${formatDayShort(start)} · ${formatTimeShort(start)} – ${formatTimeShort(end)}`
      : `${formatDayShort(start)} ${formatTimeShort(start)} – ${formatDayShort(end)} ${formatTimeShort(end)}`;
  }

  /** "Now" as Manila wall-clock time, for the "Generated …" footer. */
  function generatedStamp() {
    return new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  }

  function permitRef(reservationId) {
    return 'REQ-' + String(reservationId ?? '').substring(0, 8).toUpperCase();
  }

  function roomDetails(r) {
    const parts = [];
    if (has(r.room_type)) parts.push(escapeHtml(r.room_type));
    if (has(r.floor)) parts.push(`Floor ${escapeHtml(r.floor)}`);
    if (has(r.capacity)) parts.push(`Capacity ${escapeHtml(r.capacity)}`);
    return parts.join(' • ');
  }

  function statusChip(status) {
    const style = STATUS_STYLES[status] || STATUS_STYLES.Pending;
    return `<span class="cr-slip-chip" style="background:${style.bg};color:${style.fg}">${escapeHtml(status || 'Unknown')}</span>`;
  }

  // ---------------------------------------------------------------
  // Slip markup
  // ---------------------------------------------------------------

  function row(label, valueHtml) {
    return `<div class="cr-slip-row"><dt>${escapeHtml(label)}</dt><dd>${valueHtml}</dd></div>`;
  }

  function section(title, rowsHtml) {
    return `<section class="cr-slip-section"><h3>${escapeHtml(title)}</h3><dl>${rowsHtml}</dl></section>`;
  }

  function cancellationValue(r) {
    const reason = has(r.cancellation_reason) ? escapeHtml(r.cancellation_reason) : 'No reason given';
    let by = '';
    if (has(r.cancelled_by)) {
      by = r.cancelled_by === r.customer_id ? 'Cancelled by the requester' : 'Cancelled by campus staff';
    }
    return by ? `${reason}<div class="cr-slip-sub">${by}</div>` : reason;
  }

  function moveHistoryHtml(moves) {
    const items = moves.map((m) => {
      const reviewer = has(m.processed_by_name) ? ` · Reviewed by ${escapeHtml(m.processed_by_name)}` : '';
      const comment = has(m.staff_comment)
        ? `<div class="cr-slip-move-comment">Staff comment: ${escapeHtml(m.staff_comment)}</div>`
        : '';
      return `
        <li class="cr-slip-move">
          <div class="cr-slip-move-top">
            <span>Requested: ${escapeHtml(formatRangeShort(m.requested_start_time, m.requested_end_time))}</span>
            ${statusChip(m.status)}
          </div>
          <div class="cr-slip-sub">Filed ${escapeHtml(formatDayShort(m.created_at))} ${escapeHtml(formatTimeShort(m.created_at))}${reviewer}</div>
          ${comment}
        </li>`;
    }).join('');

    return `<section class="cr-slip-section"><h3>Move history</h3><ul class="cr-slip-moves">${items}</ul></section>`;
  }

  function slipHtml(r) {
    const status = has(r.status) ? String(r.status) : 'Unknown';
    const valid = VALID_STATUSES.includes(status);
    const ref = permitRef(r.reservation_id);

    const banner = valid
      ? ''
      : `<div class="cr-slip-banner" role="alert">NOT VALID — status: ${escapeHtml(status)}</div>`;
    const watermark = valid ? '' : '<div class="cr-slip-watermark" aria-hidden="true">NOT VALID</div>';

    const requester = section('Requester',
      row('Name', textOrDash(r.customer_name)) +
      row('Email', textOrDash(r.customer_email)));

    const facility = section('Facility',
      row('Room', textOrDash(r.room_name)) +
      row('Details', roomDetails(r) || '—'));

    const booking = section('Booking',
      row('Category', textOrDash(r.category)) +
      row('Purpose', textOrDash(r.purpose)) +
      (has(r.equipment_notes) ? row('Equipment notes', escapeHtml(r.equipment_notes)) : '') +
      row('Starts', escapeHtml(formatLong(r.start_time))) +
      row('Ends', escapeHtml(formatLong(r.end_time))));

    const processedBy = has(r.processed_by_name)
      ? escapeHtml(r.processed_by_name)
      : (status === 'Pending' ? 'Awaiting review' : '—');

    const record = section('Record',
      row('Filed on', escapeHtml(formatLong(r.created_at))) +
      row('Processed by', processedBy) +
      (status === 'Cancelled' || has(r.cancellation_reason)
        ? row('Cancellation', cancellationValue(r))
        : ''));

    const moves = Array.isArray(r.move_requests) && r.move_requests.length
      ? moveHistoryHtml(r.move_requests)
      : '';

    return `
      <div class="cr-slip-paper">
        ${watermark}
        <div class="cr-slip-head">
          <img class="cr-slip-logo" src="${escapeHtml(BASE)}assets/logo.svg" alt="CampusRoom — Buenavista Polytechnic University" />
          <div class="cr-slip-ref">
            <div class="cr-slip-label">Permit reference</div>
            <div class="cr-slip-ref-code">${escapeHtml(ref)}</div>
            <div class="cr-slip-uuid">${escapeHtml(r.reservation_id)}</div>
          </div>
        </div>
        <div class="cr-slip-titlebar">
          <h2>Facility Reservation Confirmation Slip</h2>
          ${statusChip(status)}
        </div>
        ${banner}
        ${requester}
        ${facility}
        ${booking}
        ${record}
        ${moves}
        <div class="cr-slip-foot">
          <div>Generated <span id="crSlipGenerated">${escapeHtml(generatedStamp())}</span> — valid only with an Approved status.</div>
          <div>All times are Philippine Standard Time (Asia/Manila).</div>
        </div>
      </div>`;
  }

  function loadingHtml() {
    return `
      <div class="cr-slip-state" role="status" aria-live="polite">
        <div class="cr-slip-spinner" aria-hidden="true"></div>
        <p>Loading confirmation slip…</p>
      </div>`;
  }

  function errorHtml(message, options) {
    const { retry = true, signIn = false } = options || {};
    return `
      <div class="cr-slip-state" role="alert">
        <span class="material-symbols-outlined cr-slip-error-icon" aria-hidden="true">error</span>
        <p>${escapeHtml(message)}</p>
        <div class="cr-slip-actions">
          ${retry ? '<button type="button" class="cr-slip-btn cr-slip-btn-primary" data-cr-slip="retry">Retry</button>' : ''}
          ${signIn ? `<a class="cr-slip-btn cr-slip-btn-primary" href="${escapeHtml(BASE)}index.html">Sign in</a>` : ''}
          <button type="button" class="cr-slip-btn" data-cr-slip="close">Close</button>
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------
  // Styles + DOM (built once, on first open)
  // ---------------------------------------------------------------

  const CSS = `
    .cr-slip-root { display: none; position: fixed; inset: 0; z-index: 80; overflow-y: auto;
      overscroll-behavior: contain; background: rgba(0,0,0,.45); padding: 24px 12px;
      font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1a1c1e; }
    .cr-slip-root.is-open { display: block; }
    .cr-slip-root *, .cr-slip-root *::before, .cr-slip-root *::after { box-sizing: border-box; }
    .cr-slip-shell { max-width: 720px; margin: 0 auto; background: #fff; border-radius: 12px;
      box-shadow: 0 20px 50px rgba(0,0,0,.3); overflow: hidden; }
    .cr-slip-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 10px 16px; background: #f3f4f6; border-bottom: 1px solid #e1e2e4; }
    .cr-slip-toolbar-title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; margin: 0; }
    .cr-slip-toolbar-actions { display: flex; align-items: center; gap: 8px; }
    .cr-slip-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 14px;
      font: 600 13px/1 Inter, system-ui, sans-serif; color: #1a1c1e; background: #e5e7eb; border: 0; border-radius: 6px;
      cursor: pointer; text-decoration: none; }
    .cr-slip-btn:hover { background: #d1d5db; }
    .cr-slip-btn:focus-visible { outline: 2px solid #7A1F2B; outline-offset: 2px; }
    .cr-slip-btn:disabled { opacity: .5; cursor: not-allowed; }
    .cr-slip-btn-primary { background: #7A1F2B; color: #fff; }
    .cr-slip-btn-primary:hover { background: #52131C; }
    .cr-slip-btn .material-symbols-outlined { font-size: 18px; }

    .cr-slip-body { padding: 24px; font-size: 14px; line-height: 1.45; }
    .cr-slip-paper { position: relative; overflow: hidden; }
    .cr-slip-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
      padding-bottom: 14px; border-bottom: 2px solid #7A1F2B; }
    .cr-slip-logo { height: 44px; width: auto; display: block; }
    .cr-slip-ref { text-align: right; }
    .cr-slip-label { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; font-weight: 600; }
    .cr-slip-ref-code { font-size: 20px; font-weight: 800; color: #7A1F2B; letter-spacing: .02em; }
    .cr-slip-uuid { font: 10px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #6b7280; word-break: break-all; }
    .cr-slip-titlebar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 14px 0 10px; }
    .cr-slip-titlebar h2 { margin: 0; font-size: 18px; font-weight: 700; }
    .cr-slip-chip { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; white-space: nowrap; }
    .cr-slip-banner { margin: 0 0 12px; padding: 8px 12px; border: 2px solid #B91C1C; border-radius: 6px;
      background: #FEE2E2; color: #B91C1C; font-weight: 800; letter-spacing: .04em; text-align: center; }
    .cr-slip-watermark { position: absolute; top: 45%; left: 50%; transform: translate(-50%, -50%) rotate(-24deg);
      font-size: 96px; font-weight: 900; letter-spacing: .06em; color: rgba(185, 28, 28, .10);
      pointer-events: none; user-select: none; white-space: nowrap; z-index: 0; }
    .cr-slip-section { position: relative; z-index: 1; margin-top: 12px; padding-top: 8px; border-top: 1px solid #e5e7eb; break-inside: avoid; }
    .cr-slip-section h3 { margin: 0 0 4px; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: #6b7280; }
    .cr-slip-section dl { margin: 0; }
    .cr-slip-row { display: grid; grid-template-columns: 140px 1fr; gap: 12px; padding: 3px 0; }
    .cr-slip-row dt { color: #6b7280; font-weight: 600; }
    .cr-slip-row dd { margin: 0; font-weight: 500; white-space: pre-wrap; overflow-wrap: anywhere; }
    .cr-slip-sub { font-size: 12px; color: #6b7280; font-weight: 400; }
    .cr-slip-moves { list-style: none; margin: 0; padding: 0; }
    .cr-slip-move { padding: 6px 0; border-bottom: 1px dashed #e5e7eb; break-inside: avoid; }
    .cr-slip-move:last-child { border-bottom: 0; }
    .cr-slip-move-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; font-weight: 500; }
    .cr-slip-move-comment { font-size: 12px; color: #374151; overflow-wrap: anywhere; white-space: pre-wrap; }
    .cr-slip-foot { position: relative; z-index: 1; margin-top: 16px; padding-top: 10px; border-top: 2px solid #7A1F2B;
      font-size: 11px; color: #6b7280; text-align: center; }

    .cr-slip-state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 48px 16px; text-align: center; color: #374151; }
    .cr-slip-state p { margin: 0; }
    .cr-slip-actions { display: flex; gap: 8px; }
    .cr-slip-error-icon { font-size: 40px; color: #DC2626; }
    .cr-slip-spinner { width: 32px; height: 32px; border: 3px solid #e5e7eb; border-top-color: #7A1F2B;
      border-radius: 50%; animation: cr-slip-spin .8s linear infinite; }
    @keyframes cr-slip-spin { to { transform: rotate(360deg); } }

    @media (max-width: 520px) {
      .cr-slip-body { padding: 16px; }
      .cr-slip-row { grid-template-columns: 1fr; gap: 0; }
      .cr-slip-watermark { font-size: 56px; }
    }

    /* Print: only the slip, full width, no chrome. Scoped to body.cr-slip-open so
       printing the page normally (slip closed) is completely unaffected. */
    @media print {
      @page { margin: 12mm; }
      body.cr-slip-open > *:not(#${ROOT_ID}) { display: none !important; }
      body.cr-slip-open aside, body.cr-slip-open header { display: none !important; }
      body.cr-slip-open { height: auto !important; min-height: 0 !important;
        overflow: visible !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
      body.cr-slip-open #${ROOT_ID} { position: static !important; display: block !important; overflow: visible !important;
        background: none !important; padding: 0 !important; }
      body.cr-slip-open .cr-slip-shell { max-width: none !important; margin: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
      body.cr-slip-open .cr-slip-toolbar { display: none !important; }
      body.cr-slip-open .cr-slip-body { padding: 0 !important; font-size: 12px; }
      body.cr-slip-open .cr-slip-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;

  function ensureDom() {
    if (root) return;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    root = document.createElement('div');
    root.id = ROOT_ID;
    root.className = 'cr-slip-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'crSlipToolbarTitle');
    root.innerHTML = `
      <div class="cr-slip-shell">
        <div class="cr-slip-toolbar">
          <h2 class="cr-slip-toolbar-title" id="crSlipToolbarTitle">
            <span class="material-symbols-outlined" aria-hidden="true">receipt_long</span>
            <span>Confirmation Slip</span>
          </h2>
          <div class="cr-slip-toolbar-actions">
            <button type="button" class="cr-slip-btn cr-slip-btn-primary" data-cr-slip="print" disabled>
              <span class="material-symbols-outlined" aria-hidden="true">print</span><span>Print</span>
            </button>
            <button type="button" class="cr-slip-btn" data-cr-slip="close" aria-label="Close confirmation slip">
              <span class="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </div>
        </div>
        <div class="cr-slip-body" id="crSlipBody" aria-live="polite"></div>
      </div>`;
    document.body.appendChild(root);

    bodyEl = root.querySelector('#crSlipBody');
    printBtn = root.querySelector('[data-cr-slip="print"]');

    // Buttons (delegated, so they keep working when the body is re-rendered).
    root.addEventListener('click', (event) => {
      const control = event.target.closest('[data-cr-slip]');
      if (!control || control.disabled) return;
      switch (control.dataset.crSlip) {
        case 'print': print(); break;
        case 'close': close(); break;
        case 'retry': if (state.currentId) load(state.currentId); break;
        default: break;
      }
    });

    // Click on the dimmed backdrop closes. Require the press to START on the
    // backdrop too, otherwise selecting text and releasing outside the card
    // would close the slip.
    let pressStartedOnBackdrop = false;
    root.addEventListener('mousedown', (event) => { pressStartedOnBackdrop = event.target === root; });
    root.addEventListener('click', (event) => {
      if (event.target === root && pressStartedOnBackdrop) close();
    });
  }

  // ---------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------

  function stampGenerated() {
    const stamp = document.getElementById('crSlipGenerated');
    if (stamp) stamp.textContent = generatedStamp();
  }

  async function load(reservationId) {
    const ticket = ++state.ticket;
    state.currentId = reservationId;
    state.reservation = null;
    printBtn.disabled = true;
    bodyEl.innerHTML = loadingHtml();

    try {
      const response = await fetch(BASE + 'api/reservations/' + encodeURIComponent(reservationId), {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });

      let json = null;
      try { json = await response.json(); } catch (_) { json = null; }

      if (ticket !== state.ticket) return; // a newer open() superseded this one

      if (response.status === 401) {
        bodyEl.innerHTML = errorHtml('Your session has expired. Please sign in again.', { retry: false, signIn: true });
        return;
      }

      if (!response.ok || !json || json.success === false || !json.data) {
        bodyEl.innerHTML = errorHtml((json && json.error) || `Could not load the slip (HTTP ${response.status}).`);
        return;
      }

      state.reservation = json.data;
      bodyEl.innerHTML = slipHtml(json.data);
      printBtn.disabled = false;
    } catch (error) {
      console.error('[slip] failed to load reservation', reservationId, error);
      if (ticket !== state.ticket) return;
      bodyEl.innerHTML = errorHtml('Network error. Check that the server is reachable.');
    }
  }

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------

  function isOpen() {
    return !!root && root.classList.contains('is-open');
  }

  function open(reservationId) {
    const id = String(reservationId ?? '').trim();
    if (!id) return;

    ensureDom();

    if (!isOpen()) {
      state.returnFocusTo = document.activeElement;
      root.classList.add('is-open');
      document.body.classList.add(OPEN_CLASS);
      root.scrollTop = 0;
      root.querySelector('[data-cr-slip="close"]').focus();
    }

    load(id);
  }

  function close() {
    if (!isOpen()) return;
    state.ticket++; // discard any in-flight response
    state.reservation = null;
    state.currentId = null;
    root.classList.remove('is-open');
    document.body.classList.remove(OPEN_CLASS);
    bodyEl.innerHTML = '';
    if (state.returnFocusTo && typeof state.returnFocusTo.focus === 'function') {
      state.returnFocusTo.focus();
    }
    state.returnFocusTo = null;
  }

  function print() {
    if (!isOpen() || !state.reservation) return;
    window.print();
  }

  // Keep "Generated …" honest and name the saved PDF after the permit, for
  // both the Print button and Ctrl/Cmd+P.
  window.addEventListener('beforeprint', () => {
    if (!isOpen() || !state.reservation) return;
    stampGenerated();
    state.titleBeforePrint = document.title;
    document.title = `CampusRoom slip ${permitRef(state.reservation.reservation_id)}`;
  });
  window.addEventListener('afterprint', () => {
    if (state.titleBeforePrint !== null) {
      document.title = state.titleBeforePrint;
      state.titleBeforePrint = null;
    }
  });

  document.addEventListener('keydown', (event) => {
    if (!isOpen()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    // Keep Tab inside the dialog.
    if (event.key === 'Tab') {
      const focusable = Array.from(root.querySelectorAll('button:not([disabled]), a[href]'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!root.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  window.CampusRoomSlip = Object.freeze({ open, close, print });
})();
