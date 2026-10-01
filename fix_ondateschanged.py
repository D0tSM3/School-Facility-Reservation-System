import re

with open("public/js/booking.js", "r", encoding="utf-8") as f:
    js = f.read()

old_onDatesChanged = r"""    function onDatesChanged\(\) \{\s*const start = startDateValue\(\), end = endDateValue\(\);\s*if \(\!isRealDate\(start\) \|\| \!isRealDate\(end\)\) \{ setDateError\(''\); return; \}\s*setDateError\(dateProblem\(start, end\)\);\s*// message only; never wipe what they typed\s*if \(calendarInstance\) calendarInstance\.goToDate\(start\);\s*updateCalendarSelection\(\);\s*markTakenSlots\(\);\s*\}"""

new_onDatesChanged = """    function onDatesChanged() {
      if (typeof getBookingMode === 'function' && getBookingMode() === 'single') {
         if (resDateInput && resEndDateInput && resDateInput.value !== resEndDateInput.value) {
            resEndDateInput.value = resDateInput.value;
         }
      }
      
      const start = startDateValue(), end = endDateValue();
      
      if (typeof getBookingMode === 'function' && getBookingMode() === 'specific') {
         const currentHash = start + end;
         const dayCheckboxesContainer = document.getElementById('dayCheckboxes');
         if (dayCheckboxesContainer && dayCheckboxesContainer.dataset.lastHash !== currentHash) {
             if (typeof renderSpecificDays === 'function') renderSpecificDays();
             dayCheckboxesContainer.dataset.lastHash = currentHash;
         }
      }

      if (!isRealDate(start) || !isRealDate(end)) { setDateError(''); return; }
      setDateError(dateProblem(start, end));
      if (calendarInstance) calendarInstance.goToDate(start);
      updateCalendarSelection();
      markTakenSlots();
    }"""

js = re.sub(old_onDatesChanged, new_onDatesChanged, js, flags=re.DOTALL)

with open("public/js/booking.js", "w", encoding="utf-8") as f:
    f.write(js)
