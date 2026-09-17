/**
 * CampusRoom — Facility Reservation Logic
 * Enforces MySQL overlap-prevention trigger, field validation, and reservation dispatch.
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const DB = window.CampusRoomDB;
  if (!DB) return;

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
    const rooms = DB.getRooms();
    roomSelect.innerHTML = '';
    rooms.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.code || r.room_id;
      opt.textContent = `${r.building_name} - ${r.name} (${r.room_type} • ${r.capacity} seats)`;
      if (r.status === 'Maintenance') {
        opt.textContent += ' [Under Maintenance]';
        opt.disabled = true;
      }
      if (preselectedRoom && (r.room_id === preselectedRoom || r.code === preselectedRoom)) {
        opt.selected = true;
      }
      roomSelect.appendChild(opt);
    });

    if (!roomSelect.value && roomSelect.options.length > 0) {
      roomSelect.selectedIndex = 0;
    }
  }

  if (resDateInput && !resDateInput.value) {
    const today = new Date();
    today.setDate(today.getDate() + 1);
    resDateInput.value = today.toISOString().split('T')[0];
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

      const roomId = roomSelect ? roomSelect.value : 'THN-204';
      const dateVal = resDateInput ? resDateInput.value : '';
      const startVal = startTimeInput ? startTimeInput.value : '';
      const endVal = endTimeInput ? endTimeInput.value : '';
      const purpose = purposeInput ? purposeInput.value.trim() : '';

      if (!dateVal || !startVal || !endVal) {
        showCollisionError('Please provide a complete date, start time, and end time for the reservation.');
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

      try {
        const newRes = DB.createReservation({
          room_id: roomId,
          purpose: purpose,
          start_time: startDateTimeStr,
          end_time: endDateTimeStr,
          equipment_notes: equipmentNotes.join(', ') || 'Standard Academic Setup'
        });

        showSuccess(`Reservation Permit Created: ${newRes.code} has been placed in the Staff Dispatch Queue for verification.`);

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.classList.add('opacity-50', 'pointer-events-none');
          submitBtn.textContent = 'Permit Submitted';
        }

        setTimeout(() => {
          window.location.href = 'my-reservations.html';
        }, 1200);

      } catch (err) {
        showCollisionError(err.message || 'Scheduling Collision: Room is already booked or pending during this time window.');
        if (endTimeInput) {
          endTimeInput.focus();
          endTimeInput.parentElement.classList.add('animate-pulse');
          setTimeout(() => {
            endTimeInput.parentElement.classList.remove('animate-pulse');
          }, 1000);
        }
      }
    });
  }
});
