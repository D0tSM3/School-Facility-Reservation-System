/**
 * CampusRoom — Facility Reservation Logic
 * Enforces MySQL overlap-prevention trigger, field validation, and reservation dispatch.
 */

window.initBookingForm = function() {
  'use strict';

  const BASE = window.location.pathname.replace(/[^\/]*$/, '');

  const form = document.getElementById('roomReservationForm');
    const bookingModeRadios = document.querySelectorAll('input[name="booking_mode"]');
    const resDateWrapper = document.getElementById('resDateWrapper');
    const resEndDateWrapper = document.getElementById('resEndDateWrapper');
    const resDateLabel = document.getElementById('resDateLabel');
    const dateRangeHint = document.getElementById('dateRangeHint');
    const specificDaysWrapper = document.getElementById('specificDaysWrapper');
    const dayCheckboxesContainer = document.getElementById('dayCheckboxes');

    function getBookingMode() {
      const checked = document.querySelector('input[name="booking_mode"]:checked');
      return checked ? checked.value : 'single';
    }

    function updateBookingModeUI() {
      const mode = getBookingMode();
      
      if (mode === 'single') {
        resDateWrapper.classList.remove('col-span-2');
        resDateWrapper.classList.add('w-full');
        resEndDateWrapper.classList.add('hidden');
        resDateLabel.textContent = 'Date';
        specificDaysWrapper.classList.add('hidden');
        dateRangeHint.textContent = 'Select one date for your reservation.';
        if (resDateInput.value) {
          resEndDateInput.value = resDateInput.value; // Sync automatically
        }
      } else if (mode === 'range') {
        resDateWrapper.classList.remove('col-span-2');
        resDateWrapper.classList.add('w-full');
        resEndDateWrapper.classList.remove('hidden');
        resDateLabel.textContent = 'From';
        specificDaysWrapper.classList.add('hidden');
        dateRangeHint.textContent = 'Maximum booking span: 7 days.';
      } else if (mode === 'specific') {
        resDateWrapper.classList.remove('col-span-2');
        resDateWrapper.classList.add('w-full');
        resEndDateWrapper.classList.remove('hidden');
        resDateLabel.textContent = 'From';
        specificDaysWrapper.classList.remove('hidden');
        dateRangeHint.textContent = 'Choose a range of up to 7 days, then select the exact dates.';
        renderSpecificDays();
      }
      onDatesChanged();
    }

    function renderSpecificDays() {
      if (getBookingMode() !== 'specific') return;
      const start = startDateValue();
      const end = endDateValue();
      if (!isRealDate(start) || !isRealDate(end)) {
        dayCheckboxesContainer.innerHTML = '<span class="text-xs text-gray-400">Select From and To dates first.</span>';
        return;
      }
      
      const sDate = new Date(start);
      const eDate = new Date(end);
      dayCheckboxesContainer.innerHTML = '';
      
      const daysDiff = (eDate - sDate) / (1000 * 60 * 60 * 24);
      if (daysDiff < 0) {
        dayCheckboxesContainer.innerHTML = '<span class="text-xs text-red-500">Invalid date range.</span>';
        return;
      }
      if (daysDiff > 6) {
        dayCheckboxesContainer.innerHTML = '<span class="text-xs text-red-500">Range exceeds 7 days.</span>';
        return;
      }

      const counter = document.getElementById('selectedDaysCount');
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      let curr = new Date(sDate);
      
      while (curr <= eDate) {
        const dateStr = toYMD(curr);
        const dayName = days[curr.getDay()];
        
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2.5 bg-white px-3.5 py-2.5 rounded-lg cursor-pointer border border-gray-200 shadow-sm transition-colors hover:border-[#7a1f2b]/30';
        label.innerHTML = `<input type="checkbox" name="active_days" value="${dateStr}" class="w-4 h-4 text-[#7a1f2b] bg-white border-gray-300 rounded focus:ring-[#7a1f2b] focus:ring-1" checked><span class="text-[13px] font-bold text-[#1e293b]">${dayName} <span class="text-gray-400 font-normal ml-1">· ${curr.toLocaleString('en-US', {month:'short', day:'numeric'})}</span></span>`;
        
        label.querySelector('input').addEventListener('change', () => {
            // Immediately update the calendar highlight without re-rendering checkboxes
            if (calendarInstance && typeof calendarInstance.setActiveDates === 'function') {
              const checkedDates = Array.from(
                document.querySelectorAll('input[name="active_days"]:checked')
              ).map(cb => cb.value);
              calendarInstance.setActiveDates(checkedDates);
            }
            // Update the "N selected" counter
            const count = document.querySelectorAll('input[name="active_days"]:checked').length;
            const counter = document.getElementById('selectedDaysCount');
            if (counter) counter.textContent = `${count} selected`;
            // Also update times overlay in calendar
            if (calendarInstance && startTimeInput && endTimeInput &&
                typeof calendarInstance.setSelectionTimes === 'function') {
              calendarInstance.setSelectionTimes(startTimeInput.value, endTimeInput.value);
            }
        });
        dayCheckboxesContainer.appendChild(label);
        
        curr.setDate(curr.getDate() + 1);
      }
      if (counter) {
        const count = typeof getSelectedDates === 'function' ? getSelectedDates().length : document.querySelectorAll('input[name="active_days"]:checked').length;
        counter.textContent = `${count} selected`;
      }
    }

    if (bookingModeRadios) {
      bookingModeRadios.forEach(radio => {
        radio.addEventListener('change', updateBookingModeUI);
      });
    }

    function getSelectedDates() {
      const mode = getBookingMode();
      const start = startDateValue();
      const end = endDateValue();
      if (!isRealDate(start) || !isRealDate(end)) return [];

      if (mode === 'single') {
        return [start];
      }
      
      if (mode === 'range') {
        let dates = [];
        let curr = new Date(start);
        const eDate = new Date(end);
        while (curr <= eDate) {
          dates.push(toYMD(curr));
          curr.setDate(curr.getDate() + 1);
        }
        return dates;
      }
      
      if (mode === 'specific') {
        const checkboxes = document.querySelectorAll('input[name="active_days"]:checked');
        return Array.from(checkboxes).map(cb => cb.value);
      }
      
      return [];
    }

  const roomSelect = document.getElementById('roomSelect');
  const resDateInput = document.getElementById('resDate');
  // Optional: book-room.html has a date range; the rooms.html booking modal
  // only has resDate, which then acts as both start and end.
  const resEndDateInput = document.getElementById('resEndDate');
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

  if (isRebook && submitBtn) {
    submitBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">sync</span> Submit Re-book';
  }
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
        const wantedId = window.bookingModalTargetRoomId || preselectedRoom;
        const wanted = wantedId && roomsById[wantedId];
        if (wanted && wanted.status !== 'Maintenance') {
          roomSelect.value = wantedId;
        }

        renderRoomSummary(roomSelect.value);
        if (roomSelect.value) updateCalendar(roomSelect.value);
        updateCalendarSelection();
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

  /**
   * For One Day Booking: return the Mon–Sun week that contains `ymd`.
   * The calendar shows this full 7-day window for context while only the
   * single selected date is actually highlighted.
   */
  function weekRangeFor(ymd) {
    const d = new Date(ymd + 'T00:00:00');
    const day = d.getDay();                         // 0=Sun … 6=Sat
    const diffToMon = (day === 0) ? -6 : 1 - day;  // shift to Monday
    const mon = new Date(d);
    mon.setDate(d.getDate() + diffToMon);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return { start: toYMD(mon), end: toYMD(sun) };
  }

  function updateCalendarSelection() {
    if (!calendarInstance) return;
    const mode     = getBookingMode();
    const start    = startDateValue();
    const end      = endDateValue();
    const selected = getSelectedDates();

    if (typeof calendarInstance.setRange === 'function') {
      if (mode === 'single' && isRealDate(start)) {
        // Show the full Mon–Sun week; only the one booked date is highlighted
        const { start: wStart, end: wEnd } = weekRangeFor(start);
        calendarInstance.setRange(wStart, wEnd, selected);
      } else if (mode === 'specific') {
        // Show the From→To range; highlight only the checked dates
        calendarInstance.setRange(start, end, selected);
      } else {
        // Consecutive range: show and highlight the entire From→To span
        calendarInstance.setRange(start, end, null);
      }
    }

    if (startTimeInput && endTimeInput && typeof calendarInstance.setSelectionTimes === 'function') {
      calendarInstance.setSelectionTimes(startTimeInput.value, endTimeInput.value);
    }
  }

  function updateCalendar(roomId) {
    if (!roomId) return;
    if (calendarInstance && calendarInstance.roomId === roomId) {
      // Same room — just update the date range and highlights
      updateCalendarSelection();
      return;
    }
    const container = document.getElementById('room-calendar-container');
    if (container) {
      if (typeof RoomCalendar !== 'undefined') {
        const mode  = getBookingMode();
        const start = startDateValue();
        let initStart = start, initEnd = endDateValue();
        // For single mode, open the calendar on the full surrounding week
        if (mode === 'single' && isRealDate(start)) {
          const w = weekRangeFor(start);
          initStart = w.start;
          initEnd   = w.end;
        }
        calendarInstance = new RoomCalendar({
          containerId:    'room-calendar-container',
          roomId:         roomId,
          initialDate:    initStart,
          initialEndDate: initEnd,
          minDate:        resDateInput ? resDateInput.min : '',
          activeDates:    getSelectedDates(),
          rules:          rules
        });
        updateCalendarSelection();
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

  // Business hours and closed days (Admin > System Configuration). Starts on
  // the long-standing defaults and is replaced by applyRules() once
  // GET api/config answers.
  let rules = window.CampusSchedule.DEFAULT_RULES;

  // Earliest bookable day: today (same-day booking is allowed), skipping closed days.
  function earliestOpenDay() {
    const d = new Date();
    // Start from today; skip forward only if today itself is a closed day.
    for (let i = 0; i < 7 && window.CampusSchedule.isClosedDay(toYMD(d), rules.closedDays); i++) {
      d.setDate(d.getDate() + 1);
    }
    return d;
  }

  if (resDateInput) {
    resDateInput.min = toYMD(earliestOpenDay());
    // A re-booking deliberately starts with a blank date.
    if (!resDateInput.value && !isRebook) {
      resDateInput.value = toYMD(earliestOpenDay());
    }
  }

  // Same cap as ReservationValidator::MAX_RANGE_DAYS on the server.
  const MAX_RANGE_DAYS = 31;

  function startDateValue() {
    return resDateInput ? resDateInput.value : '';
  }

  /** The range's last day; the start date when there is no end-date field. */
  function syncEndDate() {
    if (!resEndDateInput) return;
    const start = startDateValue();

    // Set min = start date (cannot book end before start)
    resEndDateInput.min = start || (resDateInput ? resDateInput.min : '');

    if (start) {
      // max = start + 6 days = 7 days inclusive (Day 1 = start, Day 7 = start+6)
      const d = new Date(start + 'T00:00:00');
      d.setDate(d.getDate() + 6);
      const maxYMD = toYMD(d);
      resEndDateInput.max = maxYMD;

      // Clamp current end value: if outside [start, max] reset to start
      if (resEndDateInput.value && (resEndDateInput.value < start || resEndDateInput.value > maxYMD)) {
        resEndDateInput.value = start;
      }
    } else {
      resEndDateInput.removeAttribute('max');
    }

    if (isRebook) {
      resEndDateInput.value = start;
      resEndDateInput.disabled = true;
      return;
    }
    if (start && !resEndDateInput.value) {
      resEndDateInput.value = start;
    }
  }

  function endDateValue() {
    return resEndDateInput ? resEndDateInput.value : startDateValue();
  }

  syncEndDate();

  const dateError = document.getElementById('dateError');

  function setDateError(message) {
    if (dateError) {
      dateError.textContent = message;
      dateError.classList.toggle('hidden', !message);
    }
    if (resDateInput) resDateInput.setAttribute('aria-invalid', message ? 'true' : 'false');
    if (resEndDateInput) resEndDateInput.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  /** '' when every day in the range can be booked, otherwise the reason it can't. */
  function dateProblem(start, end) {
    if (!start || !end) return '';
    const sDate = new Date(start);
    const eDate = new Date(end);
    const diff = (eDate - sDate) / (1000 * 60 * 60 * 24);
    if (diff > 6 && getBookingMode() !== 'single') {
        return 'Multiple day bookings are strictly limited to a maximum range of 7 days.';
    }
    if (getBookingMode() === 'specific' && getSelectedDates().length === 0) {
        return 'Please select at least one specific day.';
    }
    if (resDateInput && resDateInput.min && start < resDateInput.min) {
      return 'Bookings open starting tomorrow. Please pick a later date.';
    }
    if (end < start) {
      return 'The end date must be on or after the start date.';
    }
    const days = window.CampusSchedule.datesBetween(start, end);
    if (days.length > MAX_RANGE_DAYS) {
      return `A booking can cover at most ${MAX_RANGE_DAYS} days.`;
    }
    const closed = days.find(d => window.CampusSchedule.isClosedDay(d, rules.closedDays));
    if (closed) {
      const day = window.CampusSchedule.dayName(closed);
      return days.length > 1
        ? `The range includes a ${day}, when BPU is closed. Pick dates that skip ${closedDaysText()}.`
        : `${day}s are not available for reservation. Please pick another day.`;
    }
    return '';
  }

  // While a date is being typed the browser fires "change" for every valid
  // intermediate value (year 0002, 0020, 0202, then 2026). Only act on a real year.
  function isRealDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 2000;
  }

  function onDatesChanged() {
    const mode  = getBookingMode();
    const start = startDateValue();
    const end   = endDateValue();

    // For single-day mode keep the end date in sync automatically
    if (mode === 'single' && resDateInput && resEndDateInput) {
      resEndDateInput.value = resDateInput.value;
    }

    // Regenerate specific-day checkboxes whenever the date range changes
    if (mode === 'specific') {
      renderSpecificDays();
    }

    if (!isRealDate(start) || !isRealDate(end)) {
      setDateError('');
      return;
    }

    setDateError(dateProblem(start, end));

    if (calendarInstance) {
      const selected = getSelectedDates();
      if (typeof calendarInstance.setRange === 'function') {
        if (mode === 'single' && isRealDate(start)) {
          const { start: wStart, end: wEnd } = weekRangeFor(start);
          calendarInstance.setRange(wStart, wEnd, selected);
        } else if (mode === 'specific') {
          calendarInstance.setRange(start, end, selected);
        } else {
          calendarInstance.setRange(start, end, null);
        }
      } else {
        calendarInstance.goToDate(start);
      }
      if (startTimeInput && endTimeInput && typeof calendarInstance.setSelectionTimes === 'function') {
        calendarInstance.setSelectionTimes(startTimeInput.value, endTimeInput.value);
      }
    }

    markTakenSlots();
  }

  if (resDateInput) {
    const onStartChange = () => {
      resDateInput.dataset.touched = '1';
      if (isRealDate(resDateInput.value)) {
        syncEndDate();
      }
      onDatesChanged();
    };
    resDateInput.addEventListener('change', onStartChange);
    resDateInput.addEventListener('input', onStartChange);
  }

  if (resEndDateInput) {
    const onEndChange = () => {
      if (resEndDateInput.min && resEndDateInput.value < resEndDateInput.min) {
        resEndDateInput.value = resEndDateInput.min;
      }
      if (resEndDateInput.max && resEndDateInput.value > resEndDateInput.max) {
        resEndDateInput.value = resEndDateInput.max;
      }
      onDatesChanged();
    };
    resEndDateInput.addEventListener('change', onEndChange);
    resEndDateInput.addEventListener('input', onEndChange);
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

    const requestSlipBtn = document.getElementById('requestSlipBtn');
  const rsModal = document.getElementById('requestSlipModalOverlay');
  const closeRsBtn = document.getElementById('closeRequestSlipModalBtn');
  const cancelRsBtn = document.getElementById('cancelRequestSlipBtn');
  const rsAltSchedule = document.getElementById('rsAltSchedule');
  const rsAltFields = document.getElementById('rsAltScheduleFields');

  if (requestSlipBtn && rsModal) {
    requestSlipBtn.addEventListener('click', () => {
      rsModal.classList.remove('hidden');
      rsModal.classList.add('flex');
    });
    
    const closeRs = () => {
      rsModal.classList.add('hidden');
      rsModal.classList.remove('flex');
    };
    
    if (closeRsBtn) closeRsBtn.addEventListener('click', closeRs);
    if (cancelRsBtn) cancelRsBtn.addEventListener('click', closeRs);
    
    if (rsAltSchedule && rsAltFields) {
      rsAltSchedule.addEventListener('change', () => {
        if (rsAltSchedule.value === 'Yes') {
          rsAltFields.classList.remove('hidden');
        } else {
          rsAltFields.classList.add('hidden');
        }
      });
    }
    
    const rsForm = document.getElementById('requestSlipForm');
    if (rsForm) {
      rsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        alert('Request Slip submitted successfully. Staff will review it shortly.');
        closeRs();
        const mainModal = document.getElementById('bookingModalOverlay');
        if (mainModal) {
            mainModal.classList.add('hidden');
            mainModal.classList.remove('flex');
        }
      });
    }
  }
  const validateTime = () => {
    if (startTimeInput && endTimeInput && startTimeInput.value) {
      const mode = getBookingMode();
      const start = startDateValue();
      const now = new Date();
      const todayStr = toYMD(now);
      // Use HH:MM for an exact current-time comparison (respects minutes)
      const nowHHMM = String(now.getHours()).padStart(2, '0') + ':' +
                      String(now.getMinutes()).padStart(2, '0');

      // Past-time guard — applies to ALL booking modes when start date is today.
      // For Consecutive Range the start date is the first day of the range.
      // For Specific Days it is the earliest selected date.
      if (start === todayStr && startTimeInput.value <= nowHHMM) {
        const conflictBanner = document.getElementById('conflictBanner');
        const requestSlipBtn = document.getElementById('requestSlipBtn');
        if (conflictBanner) conflictBanner.classList.add('hidden');
        if (requestSlipBtn) requestSlipBtn.classList.add('hidden');
        showCollisionError('Reservations must start in the future.', 'Invalid time');
        return false;
      }

      if (endTimeInput.value) {
        if (endTimeInput.value <= startTimeInput.value) {
          const conflictBanner = document.getElementById('conflictBanner');
          const requestSlipBtn = document.getElementById('requestSlipBtn');
          if (conflictBanner) conflictBanner.classList.add('hidden');
          if (requestSlipBtn) requestSlipBtn.classList.add('hidden');
          showCollisionError('End time must be after the start time.', 'Invalid time');
          return false;
        }

        // Time boundaries are valid — check the full requested range for conflicts
        hideCollisionError();
        const clash = rangeConflicts(startTimeInput.value, endTimeInput.value);
        if (clash.length) {
          // Show conflict UI
          const conflictBanner = document.getElementById('conflictBanner');
          const requestSlipBtn = document.getElementById('requestSlipBtn');
          if (conflictBanner) {
            conflictBanner.classList.remove('hidden');
            conflictBanner.classList.add('flex');
          }
          if (requestSlipBtn) requestSlipBtn.classList.remove('hidden');

          // Populate Request Slip preview
          const facilitySpan = document.getElementById('rsFacility');
          const dateSpan     = document.getElementById('rsDate');
          const timeSpan     = document.getElementById('rsTime');
          const conflictSpan = document.getElementById('rsConflictInfo');
          if (facilitySpan && roomSelect && roomSelect.options[roomSelect.selectedIndex]) {
            facilitySpan.textContent = roomSelect.options[roomSelect.selectedIndex].text;
          }
          if (dateSpan) dateSpan.textContent = mode === 'single' ? start : (start + ' to ' + endDateValue());
          if (timeSpan) timeSpan.textContent =
            startTimeInput.options[startTimeInput.selectedIndex].text + ' - ' +
            endTimeInput.options[endTimeInput.selectedIndex].text;
          if (conflictSpan) conflictSpan.textContent =
            window.CampusSchedule.describeRange(clash, startTimeInput.value, endTimeInput.value);

          document.getElementById('roomReservationForm')?.dispatchEvent(new Event('change'));
          return false; // blocks normal submit
        } else {
          // No conflict — hide conflict UI
          const conflictBanner = document.getElementById('conflictBanner');
          const requestSlipBtn = document.getElementById('requestSlipBtn');
          if (conflictBanner) {
            conflictBanner.classList.add('hidden');
            conflictBanner.classList.remove('flex');
          }
          if (requestSlipBtn) requestSlipBtn.classList.add('hidden');
          document.getElementById('roomReservationForm')?.dispatchEvent(new Event('change'));
          return true;
        }
      }
    }
    return true;
  };

  if (endTimeInput) endTimeInput.addEventListener('change', () => { validateTime(); updateCalendarSelection(); });

  // The chosen room's schedule for the chosen dates, from the last successful
  // calendar fetch (see markTakenSlots). null until it arrives, and whenever it
  // is for a different room/range than the form now shows.
  let rangeData = null;   // { roomId, start, end, dates, data }

  /**
   * Conflicts for the daily window [start, end) on any day of the range: a
   * class, another reservation or a holiday that shares any minute with it.
   * Empty when the window is free OR when the schedule isn't loaded yet —
   * the server re-checks either way.
   */
  function rangeConflicts(start, end) {
    if (!rangeData || !start || !end) return [];
    if (!roomSelect || !resDateInput) return [];
    if (rangeData.roomId !== roomSelect.value ||
        rangeData.start !== startDateValue() || rangeData.end !== endDateValue()) return [];
    return window.CampusSchedule.findRangeConflicts(rangeData.data, rangeData.dates, start, end);
  }

  // ---------------------------------------------------------------
  // 3.1: end-time options depend on the chosen start time, so a student
  // can't pick an end that's already before/equal to the start, or one that
  // would stretch the booking across a class or another reservation.
  // ---------------------------------------------------------------
  let syncEndOptions = () => {};
  // Every end time the day allows; rebuilt by applyRules() from business hours.
  let ALL_END_OPTIONS = endTimeInput
    ? Array.from(endTimeInput.options).filter(o => o.value).map(o => ({ value: o.value, text: o.textContent }))
    : [];
  if (startTimeInput && endTimeInput) {
    syncEndOptions = () => {
      const start = startTimeInput.value;
      const previous = endTimeInput.value;
      endTimeInput.disabled = !start;
      endTimeInput.innerHTML = '<option value="">Select End</option>';
      ALL_END_OPTIONS.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.text;
        
        if (start && o.value <= start) {
          opt.disabled = true;
          opt.hidden = true; // hide/disable before or equal
        } else {
          // Start is free, but is [start, this end) free?
          const clash = rangeConflicts(start, o.value);
          if (clash.length) {
              // The UI is now handled by validateTime() on selection.
            }
        }
        endTimeInput.appendChild(opt);
      });
      // Keep the previous end only if it is still offered AND still usable.
      const keep = Array.from(endTimeInput.options).find(o => o.value === previous);
      if (previous && previous > start && keep && !keep.disabled) endTimeInput.value = previous;
    };

    startTimeInput.addEventListener('change', () => { syncEndOptions(); validateTime(); updateCalendarSelection(); });
  }

  // ---------------------------------------------------------------
  // 3.3: grey out start-time blocks that are already taken by another
  // reservation, a class, or a holiday, so the student finds out before
  // submitting instead of after. The server remains the source of truth;
  // this is a convenience layer, so failures are swallowed.
  // ---------------------------------------------------------------
  // Half-hour marks from opening to closing; rebuilt by applyRules().
  let BLOCKS = window.CampusSchedule.halfHours(rules.open, rules.close);

  if (startTimeInput) {
    // remember each option's original label once
    Array.from(startTimeInput.options).forEach(o => { o.dataset.label = o.textContent; });
  }

  /** '13:30' -> '01:30 PM' (the label style the time selects already use). */
  function optionLabel(hhmm) {
    const h = Number(hhmm.slice(0, 2));
    return String(((h + 11) % 12) + 1).padStart(2, '0') + ':' + hhmm.slice(3, 5) + (h >= 12 ? ' PM' : ' AM');
  }

  function closedDaysText() {
    const days = rules.closedDays.map(d => d + 's');
    return days.length > 1 ? days.slice(0, -1).join(', ') + ' and ' + days[days.length - 1] : (days[0] || 'closed days');
  }

  /**
   * Rebuild everything that depends on business hours / closed days:
   * the start and end time options, the earliest bookable date, the hint
   * under the dates, and the calendar. A time already chosen is kept if the
   * new hours still offer it.
   */
  function applyRules(next) {
    rules = next;
    BLOCKS = window.CampusSchedule.halfHours(rules.open, rules.close);

    if (startTimeInput) {
      const keep = startTimeInput.value;
      startTimeInput.innerHTML = '<option value="">Select Start Time</option>';
      BLOCKS.slice(0, -1).forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = opt.dataset.label = optionLabel(t);
        startTimeInput.appendChild(opt);
      });
      if (BLOCKS.includes(keep)) startTimeInput.value = keep;
    }
    ALL_END_OPTIONS = BLOCKS.slice(1).map(t => ({ value: t, text: optionLabel(t) }));

    if (resDateInput) {
      const min = toYMD(earliestOpenDay());
      resDateInput.min = min;
      // Only move the date we filled in ourselves; never one the customer typed.
      if (!isRebook && !resDateInput.dataset.touched &&
          (!resDateInput.value || resDateInput.value < min ||
           window.CampusSchedule.isClosedDay(resDateInput.value, rules.closedDays))) {
        resDateInput.value = min;
      }
      syncEndDate();
    }

    if (calendarInstance && typeof calendarInstance.setRules === 'function') calendarInstance.setRules(rules);
    syncEndOptions();
    onDatesChanged();
  }

  function resetStartOptions() {
    Array.from(startTimeInput.options).forEach(opt => {
      if (!opt.value) return;
      opt.disabled = false;
      opt.hidden = false;
      opt.textContent = opt.dataset.label;
    });
  }

  let takenSeq = 0;
  async function markTakenSlots() {
    if (!startTimeInput || !roomSelect || !resDateInput) return;
    const roomId = roomSelect.value, start = startDateValue(), end = endDateValue();
    const mode = getBookingMode();
    if (!roomId || !isRealDate(start) || !isRealDate(end)) return;
    const dates = window.CampusSchedule.datesBetween(start, end);
    if (!dates.length || dates.length > MAX_RANGE_DAYS) return;

    let fetchStart = start;
    let fetchEnd = end;

    // For single day mode, the calendar renders the full week. We must fetch the full
    // week so we can pass the complete data to the calendar without a second request.
    if (mode === 'single') {
      const w = weekRangeFor(start);
      fetchStart = w.start;
      fetchEnd = w.end;
    }

    const seq = ++takenSeq;
    rangeData = null;

    // Single fetch serves BOTH the time-slot greying AND the calendar grid.
    const data = await window.CampusSchedule.fetchRange(BASE, roomId, fetchStart, fetchEnd);
    if (seq !== takenSeq) return;   // superseded by a newer request

    if (!data) {
      resetStartOptions();
      syncEndOptions();
      return;
    }

    rangeData = { roomId, start, end, dates, data };

    // ---- Push data into the calendar grid to avoid a second identical fetch ----
    if (calendarInstance && typeof calendarInstance.ingestData === 'function') {
      // Build the same Date array the calendar would have computed itself
      const calDates = calendarInstance.getDatesToRender();
      const calStart = calendarInstance.formatDateYMD(calDates[0]);
      const calEnd   = calendarInstance.formatDateYMD(calDates[calDates.length - 1]);
      // Only feed the data when the view window matches what we fetched
      if (calStart === fetchStart && calEnd === fetchEnd) {
        calendarInstance.ingestData(calDates, data);
      }
    }

    // ---- For today: hide/disable past time slots; for future dates: show all ----
    const nowForFilter = new Date();
    const todayYMD = toYMD(nowForFilter);
    // "now time string" in HH:MM — slots whose value is <= this are in the past
    const nowHHMM = String(nowForFilter.getHours()).padStart(2, '0') + ':' +
                    String(nowForFilter.getMinutes()).padStart(2, '0');
    // A start date of today means we must block past slots.
    // For Consecutive Range / Specific Days modes start === first date in range.
    const isStartToday = (start === todayYMD);

    Array.from(startTimeInput.options).forEach(opt => {
      if (!opt.value) return;
      // Restore any previously applied past-time restriction first
      opt.disabled = false;
      opt.hidden   = false;
      opt.textContent = opt.dataset.label; // keep label clean — no status text

      if (isStartToday && opt.value <= nowHHMM) {
        // Past or exactly-now slot: hide it so the dropdown looks clean
        opt.disabled = true;
        opt.hidden   = true;
      }
    });

    // If the currently chosen start time was just hidden, clear it
    const chosen = startTimeInput.selectedOptions[0];
    if (chosen && (chosen.disabled || chosen.hidden)) {
      startTimeInput.value = '';
    }

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

  // Swap the defaults for the Admin-configured hours and closed days.
  window.CampusSchedule.loadRules(BASE).then(applyRules);

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
    return { ok: res.ok, status: res.status, json };
  }

  // ---------------------------------------------------------------
  // Conflict override (urgent) request. Shown when POST api/reservations
  // answers 409 with override_eligible: the slot is taken only by someone
  // else's Approved booking, so staff could move it. The customer either
  // goes back to pick another time or files POST
  // api/conflict-override-requests with a reason.
  // ---------------------------------------------------------------

  /** "2026-10-01 09:00:00" -> "Thu, Oct 1, 9:00 AM" (literal Manila wall-clock). */
  function formatSlot(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(value || ''));
    if (!m) return String(value || '');
    const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return day + ', ' + window.CampusSchedule.fmt12(m[4] + ':' + m[5]);
  }

  let overrideModal = null;

  function buildOverrideModal() {
    const wrap = document.createElement('div');
    wrap.className = 'fixed inset-0 z-[100] hidden items-center justify-center bg-black/40 p-4';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'overrideModalTitle');
    wrap.innerHTML = `
      <div class="w-full max-w-md rounded-2xl bg-white shadow-xl p-6 space-y-4">
        <div class="flex items-start gap-3">
          <span class="material-symbols-outlined text-amber-500 text-[28px]">event_busy</span>
          <div>
            <h2 id="overrideModalTitle" class="text-base font-bold text-gray-900">This room is already booked</h2>
            <p class="text-sm text-gray-600 mt-1" data-override-text></p>
          </div>
        </div>
        <div data-override-choice class="flex flex-col sm:flex-row gap-2 sm:justify-end">
          <button type="button" data-override-back class="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50">Choose a different time</button>
          <button type="button" data-override-open class="px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600">Request override (urgent)</button>
        </div>
        <form data-override-form class="hidden space-y-3" novalidate>
          <label class="block text-sm font-bold text-gray-800" for="overrideReason">Why is this urgent? <span class="text-red-500">*</span></label>
          <textarea id="overrideReason" rows="4" maxlength="500" class="w-full p-3 bg-[#f8f9fb] border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-[#7a1f2b]" placeholder="Explain why you need this exact slot. Staff will read this when deciding whether to ask the current holder to move."></textarea>
          <p class="text-xs text-gray-500">Staff review every override. If approved, the current booking is asked to move and your request joins the normal approval queue.</p>
          <p data-override-error class="hidden text-sm font-semibold text-red-600" role="alert"></p>
          <div class="flex flex-col sm:flex-row gap-2 sm:justify-end">
            <button type="button" data-override-back class="px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-gray-700 hover:bg-gray-50">Choose a different time</button>
            <button type="submit" data-override-submit class="px-4 py-2 rounded-xl bg-[#7a1f2b] text-white text-sm font-semibold hover:opacity-90">Submit override request</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(wrap);

    const close = () => { wrap.classList.add('hidden'); wrap.classList.remove('flex'); };
    wrap.querySelectorAll('[data-override-back]').forEach(b => b.addEventListener('click', close));
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !wrap.classList.contains('hidden')) close(); });
    wrap.querySelector('[data-override-open]').addEventListener('click', () => {
      wrap.querySelector('[data-override-choice]').classList.add('hidden');
      wrap.querySelector('[data-override-form]').classList.remove('hidden');
      wrap.querySelector('#overrideReason').focus();
    });
    wrap.querySelector('[data-override-form]').addEventListener('submit', (e) => {
      e.preventDefault();
      submitOverride();
    });
    return { wrap, close, payload: null };
  }

  function openOverrideModal(payload, conflict, message) {
    if (!overrideModal) overrideModal = buildOverrideModal();
    const { wrap } = overrideModal;
    overrideModal.payload = payload;

    const when = conflict && conflict.start_time
      ? `${formatSlot(conflict.start_time)} – ${window.CampusSchedule.fmt12(String(conflict.end_time).slice(11, 16))}`
      : 'the time you picked';
    wrap.querySelector('[data-override-text]').textContent =
      `This room is already booked during ${when}. You can pick another time, or request a slip for a conflict override.`;
    wrap.title = message || '';

    wrap.querySelector('[data-override-choice]').classList.remove('hidden');
    wrap.querySelector('[data-override-form]').classList.add('hidden');
    wrap.querySelector('#overrideReason').value = '';
    const err = wrap.querySelector('[data-override-error]');
    err.classList.add('hidden');
    wrap.querySelector('[data-override-submit]').disabled = false;

    wrap.classList.remove('hidden');
    wrap.classList.add('flex');
    wrap.querySelector('[data-override-back]').focus();
  }

  async function submitOverride() {
    const { wrap, close, payload } = overrideModal;
    const reason = wrap.querySelector('#overrideReason').value.trim();
    const err = wrap.querySelector('[data-override-error]');
    const btn = wrap.querySelector('[data-override-submit]');
    const fail = (msg) => { err.textContent = msg; err.classList.remove('hidden'); btn.disabled = false; };

    const altSchedule = wrap.querySelector('#rsAltSchedule') ? wrap.querySelector('#rsAltSchedule').value : 'No';
    const altDate = wrap.querySelector('input[name="alt_date"]') ? wrap.querySelector('input[name="alt_date"]').value : '';
    const altStart = wrap.querySelector('input[name="alt_start"]') ? wrap.querySelector('input[name="alt_start"]').value : '';
    const altEnd = wrap.querySelector('input[name="alt_end"]') ? wrap.querySelector('input[name="alt_end"]').value : '';

    if (!reason) return fail('Please explain why this booking is urgent.');
    btn.disabled = true;
    err.classList.add('hidden');

    const overridePayload = Object.assign({}, payload, { 
      reason,
      request_type: altSchedule === 'Yes' ? 'Alternative Schedule' : 'Specific Time',
      alt_start_time: altSchedule === 'Yes' && altDate && altStart ? `${altDate} ${altStart}:00` : null,
      alt_end_time: altSchedule === 'Yes' && altDate && altEnd ? `${altDate} ${altEnd}:00` : null
    });

    let result;
    try {
      result = await sendReservation('api/conflict-override-requests', overridePayload);
    } catch (_) {
      return fail('Could not reach the server. Check your connection and try again.');
    }
    if (!result) return;                                   // 401 → already redirecting to login
    const { ok, status, json } = result;
    if (!ok) {
      if (json && json.error) return fail(json.error);
      return fail(`The server sent an unexpected response (HTTP ${status}). Please try again.`);
    }
    if (json && !json.success) return fail(json.error || 'Your override request could not be submitted.');

    close();
    redirecting = true;
    setSubmitting(true);
    showSuccess('Override request sent: staff will review it and you can follow its status in My Reservations. Redirecting…');
    setTimeout(() => { window.location.href = 'my-reservations.html'; }, 1800);
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (submitting) return;
      hideCollisionError();

      const roomId      = roomSelect ? roomSelect.value : '';
      const dateVal     = startDateValue();
      const endDateVal  = endDateValue();
      const startVal    = startTimeInput ? startTimeInput.value : '';
      const endVal      = endTimeInput ? endTimeInput.value : '';
      const picked      = form.querySelector('input[name="reservation_purpose"]:checked');
      const description = purposeInput ? purposeInput.value.trim() : '';
      const policyBox   = document.getElementById('policyAcknowledgement');

      if (!roomId || !dateVal || !endDateVal || !startVal || !endVal) {
        return showCollisionError('Please choose a room, dates, start time and end time.', 'Missing information');
      }
      const problem = dateProblem(dateVal, endDateVal);
      if (problem) {
        setDateError(problem);
        return showCollisionError(problem, 'Invalid date');
      }
      if (!validateTime()) {
        return;
      }
      // The whole window must be free on every day, not just its first block.
      // (Only checked once the schedule has loaded; otherwise the server's
      // 409 says the same.)
      // A clash with Approved bookings only goes on to the server, whose 409
      // offers the urgent-override choice.
      const clash = rangeConflicts(startVal, endVal);
      if (clash.length && (isRebook || !window.CampusSchedule.onlyApprovedConflicts(clash))) {
        return showCollisionError(window.CampusSchedule.describeRange(clash, startVal, endVal), 'Scheduling conflict');
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
        purpose: description,
        category: PURPOSE_LABELS[picked.value],
        start_time: `${dateVal}T${startVal}:00`,
        end_time: `${endDateVal}T${endVal}:00`,
        equipment_notes: collectEquipmentNotes() || 'Standard Academic Setup'
      };
      if (getBookingMode() === 'specific') {
        payload.active_dates = getSelectedDates();
      }

      // Same body either way; only the endpoint differs. The rebook route
      // files the new booking under the ORIGINAL requester and logs where it
      // came from, which POST api/reservations cannot do.
      const endpoint = isRebook
        ? 'api/reservations/' + encodeURIComponent(rebookId) + '/rebook'
        : 'api/reservations';

      setSubmitting(true);
      sendReservation(endpoint, payload)
        .then(result => {
          if (!result) return;                       // 401
          const { ok, status, json } = result;

          if (!ok) {
            if (json && !json.success && status === 409 && !isRebook && json.data && json.data.override_eligible) {
              return openOverrideModal(payload, json.data.conflict, json.error);
            }
            return showCollisionError(
              (json && json.error) ? json.error : `The server sent an unexpected response (HTTP ${status}). Please try again.`,
              status === 409 ? 'Scheduling conflict' : 'Something went wrong'
            );
          }

          if (json && !json.success) {
            return showCollisionError(
              json.error || 'Your request could not be submitted.',
              status === 409 ? 'Scheduling conflict' : 'Unable to submit request'
            );
          }

          redirecting = true;
          let ref = 'REQ-XXXXXXXX';
          let dayCount = 1;
          if (json && json.data) {
              if (json.data.reservation_id) {
                  ref = 'REQ-' + String(json.data.reservation_id).substring(0, 8).toUpperCase();
              }
              if (Array.isArray(json.data.series)) {
                  dayCount = json.data.series.length;
              }
          }
          
          const what = isRebook ? 'Re-booking created'
            : dayCount > 1 ? `Reservation request created for ${dayCount} days` : 'Reservation request created';
          showSuccess(`${what}: ${ref} is now in the staff queue for verification. Redirecting to My Reservations…`);
          setTimeout(() => { window.location.href = 'my-reservations.html'; }, 1500);
        })
        .catch(() => showCollisionError('Could not reach the server. Check your connection and try again.', 'Network error'))
        .finally(() => { if (!redirecting) setSubmitting(false); });
    });
  }
};
