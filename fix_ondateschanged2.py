import re

with open("public/js/booking.js", "r", encoding="utf-8") as f:
    js = f.read()

# I will find function onDatesChanged() exactly
match = re.search(r'function onDatesChanged\(\) \{.*?markTakenSlots\(\);\s*\}', js, re.DOTALL)
if match:
    new_func = """function onDatesChanged() {
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
      setDateError(dateProblem(start, end));              // message only; never wipe what they typed
      if (calendarInstance) calendarInstance.goToDate(start);
      updateCalendarSelection();
      markTakenSlots();
    }"""
    js = js.replace(match.group(0), new_func)

with open("public/js/booking.js", "w", encoding="utf-8") as f:
    f.write(js)
