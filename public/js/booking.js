/**
 * CampusRoom — Facility Reservation Logic
 * Enforces MySQL overlap-prevention trigger, field validation, and reservation dispatch.
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const BASE = window.location.pathname.replace(/[^\/]*$/, '');

  const form = document.getElementById('roomReservationForm');
  const roomSelect = document.getElementById('roomSelect');
  const resDateInput = document.getElementById('resDate');
  const startTimeInput = document.getElementById('startTime');
  const endTimeInput = document.getElementById('endTime');
  const purposeInput = document.getElementById('purpose');
  const errorBanner = document.getElementById('collisionErrorBanner');
  const errorBannerText = document.getElementById('collisionErrorText');
  const successBanner = document.getElementById('bookingSuccessBanner');
  const successBannerText = document.getElementById('bookingSuccessText');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');
  const submitBtn = document.querySelector('button[type="submit"][form="roomReservationForm"]');
  const errorBannerTitle = document.getElementById('collisionErrorTitle');

  function navigateBack() {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = 'dashboard.html';
    }
  }

  if (closeModalBtn) closeModalBtn.addEventListener('click', navigateBack);
  if (cancelModalBtn) cancelModalBtn.addEventListener('click', navigateBack);

  // Read query parameters (e.g. ?room_id=..., ?rebook={reservation_id})
  // `room_id` is the current name used by rooms.js's "Book This Room" link;
  // `room` is kept so old/bookmarked links still work (see Fix Guide 1.1).
  const urlParams = new URLSearchParams(window.location.search);
  const preselectedRoom = urlParams.get('room_id') || urlParams.get('room');

  // Section 14, Option A: my-reservations.html sends the customer here with
  // ?rebook={id}. The form is prefilled from that booking and submits to
  // POST api/reservations/{id}/rebook instead of POST api/reservations, so
  // the "new booking belongs to the original requester" rule stays in the
  // controller and is never re-decided on the client.
  const rebookId = (urlParams.get('rebook') || '').trim();
  const isRebook = rebookId !== '';
  let rebookSource = null;
  let rebookTimesCarried = false;

  const rebookNotice        = document.getElementById('rebookNoticeBanner');
  const rebookNoticeTitle   = document.getElementById('rebookNoticeTitle');
  const rebookNoticeText    = document.getElementById('rebookNoticeText');
  const rebookNoticeDismiss = document.getElementById('rebookNoticeDismiss');

  function showRebookNotice(title, message) {
    if (!rebookNotice) return;
    if (rebookNoticeTitle) rebookNoticeTitle.textContent = title;
    if (rebookNoticeText) rebookNoticeText.textContent = message;
    rebookNotice.classList.remove('hidden');
    rebookNotice.classList.add('flex');
  }

  if (rebookNoticeDismiss && rebookNotice) {
    rebookNoticeDismiss.addEventListener('click', () => {
      rebookNotice.classList.add('hidden');
      rebookNotice.classList.remove('flex');
    });
  }

  // Rooms loaded from the API, keyed by room_id (Fix Guide 1.2).
  const roomsById = {};

  // Resolves once the room <option>s exist, so the re-book prefill below can
  // select the source room instead of racing the fetch.
  let roomsReady = Promise.resolve();

  if (roomSelect) {
    roomsReady = fetch(BASE + 'api/rooms', { credentials: 'same-origin' })
      .then(res => res.json())
      .then(json => {
        if (!json.success || !Array.isArray(json.data)) {
          throw new Error(json.error || 'Could not load rooms.');
        }

        roomSelect.innerHTML = '<option value="">Select a room</option>';
        json.data.forEach(r => {
          roomsById[r.room_id] = r;
          const opt = document.createElement('option');
          opt.value = r.room_id;
          opt.textContent = `${r.name} (${r.room_type || 'General'} • ${r.capacity} seats)`;
          if (r.status === 'Maintenance') {
            opt.textContent += ' [Under Maintenance]';
            opt.disabled = true;
          }
          roomSelect.appendChild(opt);
        });

        // Only preselect a room that exists and is bookable.
        const wanted = preselectedRoom && roomsById[preselectedRoom];
        if (wanted && wanted.status !== 'Maintenance') {
          roomSelect.value = preselectedRoom;
        }

        renderRoomSummary(roomSelect.value);
        if (roomSelect.value) updateCalendar(roomSelect.value);
        syncEndOptions();
        markTakenSlots();
      })
      .catch(err => {
        console.error('Error fetching rooms:', err);
        roomSelect.innerHTML = '<option value="">Could not load rooms</option>';
        renderRoomSummary('');
        showCollisionError('We couldn’t load the room list. Please refresh the page.', 'Unable to load rooms');
        if (submitBtn) submitBtn.disabled = true;
      });
  }

  // --- Section 2: content that should reflect the selected room/date, not
  // a hardcoded sample room. ---

  function renderRoomSummary(roomId) {
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const r = roomsById[roomId];
    if (!r) {
      set('roomHeading', 'Reserve Academic Space');
      ['roomPillName', 'roomPillSeats', 'roomPillType', 'roomFloor', 'capacityHint'].forEach(id => set(id, ''));
      return;
    }
    set('roomHeading', `Reserve Academic Space — ${r.name}`);
    set('roomPillName', r.name);
    set('roomPillSeats', `${r.capacity} seats`);
    set('roomPillType', r.room_type || 'General');
    set('roomFloor', r.floor != null ? `Floor ${r.floor}` : '');
    set('capacityHint', `Room capacity: ${r.capacity}`);
  }

  // Academic year chip: computed from today's date rather than hardcoded.
  // AY runs June–May; First Semester (Jun–Oct), Second Semester (Nov–Mar),
  // Summer/Midyear (Apr–May). Adjust to the institution's actual calendar
  // if this doesn't match BPU's term structure.
  function renderAcademicYearChip() {
    const el = document.getElementById('ayChip');
    if (!el) return;
    const now = new Date();
    const month = now.getMonth() + 1; // 1-12
    const startYear = month >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    const semester = (month >= 6 && month <= 10) ? 'First Semester'
      : (month >= 11 || month <= 3) ? 'Second Semester'
      : 'Midyear Term';
    el.textContent = `AY ${startYear}-${startYear + 1} • ${semester}`;
  }
  renderAcademicYearChip();

  // --- Room Calendar Integration ---
  let calendarInstance = null;
  function updateCalendar(roomId) {
    if (!roomId) return;
    // Fix Guide 4.4: refresh in place for the same room instead of tearing
    // down and rebuilding the whole component (which also resets the
    // student back to the current week if they had navigated elsewhere).
    if (calendarInstance && calendarInstance.roomId === roomId) {
      calendarInstance.goToDate(resDateInput ? resDateInput.value : '', true);
      return;
    }
    const container = document.getElementById('room-calendar-container');
    if (container) {
      if (typeof RoomCalendar !== 'undefined') {
        calendarInstance = new RoomCalendar({
          containerId: 'room-calendar-container',
          roomId: roomId,
          initialDate: resDateInput ? resDateInput.value : '',
          minDate: resDateInput ? resDateInput.min : ''
        });
      }
    }
  }

  if (roomSelect) {
    roomSelect.addEventListener('change', (e) => {
      renderRoomSummary(e.target.value);
      updateCalendar(e.target.value);
    });
  }

  // --- Dates: local-time helpers (Fix Guide 1.5) ---
  function toYMD(d) {
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  // Earliest bookable day: tomorrow, skipping Sunday.
  function earliestOpenDay() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    if (d.getDay() === 0) d.setDate(d.getDate() + 1);
    return d;
  }

  if (resDateInput) {
    resDateInput.min = toYMD(earliestOpenDay());
    // A re-booking deliberately starts with a blank date.
    if (!resDateInput.value && !isRebook) {
      resDateInput.value = toYMD(earliestOpenDay());
    }
  }

  const dateError = document.getElementById('dateError');

  function setDateError(message) {
    if (dateError) {
      dateError.textContent = message;
      dateError.classList.toggle('hidden', !message);
    }
    if (resDateInput) resDateInput.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  /** '' when the date can be booked, otherwise the reason it can't. */
  function dateProblem(value) {
    if (!value) return '';
    if (new Date(value + 'T00:00:00').getDay() === 0) {          // local, not UTC
      return 'Sundays are not available for reservation. Please pick another day.';
    }
    if (resDateInput && resDateInput.min && value < resDateInput.min) {
      return 'Bookings open starting tomorrow. Please pick a later date.';
    }
    return '';
  }

  // While a date is being typed the browser fires "change" for every valid
  // intermediate value (year 0002, 0020, 0202, then 2026). Only act on a real year.
  function isRealDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 2000;
  }

  if (resDateInput) {
    resDateInput.addEventListener('change', () => {
      const value = resDateInput.value;
      if (!isRealDate(value)) { setDateError(''); return; }
      setDateError(dateProblem(value));                 // message only; never wipe what they typed
      if (calendarInstance) calendarInstance.goToDate(value);
      markTakenSlots();
    });
  }

  // The visible calendar button (the browser's own icon is hidden in components.css).
  const openPickerBtn = document.getElementById('openDatePickerBtn');
  if (openPickerBtn && resDateInput) {
    openPickerBtn.addEventListener('click', () => {
      resDateInput.focus();
      if (typeof resDateInput.showPicker === 'function') {
        try { resDateInput.showPicker(); } catch (_) { /* no user gesture; focus() is the fallback */ }
      }
    });
  }

  const timeErrorContainer = document.getElementById('timeErrorContainer');
  const timeErrorText = document.getElementById('timeErrorText');
  const validateTime = () => {
    if (startTimeInput && endTimeInput && startTimeInput.value && endTimeInput.value) {
      if (endTimeInput.value <= startTimeInput.value) {
        timeErrorContainer.classList.remove('hidden');
        timeErrorContainer.classList.add('flex');
        timeErrorText.textContent = 'End time must be after start time.';
        return false;
      } else {
        timeErrorContainer.classList.add('hidden');
        timeErrorContainer.classList.remove('flex');
        return true;
      }
    }
    return true;
  };

  if (endTimeInput) endTimeInput.addEventListener('change', validateTime);

  // The chosen room's schedule for the chosen date, from the last successful
  // calendar fetch (see markTakenSlots). null until it arrives, and whenever it
  // is for a different room/date than the form now shows.
  let dayData = null;   // { roomId, date, data }

  /**
   * Conflicts for the whole range [start, end): a class, another reservation
   * or a holiday that shares any minute with it. Empty when the range is free
   * OR when the schedule isn't loaded yet — the server re-checks either way.
   */
  function rangeConflicts(start, end) {
    if (!dayData || !start || !end) return [];
    if (!roomSelect || !resDateInput) return [];
    if (dayData.roomId !== roomSelect.value || dayData.date !== resDateInput.value) return [];
    return window.CampusSchedule.findConflicts(dayData.data, dayData.date, start, end);
  }

  // ---------------------------------------------------------------
  // 3.1: end-time options depend on the chosen start time, so a student
  // can't pick an end that's already before/equal to the start, or one that
  // would stretch the booking across a class or another reservation.
  // ---------------------------------------------------------------
  let syncEndOptions = () => {};
  if (startTimeInput && endTimeInput) {
    const ALL_END_OPTIONS = Array.from(endTimeInput.options)
      .filter(o => o.value)
      .map(o => ({ value: o.value, text: o.textContent }));

    syncEndOptions = () => {
      const start = startTimeInput.value;
      const previous = endTimeInput.value;
      endTimeInput.innerHTML = '<option value="">Select End</option>';
      ALL_END_OPTIONS
        .filter(o => !start || o.value > start)          // "HH:MM" strings compare correctly
        .forEach(o => {
          const opt = document.createElement('option');
          opt.value = o.value;
          opt.textContent = o.text;
          // Start is free, but is [start, this end) free? A 07:30 start is fine
          // while a class at 10:30 makes every end after 10:30 unusable.
          const clash = rangeConflicts(start, o.value);
          if (clash.length) {
            opt.disabled = true;
            opt.textContent = o.text + ' — unavailable';
            opt.title = window.CampusSchedule.describe(clash, start, o.value);
          }
          endTimeInput.appendChild(opt);
        });
      // Keep the previous end only if it is still offered AND still usable.
      const keep = Array.from(endTimeInput.options).find(o => o.value === previous);
      if (previous && previous > start && keep && !keep.disabled) endTimeInput.value = previous;
    };

    startTimeInput.addEventListener('change', () => { syncEndOptions(); validateTime(); });
  }

  // ---------------------------------------------------------------
  // 3.3: grey out start-time blocks that are already taken by another
  // reservation, a class, or a holiday, so the student finds out before
  // submitting instead of after. The server remains the source of truth;
  // this is a convenience layer, so failures are swallowed.
  // ---------------------------------------------------------------
  const BLOCKS = ['07:30','09:00','10:30','12:00','13:30','15:00','16:30','18:00','19:30','21:00'];

  if (startTimeInput) {
    // remember each option's original label once
    Array.from(startTimeInput.options).forEach(o => { o.dataset.label = o.textContent; });
  }

  function resetStartOptions() {
    Array.from(startTimeInput.options).forEach(opt => {
      if (!opt.value) return;
      opt.disabled = false;
      opt.textContent = opt.dataset.label;
    });
  }

  let takenSeq = 0;
  async function markTakenSlots() {
    if (!startTimeInput || !roomSelect || !resDateInput) return;
    const roomId = roomSelect.value, d = resDateInput.value;
    if (!roomId || !isRealDate(d)) return;
    const seq = ++takenSeq;
    dayData = null;   // whatever we knew belongs to the previous room/date

    // null = couldn't load. Never treat that as "free": clear the greying so
    // nothing stale stays on screen and let the server decide.
    const data = await window.CampusSchedule.fetchDay(BASE, roomId, d);
    if (seq !== takenSeq) return;                              // a newer request superseded this one
    if (!data) {
      resetStartOptions();
      syncEndOptions();
      return;
    }
    dayData = { roomId, date: d, data };

    // A start block is only usable if the block itself is free (the shortest
    // booking is one block); which END times stay usable is decided in
    // syncEndOptions() once a start is chosen.
    Array.from(startTimeInput.options).forEach(opt => {
      if (!opt.value) return;
      const i = BLOCKS.indexOf(opt.value);
      const [bs, be] = [BLOCKS[i], BLOCKS[i + 1] || '21:00'];
      const taken = window.CampusSchedule.findConflicts(data, d, bs, be).length > 0;
      opt.disabled = taken;
      opt.textContent = opt.dataset.label + (taken ? ' — unavailable' : '');
    });

    // A start time that was valid for the previous date may be taken on this one.
    const chosen = startTimeInput.selectedOptions[0];
    if (chosen && chosen.disabled) startTimeInput.value = '';

    // Re-derive the end options for the (possibly cleared) start against this day.
    syncEndOptions();
  }

  if (roomSelect) roomSelect.addEventListener('change', markTakenSlots);

  function showCollisionError(message, title = 'Unable to submit request') {
    if (errorBannerTitle) errorBannerTitle.textContent = title;
    if (errorBanner) {
      if (errorBannerText) errorBannerText.textContent = message;
      errorBanner.classList.remove('hidden');
      errorBanner.classList.add('flex');
      errorBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      alert(message);
    }
    if (successBanner) {
      successBanner.classList.add('hidden');
      successBanner.classList.remove('flex');
    }
  }

  function hideCollisionError() {
    if (errorBanner) {
      errorBanner.classList.add('hidden');
      errorBanner.classList.remove('flex');
    }
  }

  function showSuccess(message) {
    if (successBanner) {
      if (successBannerText) successBannerText.textContent = message;
      successBanner.classList.remove('hidden');
      successBanner.classList.add('flex');
      successBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    hideCollisionError();
  }

  // Fix Guide 5.4: POST /api/reservations is Customer-only, so a Staff/Admin
  // account that opens this page can fill the whole form in and only find
  // out it's forbidden after submitting. Go view-only for them instead,
  // except during a rebook (rebook() explicitly allows Staff/Admin).
  function applyRole(user) {
    if (!user || user.role === 'Customer' || isRebook) return;
    if (submitBtn) submitBtn.disabled = true;
    showCollisionError(
      'Staff and admin accounts can view room availability but can\u2019t create reservations.',
      'View only'
    );
  }
  if (window.currentUser) applyRole(window.currentUser);
  document.addEventListener('campusroom:user', (e) => applyRole(e.detail));

  /**
   * Equipment notes = the ticked AV items, by their canonical data-equipment
   * names.
   *
   * This used to be every ticked checkbox in the form, stringified via
   * label.textContent — which swept in the Institutional Space Policy
   * Acknowledgement (469 characters of body copy, ticked by default) plus the
   * two default-ticked AV items, for 620 characters before the user touched
   * anything. The API caps equipment_notes at 500, so every default submission
   * came back 422. See the Section 14 report.
   */
  function collectEquipmentNotes() {
    const group = document.getElementById('equipmentOptions');
    if (!group) return '';
    const picked = [];
    group.querySelectorAll('input[type="checkbox"][data-equipment]:checked').forEach(cb => {
      picked.push(cb.dataset.equipment);
    });
    return picked.join(', ').substring(0, 500);
  }

  /** Tick the AV boxes named in a stored equipment_notes string. */
  function applyEquipmentNotes(notes) {
    const group = document.getElementById('equipmentOptions');
    if (!group) return;
    const wanted = String(notes || '').split(',').map(part => part.trim()).filter(Boolean);
    group.querySelectorAll('input[type="checkbox"][data-equipment]').forEach(cb => {
      cb.checked = wanted.indexOf(cb.dataset.equipment) !== -1;
    });
  }

  // ---------------------------------------------------------------
  // Reservation classification (Fix Guide 1.3)
  // ---------------------------------------------------------------

  // These strings are the Reservations.category ENUM verbatim — they are sent
  // as the `category` field, not glued onto `purpose` as they once were.
  const PURPOSE_LABELS = {
    lecture: 'Academic Lecture',
    defense: 'Faculty Defense',
    student_org: 'Student Org Meeting',
    workshop: 'Dept Workshop',
    exam: 'Exam/Quiz'
  };

  // The prefixes the form used to write into `purpose` before `category`
  // existed. The migration strips these, but a re-book of a row that predates
  // it would otherwise carry the prefix back in. Note the old "Exam / Quiz"
  // spacing, which the ENUM does not use.
  const LEGACY_PREFIXES = { ...PURPOSE_LABELS, exam_legacy: 'Exam / Quiz' };

  function radioFor(categoryValue) {
    return form && form.querySelector(`input[name="reservation_purpose"][value="${categoryValue}"]`);
  }

  /**
   * Prefill the classification radio and the description for a re-booking.
   * Prefers the source's own `category` column; falls back to parsing a legacy
   * inline prefix, and strips it so submitting again cannot double it up.
   */
  function applyPurpose(stored, category) {
    if (category) {
      const entry = Object.entries(PURPOSE_LABELS).find(([, label]) => label === category);
      const radio = entry && radioFor(entry[0]);
      if (radio) radio.checked = true;
    }

    const text = String(stored || '');
    for (const [key, label] of Object.entries(LEGACY_PREFIXES)) {
      if (text.startsWith(label + ': ')) {
        const radio = radioFor(key === 'exam_legacy' ? 'exam' : key);
        if (radio) radio.checked = true;
        return text.slice(label.length + 2);
      }
    }
    return text;
  }

  // ---------------------------------------------------------------
  // Re-book prefill (Section 14, Option A)
  // ---------------------------------------------------------------

  function permitRef(id) {
    return 'REQ-' + String(id || '').substring(0, 8).toUpperCase();
  }

  /**
   * Select an "HH:MM" option if the dropdown offers it. Returns false (and
   * leaves the field blank) when it doesn't, so the caller can say so instead
   * of shipping a half-filled form.
   */
  function setTimeOption(select, value) {
    if (!select || !value) return false;
    const match = Array.prototype.some.call(select.options, opt => opt.value === value);
    if (!match) return false;
    select.value = value;
    return true;
  }

  /** "2026-03-11 09:00:00" -> "09:00". Read literally; these are already
   *  Asia/Manila wall-clock strings (Section 9), never device-local. */
  function timeOf(value) {
    const match = /^\d{4}-\d{2}-\d{2}[T ](\d{2}:\d{2})/.exec(String(value || ''));
    return match ? match[1] : '';
  }

  function prefillFromRebookSource() {
    if (!isRebook) return;

    fetch(BASE + 'api/reservations/' + encodeURIComponent(rebookId), { credentials: 'same-origin' })
      .then(res => res.json().catch(() => null))
      .then(json => {
        if (!json || !json.success || !json.data) {
          showRebookNotice(
            'Re-booking unavailable',
            (json && json.error) || 'That booking could not be loaded. You can still book this room from scratch.'
          );
          return;
        }

        rebookSource = json.data;

        // Purpose and duration. Date is left blank on purpose.
        if (purposeInput && rebookSource.purpose) {
          purposeInput.value = applyPurpose(rebookSource.purpose, rebookSource.category);
        }

        // startTime/endTime are <select>s pinned to the 90-minute block grid,
        // not free-text time inputs. A booking made outside that grid (staff
        // re-book, or seeded data) has no matching <option>, and assigning it
        // blanks the select silently. Only set a time we can actually offer.
        const startSet = setTimeOption(startTimeInput, timeOf(rebookSource.start_time));
        syncEndOptions();   // rebuild end options for the newly-set start before setting end
        const endSet = setTimeOption(endTimeInput, timeOf(rebookSource.end_time));
        rebookTimesCarried = startSet && endSet;

        applyEquipmentNotes(rebookSource.equipment_notes);

        // Room: wait for the <option>s, then select the source room. If it is
        // under maintenance the option exists but is disabled, so say so
        // rather than silently leaving the wrong room selected.
        roomsReady.then(() => {
          if (roomSelect && rebookSource.room_id) {
            const option = Array.prototype.find.call(
              roomSelect.options, opt => opt.value === rebookSource.room_id
            );
            if (option && !option.disabled) {
              roomSelect.value = rebookSource.room_id;
              renderRoomSummary(roomSelect.value);
              updateCalendar(roomSelect.value);
            }
          }

          const roomLabel = rebookSource.room_name || rebookSource.room_id || 'the same room';
          const roomUsable = roomSelect
            ? Array.prototype.some.call(roomSelect.options, opt => opt.value === rebookSource.room_id && !opt.disabled)
            : true;

          const carried = rebookTimesCarried ? 'Room, purpose and duration are' : 'Room and purpose are';
          const timesNote = rebookTimesCarried
            ? ''
            : ' The original times are not on the standard time blocks, so pick them again.';

          showRebookNotice(
            'Re-booking from ' + permitRef(rebookSource.reservation_id),
            roomUsable
              ? carried + ' carried over from your ' +
                String(rebookSource.status || '').toLowerCase() +
                ' booking in ' + roomLabel + '. Pick a new date and time.' + timesNote
              : roomLabel + ' is not bookable right now, so no room is pre-selected. ' +
                'Pick a room, date and time.' + timesNote
          );
        });

      })
      .catch(err => {
        console.error('Error loading source reservation:', err);
        showRebookNotice(
          'Re-booking unavailable',
          'A network error stopped the original booking from loading. You can still book this room from scratch.'
        );
      });
  }

  prefillFromRebookSource();

  // ---------------------------------------------------------------
  // Consolidated submit handler (Fix Guide 1.3, 1.5, 1.6, 1.7)
  // ---------------------------------------------------------------

  let submitting = false;
  let redirecting = false;

  function setSubmitting(on) {
    submitting = on;
    if (submitBtn) {
      submitBtn.disabled = on;
      submitBtn.classList.toggle('opacity-60', on);
    }
  }

  async function sendReservation(endpoint, payload) {
    const res = await fetch(BASE + endpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.status === 401) { window.location.href = 'index.html'; return null; }
    let json = null;
    try { json = await res.json(); } catch (_) { /* HTML error page or empty body */ }
    return { status: res.status, json };
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (submitting) return;
      hideCollisionError();

      const roomId      = roomSelect ? roomSelect.value : '';
      const dateVal     = resDateInput ? resDateInput.value : '';
      const startVal    = startTimeInput ? startTimeInput.value : '';
      const endVal      = endTimeInput ? endTimeInput.value : '';
      const picked      = form.querySelector('input[name="reservation_purpose"]:checked');
      const description = purposeInput ? purposeInput.value.trim() : '';
      const policyBox   = document.getElementById('policyAcknowledgement');

      if (!roomId || !dateVal || !startVal || !endVal) {
        return showCollisionError('Please choose a room, date, start time and end time.', 'Missing information');
      }
      const problem = dateProblem(dateVal);
      if (problem) {
        setDateError(problem);
        return showCollisionError(problem, 'Invalid date');
      }
      if (resDateInput && resDateInput.min && dateVal < resDateInput.min) {
        return showCollisionError('Please choose a date that is not in the past.', 'Invalid date');
      }
      if (!validateTime()) {
        return showCollisionError('End time must be after the start time.', 'Invalid time');
      }
      // The whole range must be free, not just its first block. (Only checked
      // once the schedule has loaded; otherwise the server's 409 says the same.)
      const clash = rangeConflicts(startVal, endVal);
      if (clash.length) {
        return showCollisionError(window.CampusSchedule.describe(clash, startVal, endVal), 'Scheduling conflict');
      }
      if (!picked) {
        return showCollisionError('Please choose a reservation classification.', 'Missing information');
      }
      if (!description) {
        return showCollisionError('Please describe the purpose of this reservation.', 'Missing information');
      }
      if (policyBox && !policyBox.checked) {
        return showCollisionError('Please acknowledge the Institutional Space Policy to continue.', 'Acknowledgement required');
      }

      const payload = {
        room_id: roomId,
        // `purpose` is now the requester's description only; the classification
        // travels in its own column instead of being glued to the front.
        purpose: description,
        category: PURPOSE_LABELS[picked.value],
        start_time: `${dateVal}T${startVal}:00`,
        end_time: `${dateVal}T${endVal}:00`,
        equipment_notes: collectEquipmentNotes() || 'Standard Academic Setup'
      };

      // Same body either way; only the endpoint differs. The rebook route
      // files the new booking under the ORIGINAL requester and logs where it
      // came from, which POST api/reservations cannot do.
      const endpoint = isRebook
        ? 'api/reservations/' + encodeURIComponent(rebookId) + '/rebook'
        : 'api/reservations';

      setSubmitting(true);
      sendReservation(endpoint, payload)
        .then(result => {
          if (!result) return;                       // 401 → already redirecting to login
          const { status, json } = result;

          if (!json) {
            return showCollisionError(`The server sent an unexpected response (HTTP ${status}). Please try again.`, 'Something went wrong');
          }
          if (!json.success) {
            return showCollisionError(
              json.error || 'Your request could not be submitted.',
              status === 409 ? 'Scheduling conflict' : 'Unable to submit request'
            );
          }

          redirecting = true;
          const ref = 'REQ-' + String(json.data.reservation_id).substring(0, 8).toUpperCase();
          showSuccess(`${isRebook ? 'Re-booking created' : 'Reservation request created'}: ${ref} is now in the staff queue for verification. Redirecting to My Reservations…`);
          setTimeout(() => { window.location.href = 'my-reservations.html'; }, 1500);
        })
        .catch(() => showCollisionError('Could not reach the server. Check your connection and try again.', 'Network error'))
        .finally(() => { if (!redirecting) setSubmitting(false); });
    });
  }
});
