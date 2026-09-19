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
      calendarInstance.loadData();
      return;
    }
    const container = document.getElementById('room-calendar-container');
    if (container) {
      if (typeof RoomCalendar !== 'undefined') {
        calendarInstance = new RoomCalendar({
          containerId: 'room-calendar-container',
          roomId: roomId
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

  if (resDateInput) {
    resDateInput.addEventListener('change', () => {
      if (!resDateInput.value) return;
      const selected = new Date(resDateInput.value + 'T00:00:00');   // local, not UTC
      if (selected.getDay() === 0) {
        showCollisionError('Sundays are not available for reservation.', 'Date unavailable');
        resDateInput.value = '';
      } else {
        hideCollisionError();
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

  // ---------------------------------------------------------------
  // 3.1: end-time options depend on the chosen start time, so a student
  // can't pick an end that's already before/equal to the start.
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
          endTimeInput.appendChild(opt);
        });
      if (previous && previous > start) endTimeInput.value = previous;
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

  async function markTakenSlots() {
    if (!startTimeInput || !roomSelect || !resDateInput) return;
    const roomId = roomSelect.value, d = resDateInput.value;
    if (!roomId || !d) return;
    try {
      const res = await fetch(`${BASE}api/rooms/${encodeURIComponent(roomId)}/calendar?start=${d}&end=${d}`, { credentials: 'include' });
      const json = await res.json();
      if (!json.success) return;
      const { reservations, class_schedules, holidays } = json.data;

      const dayName = new Date(d + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long' });
      const busy = [
        ...reservations.filter(r => r.start_time.startsWith(d))
                       .map(r => [r.start_time.slice(11, 16), r.end_time.slice(11, 16)]),
        ...class_schedules.filter(c => c.day_of_week === dayName)
                          .map(c => [c.start_time.slice(0, 5), c.end_time.slice(0, 5)])
      ];
      const isHoliday = holidays.some(h => h.holiday_date === d);

      Array.from(startTimeInput.options).forEach(opt => {
        if (!opt.value) return;
        const i = BLOCKS.indexOf(opt.value);
        const [bs, be] = [BLOCKS[i], BLOCKS[i + 1] || '21:00'];
        const taken = isHoliday || busy.some(([s, e]) => bs < e && be > s);   // overlap test
        opt.disabled = taken;
        opt.textContent = opt.dataset.label + (taken ? ' — unavailable' : '');
      });
    } catch (_) { /* non-fatal; the server still validates */ }
  }

  if (resDateInput) resDateInput.addEventListener('change', markTakenSlots);
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

  const PURPOSE_LABELS = {
    lecture: 'Academic Lecture',
    defense: 'Faculty Defense',
    student_org: 'Student Org Meeting',
    workshop: 'Dept Workshop',
    exam: 'Exam / Quiz'
  };

  /**
   * Split a stored "<Classification>: <description>" purpose back into its
   * radio selection and free-text description, so re-book prefill doesn't
   * double the prefix when the form is submitted again.
   */
  function applyPurpose(stored) {
    const text = String(stored || '');
    for (const [value, label] of Object.entries(PURPOSE_LABELS)) {
      if (text.startsWith(label + ': ')) {
        const radio = form && form.querySelector(`input[name="reservation_purpose"][value="${value}"]`);
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
        if (purposeInput && rebookSource.purpose) purposeInput.value = applyPurpose(rebookSource.purpose);

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
      if (resDateInput && resDateInput.min && dateVal < resDateInput.min) {
        return showCollisionError('Please choose a date that is not in the past.', 'Invalid date');
      }
      if (!validateTime()) {
        return showCollisionError('End time must be after the start time.', 'Invalid time');
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
        purpose: `${PURPOSE_LABELS[picked.value]}: ${description}`,
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
