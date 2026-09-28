document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const summaryUpcoming = document.getElementById('summaryUpcoming');
  const summaryPast = document.getElementById('summaryPast');
  const summaryPending = document.getElementById('summaryPending');

  const BASE = window.location.pathname.replace(/[^\/]*$/, '');

  if (summaryUpcoming && summaryPast && summaryPending) {
    fetch(BASE + 'api/reservations/mine')
      .then(res => res.json())
      .then(json => {
        if (json.success && json.data) {
          const reservations = json.data;
          const now = new Date();
          
          let upcomingCount = 0;
          let pastCount = 0;
          let pendingCount = 0;

          reservations.forEach(r => {
            if (r.status === 'Pending') pendingCount++;
            
            const endTime = new Date(r.end_time);
            if (endTime > now && r.status !== 'Rejected' && r.status !== 'Cancelled') {
              upcomingCount++;
            } else if (endTime <= now && r.status !== 'Rejected' && r.status !== 'Cancelled') {
              pastCount++;
            }
          });

          summaryUpcoming.textContent = upcomingCount;
          summaryPast.textContent = pastCount;
          summaryPending.textContent = pendingCount;
        }
      })
      .catch(err => console.error('Error fetching reservations:', err));
  }
});

  // Quick Reserve functionality
  const quickReserveBtn = document.getElementById('quickReserveBtn');
  const quickReserveModal = document.getElementById('quickReserveModal');
  const closeQuickReserveBtn = document.getElementById('closeQuickReserveBtn');
  const cancelQuickReserveBtn = document.getElementById('cancelQuickReserveBtn');
  const submitQuickReserveBtn = document.getElementById('submitQuickReserveBtn');
  const qrErrorBanner = document.getElementById('qrErrorBanner');
  const qrErrorText = document.getElementById('qrErrorText');

  const qrDate = document.getElementById('qrDate');
  const qrStartTime = document.getElementById('qrStartTime');
  const qrEndTime = document.getElementById('qrEndTime');
  const qrCapacity = document.getElementById('qrCapacity');
  

  const TIMES = [
    '06:00', '06:30', '07:00', '07:30', '08:00', '08:30', '09:00', '09:30',
    '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
    '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
    '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00'
  ];

  function format12(time24) {
    const [h, m] = time24.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
  }

  if (qrStartTime && qrEndTime) {
    TIMES.slice(0, -1).forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = format12(t);
      qrStartTime.appendChild(opt);
    });

    TIMES.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = format12(t);
      qrEndTime.appendChild(opt);
    });

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
        end_time: `${qrDate.value} ${qrEndTime.value}:00`,
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
