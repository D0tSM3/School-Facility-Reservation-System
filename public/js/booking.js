/**
 * CampusRoom — Facility Reservation Logic
 * Enforces MySQL overlap-prevention trigger, field validation, and reservation dispatch.
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const BASE = window.location.pathname.replace(/[^\/]*$/, '');

  const form = document.getElementById('roomReservationForm');
  const roomSelect = document.getElementById('roomSelect');
  const resDateInput = document.getElementById('resDate');
  const startTimeInput = document.getElementById('startTime');
  const endTimeInput = document.getElementById('endTime');
  const purposeInput = document.getElementById('purpose');
  const errorBanner = document.getElementById('collisionErrorBanner');
  const errorBannerText = document.getElementById('collisionErrorText');
  const successBanner = document.getElementById('bookingSuccessBanner');
  const successBannerText = document.getElementById('bookingSuccessText');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');

  function navigateBack() {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = 'dashboard.html';
    }
  }

  if (closeModalBtn) closeModalBtn.addEventListener('click', navigateBack);
  if (cancelModalBtn) cancelModalBtn.addEventListener('click', navigateBack);

  // Read query parameters (e.g. ?room=THN-204)
  const urlParams = new URLSearchParams(window.location.search);
  const preselectedRoom = urlParams.get('room');

  if (roomSelect) {
    fetch(BASE + 'api/rooms')
      .then(res => res.json())
      .then(json => {
        if (!json.success || !json.data) return;
        const rooms = json.data;
        roomSelect.innerHTML = '';
        rooms.forEach(r => {
          const opt = document.createElement('option');
          opt.value = r.room_id;
          opt.textContent = `${r.building_name || ''} - ${r.name} (${r.room_type || 'General'} • ${r.capacity} seats)`;
          if (r.status === 'Maintenance') {
            opt.textContent += ' [Under Maintenance]';
            opt.disabled = true;
          }
          if (preselectedRoom && (r.room_id === preselectedRoom)) {
            opt.selected = true;
          }
          roomSelect.appendChild(opt);
        });

        if (!roomSelect.value && roomSelect.options.length > 0) {
          roomSelect.selectedIndex = 0;
        }
        
        // Initialize calendar with the selected room
        if (typeof updateCalendar === 'function' && roomSelect.value) {
            updateCalendar(roomSelect.value);
        }
        updatePurpose();
      })
      .catch(err => console.error('Error fetching rooms:', err));
  }

  // --- Room Calendar Integration ---
  let calendarInstance = null;
  function updateCalendar(roomId) {
    if (!roomId) return;
    const container = document.getElementById('room-calendar-container');
    if (container) {
      if (typeof RoomCalendar !== 'undefined') {
        calendarInstance = new RoomCalendar({
          containerId: 'room-calendar-container',
          roomId: roomId
        });
      }
    }
  }

  if (roomSelect) {
    roomSelect.addEventListener('change', (e) => {
      updateCalendar(e.target.value);
      updatePurpose();
    });
  }
  
  if (preselectedRoom) {
    updateCalendar(preselectedRoom);
  }

  if (resDateInput && !resDateInput.value) {
    const today = new Date();
    today.setDate(today.getDate() + 1);
    resDateInput.value = today.toISOString().split('T')[0];
  }

  if (resDateInput) {
    resDateInput.addEventListener('change', () => {
      updatePurpose();
    });
  }

  let purposeEdited = false;
  if (purposeInput) {
    purposeInput.addEventListener('input', () => {
      purposeEdited = true;
    });
  }

  function updatePurpose() {
    if (!purposeInput || purposeEdited) return;
    const date = resDateInput ? resDateInput.value : '';
    let roomName = '';
    if (roomSelect && roomSelect.options.length > 0 && roomSelect.selectedIndex >= 0) {
      roomName = roomSelect.options[roomSelect.selectedIndex].text;
      // Remove any tags like "[Under Maintenance]" or "[Unavailable]" if we just want the base room name, but for now we take the full text
    }
    if (roomName && date) {
      purposeInput.value = `${roomName} - ${date}`;
    }
  }

  function showCollisionError(message) {
    if (errorBanner) {
      if (errorBannerText) errorBannerText.textContent = message;
      errorBanner.classList.remove('hidden');
      errorBanner.classList.add('flex');
      errorBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      alert(message);
    }
    if (successBanner) {
      successBanner.classList.add('hidden');
      successBanner.classList.remove('flex');
    }
  }

  function hideCollisionError() {
    if (errorBanner) {
      errorBanner.classList.add('hidden');
      errorBanner.classList.remove('flex');
    }
  }

  function showSuccess(message) {
    if (successBanner) {
      if (successBannerText) successBannerText.textContent = message;
      successBanner.classList.remove('hidden');
      successBanner.classList.add('flex');
      successBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    hideCollisionError();
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      hideCollisionError();

      const roomId = roomSelect ? roomSelect.value : '';
      const dateVal = resDateInput ? resDateInput.value : '';
      const startVal = startTimeInput ? startTimeInput.value : '';
      const endVal = endTimeInput ? endTimeInput.value : '';
      const purpose = purposeInput ? purposeInput.value.trim() : '';

      if (!roomId || !dateVal || !startVal || !endVal) {
        showCollisionError('Please provide a room, date, start time, and end time for the reservation.');
        return;
      }

      if (!purpose) {
        showCollisionError('Please specify the academic purpose for this facility reservation.');
        return;
      }

      const startDateTimeStr = `${dateVal}T${startVal}:00`;
      const endDateTimeStr = `${dateVal}T${endVal}:00`;

      const startDate = new Date(startDateTimeStr);
      const endDate = new Date(endDateTimeStr);

      if (endDate <= startDate) {
        showCollisionError('Invalid Schedule: End time must be strictly after the start time.');
        if (endTimeInput) endTimeInput.focus();
        return;
      }

      const equipmentNotes = [];
      const checkboxes = form.querySelectorAll('input[type="checkbox"]:checked');
      checkboxes.forEach(cb => {
        const label = cb.closest('label');
        if (label) equipmentNotes.push(label.textContent.trim());
      });

      const payload = {
        room_id: roomId,
        purpose: purpose,
        start_time: startDateTimeStr,
        end_time: endDateTimeStr,
        equipment_notes: equipmentNotes.join(', ') || 'Standard Academic Setup'
      };

      fetch(BASE + 'api/reservations', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })
      .then(res => res.json())
      .then(json => {
        if (!json.success) {
          showCollisionError(json.error || 'Failed to create reservation due to scheduling conflict.');
        } else {
          const newRes = json.data;
          showSuccess(`Reservation Permit Created: REQ-${newRes.reservation_id.substring(0,8)} has been placed in the Staff Dispatch Queue for verification.`);
          form.reset();
          if (roomSelect) roomSelect.value = roomId;
          
          if (resDateInput) {
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            resDateInput.value = tomorrow.toISOString().split('T')[0];
          }
          if (startTimeInput) startTimeInput.value = '08:00';
          if (endTimeInput) endTimeInput.value = '10:00';
        }
      })
      .catch(err => {
        console.error('API Error:', err);
        showCollisionError('A network error occurred while communicating with the facility server.');
      });
    });
  }
});
