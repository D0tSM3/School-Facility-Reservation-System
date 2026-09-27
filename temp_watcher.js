window.initBookingInlineScripts = function () {
        const submitBtn    = document.getElementById('bookingSubmitBtn');
        const roomSelect   = document.getElementById('roomSelect');
        const resDate      = document.getElementById('resDate');
        const startTime    = document.getElementById('startTime');
        const endTime      = document.getElementById('endTime');
        const purposeInput = document.getElementById('purpose');
        const policyBox    = document.getElementById('policyAcknowledgement');
        const form         = document.getElementById('roomReservationForm');

        if (!submitBtn || !form) return;

        function isFormReady() {
          // 1. Facility selected
          if (!roomSelect || !roomSelect.value) return false;
          // 2. Date selected (hidden input set by mini calendar)
          if (!resDate || !resDate.value) return false;
          // 3. Start time
          if (!startTime || !startTime.value) return false;
          // 4. End time AND end > start
          if (!endTime || !endTime.value) return false;
          if (endTime.value <= startTime.value) return false;
          // 5. Classification radio
          const picked = form.querySelector('input[name="reservation_purpose"]:checked');
          if (!picked) return false;
          // 6. Purpose description (non-empty after trim)
          if (!purposeInput || !purposeInput.value.trim()) return false;
          // 7. Policy acknowledgement
          if (!policyBox || !policyBox.checked) return false;
          return true;
        }

        function updateBtn() {
          const ready = isFormReady();
          submitBtn.disabled = !ready;
          submitBtn.setAttribute('aria-disabled', String(!ready));
          if (ready) {
            submitBtn.className = submitBtn.className
              .replace('bg-gray-200', 'bg-[#7a1f2b]')
              .replace('text-gray-400', 'text-white')
              .replace('cursor-not-allowed', 'hover:bg-[#5b0617] cursor-pointer');
          } else {
            // Reset to disabled look
            let cls = submitBtn.className;
            if (!cls.includes('bg-gray-200'))   cls = cls.replace('bg-[#7a1f2b]', 'bg-gray-200');
            if (!cls.includes('text-gray-400'))  cls = cls.replace('text-white', 'text-gray-400');
