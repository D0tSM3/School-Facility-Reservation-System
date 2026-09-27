window.initBookingInlineScripts = function() {
    // ── Mini Date Picker ──────────────────────────────────────────────────────
    (function () {
      const trigger   = document.getElementById('miniCalTrigger');
      const popup     = document.getElementById('miniCalPopup');
      const grid      = document.getElementById('miniCalGrid');
      const label     = document.getElementById('miniCalMonthLabel');
      const display   = document.getElementById('miniCalDisplay');
      const prevBtn   = document.getElementById('miniCalPrev');
      const nextBtn   = document.getElementById('miniCalNext');
      const hiddenInput = document.getElementById('resDate');
      if (!trigger || !popup || !hiddenInput) return;

      const MAROON  = '#7a1f2b';
      const MONTHS  = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
      const toYMD   = d => d.getFullYear() + '-' +
                          String(d.getMonth()+1).padStart(2,'0') + '-' +
                          String(d.getDate()).padStart(2,'0');

      let cursor = new Date();   // month being displayed
      cursor.setDate(1);

      // earliest bookable: tomorrow, skip Sunday
      function minDate() {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        if (d.getDay() === 0) d.setDate(d.getDate() + 1);
        return toYMD(d);
      }

      function renderGrid() {
        const year  = cursor.getFullYear();
        const month = cursor.getMonth();
        label.textContent = `${MONTHS[month]} ${year}`;
        grid.innerHTML = '';

        const min     = minDate();
        const selYMD  = hiddenInput.value;
        const todayYMD = toYMD(new Date());
        const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        // blank cells before first day
        for (let i = 0; i < firstDay; i++) {
          const blank = document.createElement('div');
          grid.appendChild(blank);
        }

        for (let d = 1; d <= daysInMonth; d++) {
          const ymd  = toYMD(new Date(year, month, d));
          const dow  = new Date(year, month, d).getDay(); // 0=Sun
          const isPast   = ymd < min;
          const isSun    = dow === 0;
          const isToday  = ymd === todayYMD;
          const isSelected = ymd === selYMD;
          const disabled = isPast || isSun;

          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = d;
          btn.disabled = disabled;

          let cls = 'w-9 h-9 mx-auto flex items-center justify-center rounded-full text-[13px] font-semibold transition-colors ';
          if (isSelected) {
            cls += 'text-white';
            btn.style.backgroundColor = MAROON;
          } else if (disabled) {
            cls += 'text-gray-300 cursor-not-allowed';
          } else if (isToday) {
            cls += `border-2 text-[${MAROON}] hover:bg-[#fdf5f6]`;
            btn.style.borderColor = MAROON;
            btn.style.color = MAROON;
          } else {
            cls += 'text-gray-700 hover:bg-gray-100';
          }
          btn.className = cls;

          if (!disabled) {
            btn.addEventListener('click', () => selectDate(ymd));
          }
          grid.appendChild(btn);
        }
      }

      function selectDate(ymd) {
        hiddenInput.value = ymd;
        hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
        // Update trigger label
        const d = new Date(ymd + 'T00:00:00');
        display.textContent = d.toLocaleDateString('en-US', { weekday:'short', month:'long', day:'numeric', year:'numeric' });
        display.style.color = '#111827';
        popup.classList.add('hidden');
        renderGrid();
      }

      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        cursor.setMonth(cursor.getMonth() - 1);
        renderGrid();
      });
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        cursor.setMonth(cursor.getMonth() + 1);
        renderGrid();
      });

      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = !popup.classList.contains('hidden');
        if (isOpen) {
          popup.classList.add('hidden');
        } else {
          // Align cursor to currently selected or today
          const val = hiddenInput.value;
          if (val) {
            const d = new Date(val + 'T00:00:00');
            cursor = new Date(d.getFullYear(), d.getMonth(), 1);
          } else {
            const now = new Date();
            cursor = new Date(now.getFullYear(), now.getMonth(), 1);
          }
          renderGrid();
          popup.classList.remove('hidden');
        }
      });

      // Close on outside click
      document.addEventListener('click', (e) => {
        if (!popup.contains(e.target) && e.target !== trigger) {
          popup.classList.add('hidden');
        }
      });

      // Initial render (show month but keep closed)
      renderGrid();
    })()
    // ── Submit Button Validation Watcher ─────────────────────────────────────
    (function () {
      // Wait until the booking modal's form elements exist in the DOM.
      // booking.js runs after DOMContentLoaded, so we also wait for that.
      function runValidationWatcher() {
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
            cls = cls.replace('hover:bg-[#5b0617]', '').replace('cursor-pointer', 'cursor-not-allowed');
            submitBtn.className = cls.replace(/\s+/g, ' ').trim();
          }
        }

        // Watch every relevant field for changes
        const watchTargets = [roomSelect, resDate, startTime, endTime, purposeInput, policyBox];
        watchTargets.forEach(el => {
          if (!el) return;
          el.addEventListener('change', updateBtn);
          el.addEventListener('input',  updateBtn);
        });

        // Radios share a name — watch the form for radio changes too
        form.addEventListener('change', updateBtn);

        // Also re-check whenever the booking modal is opened (room pre-selected)
        const overlay = document.getElementById('bookingModalOverlay');
        if (overlay) {
          new MutationObserver(updateBtn).observe(overlay, { attributes: true, attributeFilter: ['class'] });
        }

        // Initial state
        updateBtn();
      });
    })()

if(typeof runValidationWatcher === "function") runValidationWatcher();
};
