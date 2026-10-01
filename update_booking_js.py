import re

with open("public/js/booking.js", "r", encoding="utf-8") as f:
    js = f.read()

# Add logic for active_dates and booking_mode
new_logic = """
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
        dateRangeHint.textContent = 'Select a single date.';
        if (resDateInput.value) {
          resEndDateInput.value = resDateInput.value; // Sync automatically
        }
      } else if (mode === 'range') {
        resDateWrapper.classList.remove('col-span-2');
        resDateWrapper.classList.add('w-full');
        resEndDateWrapper.classList.remove('hidden');
        resDateLabel.textContent = 'From';
        specificDaysWrapper.classList.add('hidden');
        dateRangeHint.textContent = 'Select a date range (maximum 7 consecutive days).';
      } else if (mode === 'specific') {
        resDateWrapper.classList.remove('col-span-2');
        resDateWrapper.classList.add('w-full');
        resEndDateWrapper.classList.remove('hidden');
        resDateLabel.textContent = 'From';
        specificDaysWrapper.classList.remove('hidden');
        dateRangeHint.textContent = 'Select a boundary date range (maximum 7 days), then pick specific days within it.';
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

      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      let curr = new Date(sDate);
      
      while (curr <= eDate) {
        const dateStr = toYMD(curr);
        const dayName = days[curr.getDay()];
        const display = `${dayName}, ${curr.getMonth()+1}/${curr.getDate()}`;
        
        const label = document.createElement('label');
        label.className = 'flex items-center gap-1.5 bg-gray-100 px-3 py-1.5 rounded-lg cursor-pointer hover:bg-gray-200 transition-colors border border-gray-200';
        label.innerHTML = `<input type="checkbox" name="active_days" value="${dateStr}" class="accent-[#7a1f2b]" checked><span class="text-xs font-semibold text-gray-700">${display}</span>`;
        
        label.querySelector('input').addEventListener('change', () => { onDatesChanged(); updateCalendarSelection(); });
        dayCheckboxesContainer.appendChild(label);
        
        curr.setDate(curr.getDate() + 1);
      }
    }

    bookingModeRadios.forEach(radio => {
      radio.addEventListener('change', updateBookingModeUI);
    });

    function getActiveDates() {
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
"""

js = js.replace("const form         = document.getElementById('roomReservationForm');", "const form         = document.getElementById('roomReservationForm');\n" + new_logic)

# Update dateProblem to enforce 7 day limit
old_dateProblem = """  function dateProblem(start, end) {
    if (end < start) return 'End date cannot be before start date.';
    if (!resDateInput.min) return ''; // no rules yet
    if (start < resDateInput.min) return `Bookings require at least ${rules.advanceDays} days notice (earliest is ${resDateInput.min}).`;
    if (rules.maxDaysAhead > 0) {
      const maxD = new Date();
      maxD.setDate(maxD.getDate() + rules.maxDaysAhead);
      if (start > toYMD(maxD)) return `Bookings cannot be more than ${rules.maxDaysAhead} days in advance.`;
    }
    return '';
  }"""
new_dateProblem = """  function dateProblem(start, end) {
    if (end < start) return 'End date cannot be before start date.';
    const sDate = new Date(start);
    const eDate = new Date(end);
    const diff = (eDate - sDate) / (1000 * 60 * 60 * 24);
    if (diff > 6 && getBookingMode() !== 'single') {
        return 'Multiple day bookings are strictly limited to a maximum range of 7 days.';
    }
    if (getBookingMode() === 'specific' && getActiveDates().length === 0) {
        return 'Please select at least one specific day.';
    }
    if (!resDateInput.min) return ''; // no rules yet
    if (start < resDateInput.min) return `Bookings require at least ${rules.advanceDays} days notice (earliest is ${resDateInput.min}).`;
    if (rules.maxDaysAhead > 0) {
      const maxD = new Date();
      maxD.setDate(maxD.getDate() + rules.maxDaysAhead);
      if (start > toYMD(maxD)) return `Bookings cannot be more than ${rules.maxDaysAhead} days in advance.`;
    }
    return '';
  }"""
js = js.replace(old_dateProblem, new_dateProblem)

# In isFormReady, add mode sync logic and active date checking
old_isFormReady = """          function isFormReady() {
            // 1. Facility selected
            if (!roomSelect || !roomSelect.value) return false;
            // 2. Dates selected
            if (!resDate || !resDate.value) return false;
            if (!resEndDate || !resEndDate.value) return false;
            // 3. Start time"""
new_isFormReady = """          function isFormReady() {
            if (getBookingMode() === 'single' && resDate) {
              resEndDate.value = resDate.value;
            }
            if (getBookingMode() === 'specific') {
              renderSpecificDays();
            }
            // 1. Facility selected
            if (!roomSelect || !roomSelect.value) return false;
            // 2. Dates selected
            if (!resDate || !resDate.value) return false;
            if (!resEndDate || !resEndDate.value) return false;
            if (dateProblem(resDate.value, resEndDate.value) !== '') return false;
            // 3. Start time"""
js = js.replace(old_isFormReady, new_isFormReady)


# Now update the fetch to submit active_dates
old_fetch = """        body: JSON.stringify({
          room_id: roomSelect.value,
          reservation_purpose: purposeInput.value.trim(),
          reservation_type: form.querySelector('input[name="reservation_purpose"]:checked').value,
          equipment_notes: (document.getElementById('equipment') || {}).value || '',
          start_time: startDateValue() + ' ' + startTimeInput.value,
          end_time: endDateValue() + ' ' + endTimeInput.value
        })"""
new_fetch = """        body: JSON.stringify({
          room_id: roomSelect.value,
          reservation_purpose: purposeInput.value.trim(),
          reservation_type: form.querySelector('input[name="reservation_purpose"]:checked').value,
          equipment_notes: (document.getElementById('equipment') || {}).value || '',
          start_time: startDateValue() + ' ' + startTimeInput.value,
          end_time: endDateValue() + ' ' + endTimeInput.value,
          active_dates: getActiveDates()
        })"""
js = js.replace(old_fetch, new_fetch)

with open("public/js/booking.js", "w", encoding="utf-8") as f:
    f.write(js)
