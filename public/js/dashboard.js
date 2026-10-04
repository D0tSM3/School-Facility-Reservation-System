document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // Shared helper (js/util.js). Declared up here so nothing can call it before it exists.
  const { parseDate } = window.CampusRoomUtil;

  const summaryUpcoming = document.getElementById('summaryUpcoming');
  const summaryPast = document.getElementById('summaryPast');
  const summaryPending = document.getElementById('summaryPending');

  const BASE = window.location.pathname.replace(/[^\/]*$/, '');

  if (summaryUpcoming && summaryPast && summaryPending) {
    Promise.all([
      fetch(BASE + 'api/reservations/mine').then(res => res.json()).catch(() => ({ success: false, data: [] })),
      fetch(BASE + 'api/conflict-override-requests/mine').then(res => res.json()).catch(() => ({ success: false, data: [] }))
    ])
      .then(([resJson, ovJson]) => {
        let upcomingCount = 0;
        let pastCount = 0;
        let pendingCount = 0;

        if (resJson && resJson.success && Array.isArray(resJson.data)) {
          const reservations = resJson.data;
          const now = new Date();

          reservations.forEach(r => {
            if (r.status === 'Pending') pendingCount++;

            // parseDate() (js/util.js): strict-spec browsers like Safari
            // won't parse the space-separated "YYYY-MM-DD HH:MM:SS" form
            // `new Date(value)` gets here, so this used to silently drop
            // every reservation out of both the upcoming and past counts.
            const endTime = parseDate(r.end_time);
            if (!endTime) return; // unparseable: leave uncounted, same as before

            if (endTime > now && r.status !== 'Rejected' && r.status !== 'Cancelled') {
              upcomingCount++;
            } else if (endTime <= now && r.status !== 'Rejected' && r.status !== 'Cancelled') {
              pastCount++;
            }
          });
        }

        // Include pending conflict override requests (Request Slips)
        if (ovJson && ovJson.success && Array.isArray(ovJson.data)) {
          ovJson.data.forEach(o => {
            if (o.status === 'Pending' || o.outcome === 'Awaiting move') {
              pendingCount++;
            }
          });
        }

        summaryUpcoming.textContent = upcomingCount;
        summaryPast.textContent = pastCount;
        summaryPending.textContent = pendingCount;
      })
      .catch(err => console.error('Error fetching dashboard counts:', err));
  }

  // Quick Reserve functionality
  const quickReserveBtn = document.getElementById('quickReserveBtn');
  const quickReserveModal = document.getElementById('quickReserveModal');
  const closeQuickReserveBtn = document.getElementById('closeQuickReserveBtn');
  const cancelQuickReserveBtn = document.getElementById('cancelQuickReserveBtn');
  const submitQuickReserveBtn = document.getElementById('submitQuickReserveBtn');
  const qrErrorBanner = document.getElementById('qrErrorBanner');
  const qrErrorText = document.getElementById('qrErrorText');

  const qrDate = document.getElementById('qrDate');
  const qrEndDate = document.getElementById('qrEndDate');
  const qrStartTime = document.getElementById('qrStartTime');
  const qrEndTime = document.getElementById('qrEndTime');
  const qrCapacity = document.getElementById('qrCapacity');
  

  // Business hours and closed days (Admin > System Configuration, via
  // GET api/config). Defaults until loaded; the server enforces the real ones.
  const Schedule = window.CampusSchedule;
  let rules = Schedule ? Schedule.DEFAULT_RULES : { open: '06:00', close: '21:00', closedDays: ['Sunday'] };

  function format12(time24) {
    const [h, m] = time24.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
  }

  /** Half-hour marks from opening to closing, e.g. ['06:00', '06:30', ... '21:00']. */
  function timeMarks() {
    return Schedule ? Schedule.halfHours(rules.open, rules.close) : [];
  }

  /** Rebuild both time selects from the current hours (keeps the placeholder option). */
  function fillTimeOptions() {
    const marks = timeMarks();
    [[qrStartTime, marks.slice(0, -1)], [qrEndTime, marks.slice(1)]].forEach(([select, times]) => {
      Array.from(select.options).forEach(opt => { if (opt.value) opt.remove(); });
      times.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = format12(t);
        select.appendChild(opt);
      });
    });
  }

  if (qrStartTime && qrEndTime) {
    fillTimeOptions();
    if (Schedule) Schedule.loadRules(BASE).then(r => { rules = r; fillTimeOptions(); });

    qrStartTime.addEventListener('change', () => {
      const start = qrStartTime.value;
      const previous = qrEndTime.value;

      Array.from(qrEndTime.options).forEach(opt => {
        if (!opt.value) return; // skip placeholder
        if (start && opt.value <= start) {
          opt.disabled = true;
          opt.hidden = true;
        } else {
          opt.disabled = false;
          opt.hidden = false;
        }
      });
      
      if (previous && previous <= start) {
        qrEndTime.value = '';
      }
    });
  }

  function toggleQrModal(show) {
    if (!quickReserveModal) return;
    if (show) {
      quickReserveModal.classList.remove('hidden');
      if (qrDate) {
        const today = new Date();
        const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        qrDate.min = ymd;
      }
    } else {
      quickReserveModal.classList.add('hidden');
      qrErrorBanner.classList.add('hidden');
      if (qrDate) qrDate.value = '';
      if (qrStartTime) qrStartTime.value = '';
      if (qrEndTime) { qrEndTime.value = ''; Array.from(qrEndTime.options).forEach(opt => { opt.disabled = false; opt.hidden = false; }); }
      if (qrCapacity) qrCapacity.value = '';
      document.querySelectorAll('.qr-equipment-checkbox').forEach(cb => cb.checked = false);
    }
  }

  if (quickReserveBtn) quickReserveBtn.addEventListener('click', () => toggleQrModal(true));
  if (closeQuickReserveBtn) closeQuickReserveBtn.addEventListener('click', () => toggleQrModal(false));
  if (cancelQuickReserveBtn) cancelQuickReserveBtn.addEventListener('click', () => toggleQrModal(false));

  if (submitQuickReserveBtn) {
    submitQuickReserveBtn.addEventListener('click', () => {
      if (!qrDate.value || !qrStartTime.value || !qrEndTime.value || !qrCapacity.value) {
        qrErrorText.textContent = 'Please fill out all required fields.';
        qrErrorBanner.classList.remove('hidden');
        return;
      }
      
      const endDateValue = qrEndDate && qrEndDate.value ? qrEndDate.value : qrDate.value;
      
      if (Schedule && Schedule.isClosedDay(qrDate.value, rules.closedDays)) {
        qrErrorText.textContent = `BPU is closed on ${Schedule.dayName(qrDate.value)}s. Please pick another day.`;
        qrErrorBanner.classList.remove('hidden');
        return;
      }

      submitQuickReserveBtn.disabled = true;
      submitQuickReserveBtn.textContent = 'Submitting...';

      // Assemble payload
      let selectedEquipment = [];
      document.querySelectorAll('.qr-equipment-checkbox:checked').forEach(cb => {
        selectedEquipment.push(cb.getAttribute('data-equipment'));
      });
      const eqString = selectedEquipment.length > 0 ? selectedEquipment.join(', ') : '';
      const equipmentNotes = `Expected Capacity: ${qrCapacity.value}. ` + eqString;
      const purpose = `Quick Reserve Request`;
      
      const payload = {
        room_id: 'tbd00000-0000-4000-8000-000000000000',
        purpose: purpose,
        start_time: `${qrDate.value} ${qrStartTime.value}:00`,
        end_time: `${endDateValue} ${qrEndTime.value}:00`,
        category: 'Academic Lecture', // default
        equipment_notes: equipmentNotes
      };

      fetch(BASE + 'api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          window.location.href = 'my-reservations.html';
        } else {
          qrErrorText.textContent = json.error || 'Failed to submit reservation request.';
          qrErrorBanner.classList.remove('hidden');
          submitQuickReserveBtn.disabled = false;
          submitQuickReserveBtn.textContent = 'Submit Request';
        }
      })
      .catch(err => {
        qrErrorText.textContent = 'Network error. Please try again.';
        qrErrorBanner.classList.remove('hidden');
        submitQuickReserveBtn.disabled = false;
        submitQuickReserveBtn.textContent = 'Submit Request';
      });
    });
  }
});
