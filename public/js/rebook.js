/**
 * CampusRoom — Re-book component (shared, Section 14)
 *
 * One file, two entry points, because the two pages need different UX:
 *
 *   window.CampusRoomRebook.start(reservationId)
 *       Customer path (plan Option A). Navigates to
 *       book-room.html?rebook={id}; booking.js does the prefill. Reuses the
 *       real booking form, its calendar, and its validation messaging.
 *
 *   window.CampusRoomRebook.openStaffModal(reservationId, { onSuccess })
 *       Staff/Admin path (plan Option B). A self-contained modal, so the
 *       operator never navigates away from the dispatch terminal. Also the
 *       only way staff CAN re-book: POST /api/reservations is Customer-only.
 *
 *   window.CampusRoomRebook.close()
 *
 * Load order on a page:
 *   <script src="js/util.js"></script>   (escapeHtml)
 *   <script src="js/rebook.js"></script>
 *   <script src="js/<page>.js"></script>
 *
 * Design notes
 *   - Both paths POST to api/reservations/{id}/rebook (Section 7), so the
 *     "new booking belongs to the ORIGINAL requester" rule lives in exactly
 *     one place — the controller — and is never re-implemented here.
 *   - The room dropdown hides rooms under Maintenance. GET api/rooms already
 *     filters is_active = 0 server-side (RoomRepository::findAllActive), and
 *     this filters again anyway rather than trusting that from the client.
 *     Hiding a room is a courtesy, not a control: ReservationValidator's
 *     step 0 is the authority and still answers 409 if the room is forced
 *     through the API.
 *   - The client-side pre-checks below (Sunday / business hours / end after
 *     start) mirror ReservationValidator so the operator gets instant
 *     feedback. They are a CONVENIENCE ONLY. Every server 409 is rendered
 *     verbatim — those strings are already written for end users.
 *   - The availability hint reuses the same GET api/rooms/{id}/calendar
 *     endpoint roomCalendar.js uses, but renders one day as a list rather
 *     than instantiating RoomCalendar: that class renders a fixed
 *     Monday–Sunday grid into a 500px-tall container, which does not fit
 *     inside this modal and cannot be scoped to a single day.
 *   - Timestamps from the API are zone-less Asia/Manila wall-clock strings
 *     (Section 9). They are read literally, never through the viewer's
 *     device timezone — same convention as slip.js and logArchive.js.
 *   - Builds its own DOM and injects its own <style>, so a host page needs
 *     nothing but the two script tags.
 */
