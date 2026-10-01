import re

with open("public/js/booking.js", "r", encoding="utf-8") as f:
    js = f.read()

# Fix isFormReady to not call renderSpecificDays constantly
bad_isFormReady = """            if (getBookingMode() === 'specific') {
              renderSpecificDays();
            }"""
js = js.replace(bad_isFormReady, "")

# We only want to render specific days when dates change!
old_onDatesChanged = """    function onDatesChanged() {
      const start = startDateValue(), end = endDateValue();"""
new_onDatesChanged = """    function onDatesChanged() {
      if (getBookingMode() === 'single') {
         if (resDateInput.value !== resEndDateInput.value) {
            resEndDateInput.value = resDateInput.value;
         }
      }
      
      const start = startDateValue(), end = endDateValue();
      
      // Render checkboxes if needed (only if range changed to avoid resetting checks unnecessarily)
      if (getBookingMode() === 'specific') {
         const currentHash = start + end;
         if (dayCheckboxesContainer.dataset.lastHash !== currentHash) {
             renderSpecificDays();
             dayCheckboxesContainer.dataset.lastHash = currentHash;
         }
      }
"""
js = js.replace(old_onDatesChanged, new_onDatesChanged)

with open("public/js/booking.js", "w", encoding="utf-8") as f:
    f.write(js)
