import re

with open("public/js/booking.js", "r", encoding="utf-8") as f:
    js = f.read()

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
            const count = document.querySelectorAll('input[name="active_days"]:checked').length;
            if (counter) counter.textContent = `${count} selected`;
            onDatesChanged(); 
            updateCalendarSelection(); 
        });
        dayCheckboxesContainer.appendChild(label);
        
        curr.setDate(curr.getDate() + 1);
      }
      if (counter) {
        const count = document.querySelectorAll('input[name="active_days"]:checked').length;
        counter.textContent = `${count} selected`;
      }
    }

    if (bookingModeRadios) {
      bookingModeRadios.forEach(radio => {
        radio.addEventListener('change', updateBookingModeUI);
      });
    }

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

js = re.sub(r'const form\s*=\s*document\.getElementById\(\'roomReservationForm\'\);', r"const form = document.getElementById('roomReservationForm');\n" + new_logic, js)

# Update dateProblem to enforce 7 day limit
old_dateProblem = """  function dateProblem(start, end) {
    if (!start || !end) return '';
    if (resDateInput && resDateInput.min && start < resDateInput.min) {
      return 'Bookings open starting tomorrow. Please pick a later date.';
    }
    if (end < start) {
      return 'The end date must be on or after the start date.';
    }
    const days = window.CampusSchedule.datesBetween(start, end);"""
new_dateProblem = """  function dateProblem(start, end) {
    if (!start || !end) return '';
    const sDate = new Date(start);
    const eDate = new Date(end);
    const diff = (eDate - sDate) / (1000 * 60 * 60 * 24);
    if (diff > 6 && getBookingMode() !== 'single') {
        return 'Multiple day bookings are strictly limited to a maximum range of 7 days.';
    }
    if (getBookingMode() === 'specific' && getActiveDates().length === 0) {
        return 'Please select at least one specific day.';
    }
    if (resDateInput && resDateInput.min && start < resDateInput.min) {
      return 'Bookings open starting tomorrow. Please pick a later date.';
    }
    if (end < start) {
      return 'The end date must be on or after the start date.';
    }
    const days = window.CampusSchedule.datesBetween(start, end);"""
js = js.replace(old_dateProblem, new_dateProblem)

# In isFormReady, add mode sync logic and active date checking
old_isFormReady = """          function isFormReady() {
            // 1. Facility selected
            if (!roomSelect || !roomSelect.value) return false;
            if (!resDate || !resDate.value) return false;
            if (!resEndDate || !resEndDate.value) return false;"""
new_isFormReady = """          function isFormReady() {
            if (getBookingMode() === 'single' && resDate) {
              resEndDate.value = resDate.value;
            }
            // 1. Facility selected
            if (!roomSelect || !roomSelect.value) return false;
            if (!resDate || !resDate.value) return false;
            if (!resEndDate || !resEndDate.value) return false;
            if (dateProblem(resDate.value, resEndDate.value) !== '') return false;"""
js = js.replace(old_isFormReady, new_isFormReady)

old_onDatesChanged = """    function onDatesChanged() {
      const start = startDateValue(), end = endDateValue();"""
new_onDatesChanged = """    function onDatesChanged() {
      if (getBookingMode() === 'single') {
         if (resDateInput.value !== resEndDateInput.value) {
            resEndDateInput.value = resDateInput.value;
         }
      }
      
      const start = startDateValue(), end = endDateValue();
      
      // Render checkboxes if needed
      if (getBookingMode() === 'specific') {
         const currentHash = start + end;
         if (dayCheckboxesContainer && dayCheckboxesContainer.dataset.lastHash !== currentHash) {
             renderSpecificDays();
             dayCheckboxesContainer.dataset.lastHash = currentHash;
         }
      }
"""
js = js.replace(old_onDatesChanged, new_onDatesChanged)


old_fetch = """        const payload = {
          room_id: roomId,
          // `purpose` is now the requester's description only; the classification
          // travels in its own column instead of being glued to the front.
          purpose: description,
          category: PURPOSE_LABELS[picked.value],
          // Different dates = a multi-day booking: the server books
          // startVal\u2013endVal on every day from dateVal to endDateVal.
          start_time: `${dateVal}T${startVal}:00`,
          end_time: `${endDateVal}T${endVal}:00`,
          equipment_notes: collectEquipmentNotes() || 'Standard Academic Setup'
        };"""
new_fetch = """        const payload = {
          room_id: roomId,
          purpose: description,
          category: PURPOSE_LABELS[picked.value],
          start_time: `${dateVal}T${startVal}:00`,
          end_time: `${endDateVal}T${endVal}:00`,
          equipment_notes: collectEquipmentNotes() || 'Standard Academic Setup',
          active_dates: getActiveDates()
        };"""
js = js.replace(old_fetch, new_fetch)

with open("public/js/booking.js", "w", encoding="utf-8") as f:
    f.write(js)