(function () {
  'use strict';

  if (!window.CampusRoomUtil) {
    console.error('[rebook] js/util.js must be loaded before js/rebook.js');
    return;
  }

  const { escapeHtml } = window.CampusRoomUtil;
  const BASE = window.location.pathname.replace(/[^\/]*$/, '');

  const STYLE_ID = 'crRebookStyles';
  const ROOT_ID = 'crRebookRoot';
  const OPEN_CLASS = 'cr-rebook-open';

  // Mirrors ReservationValidator's business-hours window (07:30–21:00).
  const DAY_OPENS = '07:30';
  const DAY_CLOSES = '21:00';

  const state = {
    ticket: 0,          // bumped per load so a slow, stale response cannot overwrite a newer one
    source: null,       // the reservation being cloned
    rooms: [],          // bookable rooms only
    submitting: false,
    hintTicket: 0,
    dayData: null,      // { roomId, date, data } — the schedule the availability hint is showing
    onSuccess: null,
    returnFocusTo: null
  };

  let root = null;
  let bodyEl = null;

  // ---------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------

  const DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

  /** Split a DB DATETIME into its literal wall-clock parts. No timezone maths. */
  function parts(value) {
    const m = DATETIME_PATTERN.exec(String(value ?? ''));
    if (!m) return null;
    return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
  }

  /** "2026-03-11 09:00:00" -> "Mar 11, 2026". Formatted as UTC so the device zone can't shift it. */
  function formatDay(value) {
    const p = parts(value);
    if (!p) return '—';
    const [y, mo, d] = p.date.split('-').map(Number);
    return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString('en-US', {
      timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric'
    });
  }

  /** "09:00" or "09:00:00" -> "9:00 AM". */
  function formatClock(hhmm) {
    const m = /^(\d{2}):(\d{2})/.exec(String(hhmm ?? ''));
    if (!m) return '—';
    return new Date(Date.UTC(2000, 0, 1, +m[1], +m[2])).toLocaleTimeString('en-US', {
      timeZone: 'UTC', hour: 'numeric', minute: '2-digit'
    });
  }

  function formatTime(value) {
    const p = parts(value);
    return p ? formatClock(p.time) : '—';
  }

  function permitRef(id) {
    return 'REQ-' + String(id ?? '').substring(0, 8).toUpperCase();
  }

  /** "HH:MM" -> minutes past midnight, or null. */
  function toMinutes(hhmm) {
    const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm ?? ''));
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  }

  function fromMinutes(total) {
    const clamped = Math.max(0, Math.min(24 * 60 - 1, total));
    return String(Math.floor(clamped / 60)).padStart(2, '0') + ':' + String(clamped % 60).padStart(2, '0');
  }

  /** Day name for a plain YYYY-MM-DD, computed in UTC so it never drifts a day. */
  function dayName(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? ''));
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', {
      timeZone: 'UTC', weekday: 'long'
    });
  }

  function todayYmd() {
    const now = new Date();
    return now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
  }

  /**
   * Fetch wrapper. Always resolves; mirrors staff-queue.js's api() so a 409's
   * body is still read and surfaced rather than thrown away with the status.
   */
  async function api(path, options = {}) {
    try {
      const response = await fetch(BASE + path, {
        credentials: 'same-origin',
        headers: options.body ? { 'Content-Type': 'application/json' } : {},
        ...options
      });

      let json = null;
      try { json = await response.json(); } catch (_) { json = null; }

      if (!response.ok || !json || json.success === false) {
        return {
          ok: false,
          status: response.status,
          error: (json && json.error) || `Request failed (HTTP ${response.status}).`
        };
      }
      return { ok: true, status: response.status, data: json.data };
    } catch (error) {
      console.error('[rebook] network error:', path, error);
      return { ok: false, status: 0, error: 'Network error. Check that the server is reachable.' };
    }
  }

  // ---------------------------------------------------------------
  // Customer path (Option A)
  // ---------------------------------------------------------------

  function start(reservationId) {
    const id = String(reservationId ?? '').trim();
    if (!id) return;
    window.location.href = 'book-room.html?rebook=' + encodeURIComponent(id);
  }

  // ---------------------------------------------------------------
  // Staff path (Option B) — modal
  // ---------------------------------------------------------------

  function openStaffModal(reservationId, options = {}) {
    const id = String(reservationId ?? '').trim();
    if (!id) return;

    ensureDom();
    state.onSuccess = typeof options.onSuccess === 'function' ? options.onSuccess : null;
    state.returnFocusTo = document.activeElement;
    state.source = null;
    state.rooms = [];
    state.submitting = false;

    show();
    renderLoading();
    load(id);
  }

  async function load(reservationId) {
    const ticket = ++state.ticket;

    const [source, rooms] = await Promise.all([
      api('api/reservations/' + encodeURIComponent(reservationId)),
      api('api/rooms')
    ]);

    if (ticket !== state.ticket) return; // a newer open() won

    if (!source.ok) {
      renderError(source.error, reservationId);
      return;
    }
    if (!rooms.ok) {
      renderError(rooms.error, reservationId);
      return;
    }

    state.source = source.data;

    // Defence in depth: the endpoint already excludes is_active = 0.
    state.rooms = (rooms.data || []).filter(
      (room) => room.status !== 'Maintenance' && String(room.is_active) !== '0' && room.is_active !== false
    );

    renderForm();
  }

  // ---------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------

  function renderLoading() {
    bodyEl.innerHTML = `
      <div class="cr-rebook-state">
        <div class="cr-rebook-spinner" role="status" aria-label="Loading"></div>
        <p>Loading the source booking…</p>
      </div>`;
  }

  function renderError(message, reservationId) {
    bodyEl.innerHTML = `
      <div class="cr-rebook-state">
        <span class="material-symbols-outlined cr-rebook-error-icon" aria-hidden="true">error</span>
        <p>${escapeHtml(message)}</p>
        <button type="button" class="cr-rebook-btn cr-rebook-btn-primary" data-cr-rebook="retry"
                data-id="${escapeHtml(reservationId)}">Try again</button>
      </div>`;
  }

  function roomOptionLabel(room) {
    const meta = [];
    if (room.room_type) meta.push(room.room_type);
    if (room.floor !== null && room.floor !== undefined && room.floor !== '') meta.push('Floor ' + room.floor);
    if (room.capacity) meta.push(room.capacity + ' seats');
    return room.name + (meta.length ? ' (' + meta.join(' • ') + ')' : '');
  }

  function renderForm() {
    const source = state.source;
    const startParts = parts(source.start_time);
    const endParts = parts(source.end_time);

    // Default the new booking to the source booking's length.
    const sourceStartMin = startParts ? toMinutes(startParts.time) : null;
    const sourceEndMin = endParts ? toMinutes(endParts.time) : null;
    const defaultStart = startParts ? startParts.time : '';
    const defaultEnd = endParts ? endParts.time : '';

    const sourceRoomStillBookable = state.rooms.some((room) => room.room_id === source.room_id);

    const roomOptions = state.rooms.map((room) => `
      <option value="${escapeHtml(room.room_id)}"${room.room_id === source.room_id ? ' selected' : ''}>
        ${escapeHtml(roomOptionLabel(room))}
      </option>`).join('');

    const noRooms = state.rooms.length === 0;

    bodyEl.innerHTML = `
      <section class="cr-rebook-source" aria-label="Source booking">
        <div class="cr-rebook-source-head">
          <span class="material-symbols-outlined" aria-hidden="true">history</span>
          <span>Re-booking from <strong>${escapeHtml(permitRef(source.reservation_id))}</strong></span>
          <span class="cr-rebook-chip">${escapeHtml(source.status)}</span>
        </div>
        <dl class="cr-rebook-source-grid">
          <div><dt>Requester</dt><dd>${escapeHtml(source.customer_name || source.customer_email || '—')}</dd></div>
          <div><dt>Room</dt><dd>${escapeHtml(source.room_name || source.room_id || '—')}</dd></div>
          <div><dt>Original slot</dt><dd>${escapeHtml(formatDay(source.start_time))}, ${escapeHtml(formatTime(source.start_time))} – ${escapeHtml(formatTime(source.end_time))}</dd></div>
          <div><dt>Purpose</dt><dd>${escapeHtml(source.purpose || '—')}</dd></div>
        </dl>
        <p class="cr-rebook-note">
          The new booking is filed as <strong>Pending</strong> under the original requester, not under you.
        </p>
      </section>

      ${sourceRoomStillBookable ? '' : `
        <p class="cr-rebook-warn">
          <span class="material-symbols-outlined" aria-hidden="true">warning</span>
          <span>${escapeHtml(source.room_name || source.room_id || 'The original room')} is under maintenance or out of service, so it is not offered below. Pick another room.</span>
        </p>`}

      ${noRooms ? `
        <p class="cr-rebook-warn">
          <span class="material-symbols-outlined" aria-hidden="true">warning</span>
          <span>No bookable rooms are available right now. Every room is under maintenance or out of service.</span>
        </p>` : ''}

      <form class="cr-rebook-form" id="crRebookForm" novalidate>
        <div class="cr-rebook-row">
          <label class="cr-rebook-field cr-rebook-field-grow">
            <span>Room</span>
            <select id="crRebookRoom" ${noRooms ? 'disabled' : ''}>${roomOptions}</select>
          </label>
          <label class="cr-rebook-field">
            <span>Date</span>
            <input type="date" id="crRebookDate" min="${escapeHtml(todayYmd())}" ${noRooms ? 'disabled' : ''}>
          </label>
        </div>

        <div class="cr-rebook-row">
          <label class="cr-rebook-field">
            <span>Start time</span>
            <input type="time" id="crRebookStart" value="${escapeHtml(defaultStart)}"
                   min="${DAY_OPENS}" max="${DAY_CLOSES}" step="300" ${noRooms ? 'disabled' : ''}>
          </label>
          <label class="cr-rebook-field">
            <span>End time</span>
            <input type="time" id="crRebookEnd" value="${escapeHtml(defaultEnd)}"
                   min="${DAY_OPENS}" max="${DAY_CLOSES}" step="300" ${noRooms ? 'disabled' : ''}>
          </label>
          <p class="cr-rebook-hourshint">Campus hours ${formatClock(DAY_OPENS)} – ${formatClock(DAY_CLOSES)}, closed Sundays.</p>
        </div>

        <label class="cr-rebook-field cr-rebook-field-block">
          <span>Purpose</span>
          <textarea id="crRebookPurpose" rows="2" maxlength="255" ${noRooms ? 'disabled' : ''}>${escapeHtml(source.purpose || '')}</textarea>
        </label>

        <section class="cr-rebook-hint" id="crRebookHint" aria-live="polite">
          <h3><span class="material-symbols-outlined" aria-hidden="true">event_available</span> Availability</h3>
          <p class="cr-rebook-hint-empty">Pick a date to see what is already on this room that day.</p>
        </section>

        <p class="cr-rebook-error" id="crRebookError" role="alert" hidden></p>
      </form>`;

    // Duration carried from the source booking, so shifting the start keeps the length.
    bodyEl.dataset.duration =
      (sourceStartMin !== null && sourceEndMin !== null && sourceEndMin > sourceStartMin)
        ? String(sourceEndMin - sourceStartMin)
        : '';

    setFooter(noRooms);

    const dateInput = bodyEl.querySelector('#crRebookDate');
    const roomSelect = bodyEl.querySelector('#crRebookRoom');
    const startInput = bodyEl.querySelector('#crRebookStart');

    // Date is deliberately left blank — picking a new one is the whole point.
    if (dateInput) dateInput.addEventListener('change', () => { clearError(); loadHint(); });
    if (roomSelect) roomSelect.addEventListener('change', () => { clearError(); loadHint(); });
    if (startInput) startInput.addEventListener('change', () => { clearError(); shiftEndWithStart(); liveRangeCheck(); });
    const endInput = bodyEl.querySelector('#crRebookEnd');
    if (endInput) endInput.addEventListener('change', () => { clearError(); liveRangeCheck(); });

    if (dateInput && !noRooms) dateInput.focus();
  }

  /** Keep the source booking's duration when the operator moves the start time. */
  function shiftEndWithStart() {
    const duration = parseInt(bodyEl.dataset.duration || '', 10);
    if (!Number.isFinite(duration) || duration <= 0) return;

    const startInput = bodyEl.querySelector('#crRebookStart');
    const endInput = bodyEl.querySelector('#crRebookEnd');
    const startMin = startInput ? toMinutes(startInput.value) : null;
    if (startMin === null || !endInput) return;

    endInput.value = fromMinutes(startMin + duration);
    clearError();
  }

  function setFooter(disabled) {
    const footer = root.querySelector('#crRebookFooter');
    if (!footer) return;
    footer.innerHTML = `
      <button type="button" class="cr-rebook-btn" data-cr-rebook="close">Cancel</button>
      <button type="button" class="cr-rebook-btn cr-rebook-btn-primary" data-cr-rebook="submit"
              id="crRebookSubmit" ${disabled ? 'disabled' : ''}>
        <span class="material-symbols-outlined" aria-hidden="true">sync</span>
        <span id="crRebookSubmitLabel">Create Re-booking</span>
      </button>`;
  }

  // ---------------------------------------------------------------
  // Availability hint — same endpoint roomCalendar.js uses, one day only
  // ---------------------------------------------------------------

  async function loadHint() {
    const hintEl = bodyEl.querySelector('#crRebookHint');
    if (!hintEl) return;

    const roomId = bodyEl.querySelector('#crRebookRoom') ? bodyEl.querySelector('#crRebookRoom').value : '';
    const date = bodyEl.querySelector('#crRebookDate') ? bodyEl.querySelector('#crRebookDate').value : '';

    if (!roomId || !date) {
      hintEl.innerHTML = hintHeader() +
        '<p class="cr-rebook-hint-empty">Pick a date to see what is already on this room that day.</p>';
      return;
    }

    const ticket = ++state.hintTicket;
    state.dayData = null;   // the previous room/date's schedule no longer applies
    hintEl.innerHTML = hintHeader() + '<p class="cr-rebook-hint-empty">Checking that day…</p>';

    const result = await api(
      `api/rooms/${encodeURIComponent(roomId)}/calendar?start=${encodeURIComponent(date)}&end=${encodeURIComponent(date)}`
    );

    if (ticket !== state.hintTicket) return;

    if (!result.ok) {
      // A failed hint must never block the submit: the server validates anyway.
      hintEl.innerHTML = hintHeader() +
        `<p class="cr-rebook-hint-empty">Could not load that day (${escapeHtml(result.error)}). You can still submit — the server re-checks everything.</p>`;
      return;
    }

    state.dayData = { roomId, date, data: result.data };
    hintEl.innerHTML = hintHeader() + hintBody(result.data, date);

    // The times may already be filled in (carried over from the source
    // booking), so tell the operator right away if they don't fit this day.
    liveRangeCheck();
  }

  // ---------------------------------------------------------------
  // Range check — the requested start..end must be free for its WHOLE length
  // ---------------------------------------------------------------

  /**
   * '' when the selected range is free (or can't be checked yet), otherwise a
   * sentence naming the class / reservation / holiday it runs into. Uses the
   * schedule the availability hint already fetched; a convenience only, the
   * server's 409 remains the authority.
   */
  function rangeClash() {
    const Schedule = window.CampusSchedule;
    if (!Schedule || !state.dayData) return '';

    const roomId = value('#crRebookRoom');
    const date = value('#crRebookDate');
    if (state.dayData.roomId !== roomId || state.dayData.date !== date) return '';

    const startTime = value('#crRebookStart');
    const endTime = value('#crRebookEnd');
    const startMin = toMinutes(startTime);
    const endMin = toMinutes(endTime);
    if (startMin === null || endMin === null || endMin <= startMin) return '';

    return Schedule.describe(Schedule.findConflicts(state.dayData.data, date, startTime, endTime), startTime, endTime);
  }

  /**
   * Surface a range clash, never clear one: callers clear first when the
   * operator changes a field. (loadHint() also calls this after a failed
   * submit, and must not wipe the server's message when the range is fine.)
   */
  function liveRangeCheck() {
    const clash = rangeClash();
    if (clash) showError(clash);
  }

  function hintHeader() {
    return '<h3><span class="material-symbols-outlined" aria-hidden="true">event_available</span> Availability</h3>';
  }

  function hintBody(data, date) {
    const rows = [];

    const holiday = (data.holidays || []).find((h) => String(h.holiday_date).startsWith(date));
    if (holiday) {
      rows.push(hintRow('celebration', 'holiday', 'Campus holiday', holiday.name || 'Holiday'));
    }

    if (dayName(date) === 'Sunday') {
      rows.push(hintRow('do_not_disturb_on', 'holiday', 'Closed', 'BPU is closed on Sundays.'));
    }

    const weekday = dayName(date);
    (data.class_schedules || [])
      .filter((c) => c.day_of_week === weekday)
      .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))
      .forEach((c) => {
        rows.push(hintRow(
          'school', 'class',
          `${formatClock(c.start_time)} – ${formatClock(c.end_time)}`,
          `${c.course_code || 'Class'} ${c.section || ''}`.trim()
        ));
      });

    (data.reservations || [])
      .filter((r) => String(r.start_time).startsWith(date))
      .sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))
      .forEach((r) => {
        rows.push(hintRow(
          r.status === 'Pending' ? 'hourglass_top' : 'event_busy',
          r.status === 'Pending' ? 'pending' : 'booked',
          `${formatTime(r.start_time)} – ${formatTime(r.end_time)}`,
          `${r.status} — ${r.purpose || 'Reservation'} (${r.customer_name || 'requester'})`
        ));
      });

    if (rows.length === 0) {
      return `<p class="cr-rebook-hint-free">
        <span class="material-symbols-outlined" aria-hidden="true">check_circle</span>
        Nothing is booked on this room for ${escapeHtml(formatDay(date + ' 00:00'))}.
      </p>`;
    }

    return `<ul class="cr-rebook-hint-list">${rows.join('')}</ul>
      <p class="cr-rebook-hint-foot">Shown for guidance. The server re-checks everything on submit.</p>`;
  }

  function hintRow(icon, kind, when, what) {
    return `<li class="cr-rebook-hint-item cr-rebook-hint-${kind}">
      <span class="material-symbols-outlined" aria-hidden="true">${icon}</span>
      <span class="cr-rebook-hint-when">${escapeHtml(when)}</span>
      <span class="cr-rebook-hint-what">${escapeHtml(what)}</span>
    </li>`;
  }

  // ---------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------

  function showError(message) {
    const errorEl = bodyEl.querySelector('#crRebookError');
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.hidden = false;
    errorEl.scrollIntoView({ block: 'nearest' });
  }

  function clearError() {
    const errorEl = bodyEl.querySelector('#crRebookError');
    if (errorEl) errorEl.hidden = true;
  }

  async function submit() {
    if (state.submitting || !state.source) return;

    const roomId = value('#crRebookRoom');
    const date = value('#crRebookDate');
    const startTime = value('#crRebookStart');
    const endTime = value('#crRebookEnd');
    const purpose = value('#crRebookPurpose').trim();

    clearError();

    // Convenience pre-checks only. ReservationValidator remains the authority
    // and its 409 text is what the operator sees for anything below.
    if (!roomId) return showError('Select a room.');
    if (!date) return showError('Pick a date for the new booking.');
    if (!startTime || !endTime) return showError('Pick a start time and an end time.');
    if (dayName(date) === 'Sunday') return showError('BPU is closed on Sundays.');

    const startMin = toMinutes(startTime);
    const endMin = toMinutes(endTime);
    if (startMin === null || endMin === null) return showError('Enter the times as HH:MM.');
    if (endMin <= startMin) return showError('End time must be after start time.');
    if (startMin < toMinutes(DAY_OPENS) || endMin > toMinutes(DAY_CLOSES)) {
      return showError(`Reservations must be within business hours (${DAY_OPENS} – ${DAY_CLOSES}).`);
    }
    const clash = rangeClash();
    if (clash) return showError(clash);
    if (!purpose) return showError('Give the booking a purpose.');

    setSubmitting(true);

    // The endpoint falls back to the source row for anything blank, but the
    // source's notes could predate the 500-char rule and would then be
    // rejected — so send them explicitly, already trimmed to length.
    const equipmentNotes = String(state.source.equipment_notes || '').substring(0, 500);

    const result = await api(
      `api/reservations/${encodeURIComponent(state.source.reservation_id)}/rebook`,
      {
        method: 'POST',
        body: JSON.stringify({
          room_id: roomId,
          purpose: purpose,
          start_time: `${date}T${startTime}:00`,
          end_time: `${date}T${endTime}:00`,
          equipment_notes: equipmentNotes
        })
      }
    );

    setSubmitting(false);

    if (!result.ok) {
      if (result.status === 401) {
        window.location.href = 'index.html';
        return;
      }
      // 409s (holiday, class clash, maintenance, double-booking) arrive here
      // and are rendered verbatim — those strings are written for end users.
      showError(result.error);
      loadHint(); // the day may have changed under us; re-pull the blocks
      return;
    }

    const created = result.data || {};
    close();

    if (state.onSuccess) {
      state.onSuccess(created);
    } else {
      window.alert(`Re-booking filed as ${permitRef(created.reservation_id)}.`);
    }
  }

  function value(selector) {
    const node = bodyEl.querySelector(selector);
    return node ? String(node.value ?? '') : '';
  }

  function setSubmitting(isSubmitting) {
    state.submitting = isSubmitting;
    const button = root.querySelector('#crRebookSubmit');
    const label = root.querySelector('#crRebookSubmitLabel');
    if (button) button.disabled = isSubmitting;
    if (label) label.textContent = isSubmitting ? 'Filing…' : 'Create Re-booking';
  }

  // ---------------------------------------------------------------
  // Shell
  // ---------------------------------------------------------------

  const CSS = `
    .cr-rebook-root { display: none; position: fixed; inset: 0; z-index: 90; overflow-y: auto;
      overscroll-behavior: contain; background: rgba(0,0,0,.45); padding: 24px 12px;
      font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1a1c1e; }
    .cr-rebook-root.is-open { display: block; }
    .cr-rebook-root *, .cr-rebook-root *::before, .cr-rebook-root *::after { box-sizing: border-box; }
    body.${OPEN_CLASS} { overflow: hidden; }

    .cr-rebook-shell { position: relative; max-width: 720px; margin: 0 auto; background: #fff;
      border-radius: 12px; box-shadow: 0 20px 50px rgba(0,0,0,.3); overflow: hidden; }
    .cr-rebook-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 10px 16px; background: #f3f4f6; border-bottom: 1px solid #e1e2e4; }
    .cr-rebook-toolbar h2 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 15px; font-weight: 700; }
    .cr-rebook-close { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
      border: 0; border-radius: 6px; background: transparent; cursor: pointer; color: #374151; flex-shrink: 0; }
    .cr-rebook-close:hover { background: #e5e7eb; }
    .cr-rebook-close:focus-visible { outline: 2px solid #7A1F2B; outline-offset: 2px; }

    .cr-rebook-body { padding: 18px 20px; font-size: 14px; line-height: 1.45; max-height: 70vh; overflow-y: auto; }
    .cr-rebook-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px;
      background: #f9fafb; border-top: 1px solid #e5e7eb; }

    .cr-rebook-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 14px;
      font: 600 13px/1 Inter, system-ui, sans-serif; color: #1a1c1e; background: #e5e7eb; border: 0;
      border-radius: 6px; cursor: pointer; white-space: nowrap; }
    .cr-rebook-btn:hover { background: #d1d5db; }
    .cr-rebook-btn:focus-visible { outline: 2px solid #7A1F2B; outline-offset: 2px; }
    .cr-rebook-btn:disabled { opacity: .5; cursor: not-allowed; }
    .cr-rebook-btn-primary { background: #7A1F2B; color: #fff; }
    .cr-rebook-btn-primary:hover { background: #52131C; }
    .cr-rebook-btn .material-symbols-outlined { font-size: 16px; }

    .cr-rebook-source { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;
      padding: 12px 14px; margin-bottom: 14px; }
    .cr-rebook-source-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      font-size: 13px; margin-bottom: 10px; }
    .cr-rebook-source-head .material-symbols-outlined { font-size: 18px; color: #6b7280; }
    .cr-rebook-chip { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
      background: #e5e7eb; color: #374151; padding: 2px 8px; border-radius: 999px; }
    .cr-rebook-source-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px 16px; margin: 0; }
    .cr-rebook-source-grid dt { font-size: 11px; font-weight: 700; letter-spacing: .04em;
      text-transform: uppercase; color: #6b7280; }
    .cr-rebook-source-grid dd { margin: 1px 0 0; font-size: 13px; overflow-wrap: anywhere; }
    .cr-rebook-note { margin: 10px 0 0; font-size: 12px; color: #6b7280; }

    .cr-rebook-warn { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 14px;
      padding: 10px 12px; font-size: 13px; background: #FEF3C7; color: #92400E;
      border-left: 4px solid #F59E0B; border-radius: 6px; }
    .cr-rebook-warn .material-symbols-outlined { font-size: 18px; flex-shrink: 0; }

    .cr-rebook-form { display: flex; flex-direction: column; gap: 12px; }
    .cr-rebook-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; }
    .cr-rebook-field { display: flex; flex-direction: column; gap: 3px; font-size: 11px; font-weight: 700;
      letter-spacing: .04em; text-transform: uppercase; color: #6b7280; }
    .cr-rebook-field-grow { flex: 1 1 260px; }
    .cr-rebook-field-block { width: 100%; }
    .cr-rebook-field input, .cr-rebook-field select, .cr-rebook-field textarea {
      font: 500 13px/1.3 Inter, system-ui, sans-serif; color: #1a1c1e; padding: 8px;
      border: 1px solid #d1d5db; border-radius: 6px; background: #fff; min-width: 0; width: 100%; }
    .cr-rebook-field textarea { resize: vertical; }
    .cr-rebook-field input:focus, .cr-rebook-field select:focus, .cr-rebook-field textarea:focus {
      outline: 2px solid #7A1F2B; outline-offset: 1px; }
    .cr-rebook-field input:disabled, .cr-rebook-field select:disabled, .cr-rebook-field textarea:disabled {
      background: #f3f4f6; color: #9ca3af; }
    .cr-rebook-hourshint { flex: 1 1 100%; margin: -4px 0 0; font-size: 12px; font-weight: 500;
      text-transform: none; letter-spacing: 0; color: #6b7280; }

    .cr-rebook-hint { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px 12px; }
    .cr-rebook-hint h3 { display: flex; align-items: center; gap: 6px; margin: 0 0 8px;
      font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #6b7280; }
    .cr-rebook-hint h3 .material-symbols-outlined { font-size: 16px; }
    .cr-rebook-hint-empty { margin: 0; font-size: 13px; color: #6b7280; }
    .cr-rebook-hint-free { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 13px; color: #15803D; }
    .cr-rebook-hint-free .material-symbols-outlined { font-size: 18px; }
    .cr-rebook-hint-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .cr-rebook-hint-item { display: flex; align-items: baseline; gap: 8px; font-size: 13px; }
    .cr-rebook-hint-item .material-symbols-outlined { font-size: 16px; align-self: center; }
    .cr-rebook-hint-when { font-weight: 700; white-space: nowrap; }
    .cr-rebook-hint-what { color: #374151; overflow-wrap: anywhere; }
    .cr-rebook-hint-class { color: #1D4ED8; }
    .cr-rebook-hint-booked { color: #15803D; }
    .cr-rebook-hint-pending { color: #B45309; }
    .cr-rebook-hint-holiday { color: #6b7280; }
    .cr-rebook-hint-foot { margin: 8px 0 0; font-size: 12px; color: #9ca3af; }

    .cr-rebook-error { margin: 0; padding: 10px 12px; font-size: 13px; font-weight: 600;
      background: #FEE2E2; color: #B91C1C; border-left: 4px solid #DC2626; border-radius: 6px; }

    .cr-rebook-state { display: flex; flex-direction: column; align-items: center; gap: 12px;
      padding: 44px 16px; text-align: center; color: #374151; }
    .cr-rebook-state p { margin: 0; }
    .cr-rebook-error-icon { font-size: 40px; color: #DC2626; }
    .cr-rebook-spinner { width: 32px; height: 32px; border: 3px solid #e5e7eb; border-top-color: #7A1F2B;
      border-radius: 50%; animation: cr-rebook-spin .8s linear infinite; }
    @keyframes cr-rebook-spin { to { transform: rotate(360deg); } }

    @media (max-width: 640px) {
      .cr-rebook-body { padding: 14px; }
      .cr-rebook-source-grid { grid-template-columns: minmax(0, 1fr); }
      .cr-rebook-field { flex: 1 1 100%; }
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
    root.className = 'cr-rebook-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'crRebookTitle');
    root.innerHTML = `
      <div class="cr-rebook-shell">
        <div class="cr-rebook-toolbar">
          <h2 id="crRebookTitle">
            <span class="material-symbols-outlined" aria-hidden="true">sync</span>
            <span>Re-book Space</span>
          </h2>
          <button type="button" class="cr-rebook-close" data-cr-rebook="close" aria-label="Close re-book dialog">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
        <div class="cr-rebook-body" id="crRebookBody"></div>
        <div class="cr-rebook-footer" id="crRebookFooter"></div>
      </div>`;
    document.body.appendChild(root);

    bodyEl = root.querySelector('#crRebookBody');

    root.addEventListener('click', (event) => {
      // Click on the backdrop itself closes; clicks inside the shell do not.
      if (event.target === root) {
        close();
        return;
      }
      const control = event.target.closest('[data-cr-rebook]');
      if (!control || control.disabled) return;
      switch (control.dataset.crRebook) {
        case 'close': close(); break;
        case 'submit': submit(); break;
        case 'retry': openStaffModal(control.dataset.id, { onSuccess: state.onSuccess }); break;
        default: break;
      }
    });

    // Enter submits from any single-line field, matching the other modals.
    root.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const target = event.target;
      if (!target || target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') return;
      event.preventDefault();
      submit();
    });
  }

  function isOpen() {
    return !!root && root.classList.contains('is-open');
  }

  function show() {
    root.classList.add('is-open');
    document.body.classList.add(OPEN_CLASS);
    root.scrollTop = 0;
    const closeBtn = root.querySelector('[data-cr-rebook="close"]');
    if (closeBtn) closeBtn.focus();
  }

  function close() {
    if (!isOpen()) return;
    state.ticket++;     // discard any in-flight response
    state.hintTicket++;
    root.classList.remove('is-open');
    document.body.classList.remove(OPEN_CLASS);
    bodyEl.innerHTML = '';
    const footer = root.querySelector('#crRebookFooter');
    if (footer) footer.innerHTML = '';
    state.source = null;
    state.rooms = [];
    state.dayData = null;
    state.submitting = false;
    if (state.returnFocusTo && typeof state.returnFocusTo.focus === 'function') {
      state.returnFocusTo.focus();
    }
    state.returnFocusTo = null;
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) {
      event.preventDefault();
      close();
    }
  });

  window.CampusRoomRebook = Object.freeze({ start, openStaffModal, close });
})();
