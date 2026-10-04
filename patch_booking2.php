<?php
$content = file_get_contents("public/js/booking.js");

$findValidateTime = <<<'EOD'
      if (endTimeInput.value && endTimeInput.value <= startTimeInput.value) {
        // Use the collision error banner already present in rooms.html
        showCollisionError('End time must be after the start time.', 'Invalid time');
        return false;
      } else {
        // Clear any time-related error if times are now valid
        hideCollisionError();
        return true;
      }
EOD;

$replaceValidateTime = <<<'EOD'
      if (endTimeInput.value) {
        if (endTimeInput.value <= startTimeInput.value) {
          showCollisionError('End time must be after the start time.', 'Invalid time');
          return false;
        }

        // Time boundaries are valid, check for conflict over the requested range
        hideCollisionError();
        const clash = rangeConflicts(startTimeInput.value, endTimeInput.value);
        if (clash.length) {
          // Show conflict UI
          const conflictBanner = document.getElementById('conflictBanner');
          const requestSlipBtn = document.getElementById('requestSlipBtn');
          if (conflictBanner) conflictBanner.classList.remove('hidden');
          if (requestSlipBtn) requestSlipBtn.classList.remove('hidden');
          
          // Populate Request Slip details
          const facilitySpan = document.getElementById('rsFacility');
          const dateSpan = document.getElementById('rsDate');
          const timeSpan = document.getElementById('rsTime');
          const conflictSpan = document.getElementById('rsConflictInfo');
          if (facilitySpan && roomSelect && roomSelect.options[roomSelect.selectedIndex]) {
             facilitySpan.textContent = roomSelect.options[roomSelect.selectedIndex].text;
          }
          if (dateSpan) dateSpan.textContent = mode === 'single' ? start : (start + ' to ' + endDateValue());
          if (timeSpan) timeSpan.textContent = startTimeInput.options[startTimeInput.selectedIndex].text + ' - ' + endTimeInput.options[endTimeInput.selectedIndex].text;
          if (conflictSpan) conflictSpan.textContent = window.CampusSchedule.describeRange(clash, startTimeInput.value, endTimeInput.value);

          return false; // blocks normal submit
        } else {
          // Hide conflict UI
          const conflictBanner = document.getElementById('conflictBanner');
          const requestSlipBtn = document.getElementById('requestSlipBtn');
          if (conflictBanner) conflictBanner.classList.add('hidden');
          if (requestSlipBtn) requestSlipBtn.classList.add('hidden');
          return true;
        }
      }
EOD;

$content = str_replace($findValidateTime, $replaceValidateTime, $content);

// Also hook up Request Slip Modal logic
$modalLogic = <<<'EOD'
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
EOD;

$content = str_replace("const validateTime = () => {", $modalLogic . "\n  const validateTime = () => {", $content);

file_put_contents("public/js/booking.js", $content);
echo "Done\n";
