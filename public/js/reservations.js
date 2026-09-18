document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const tabs = document.querySelectorAll('.filter-tab');
  const reservationList = document.getElementById('reservationList');
  const searchInput = document.getElementById('reservationSearch');
  const modal = document.getElementById('cancelModal');
  const modalPermitCode = document.getElementById('modalPermitCode');
  const modalClose = document.getElementById('modalCloseBtn');
  const modalDismiss = document.getElementById('modalDismissBtn');
  const modalConfirm = document.getElementById('modalConfirmBtn');
  const newReservationBtn = document.getElementById('newReservationBtn');
  const exportSlipBtn = document.getElementById('exportSlipBtn');

  let currentTargetCard = null;
  let currentTargetReservationId = null;
  let activeFilter = 'all';
  let allReservations = [];

  const BASE = window.location.pathname.replace(/[^\/]*$/, '');

  function fetchReservations() {
    fetch(BASE + 'api/reservations/mine')
      .then(res => res.json())
      .then(json => {
        if (json.success && json.data) {
          allReservations = json.data;
          renderReservations();
          applyFilters();
        }
      })
      .catch(err => console.error('Error fetching reservations:', err));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    })[character]);
  }

  function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? { month: '---', day: '--' }
      : {
          month: date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
          day: date.toLocaleDateString('en-US', { day: '2-digit' })
        };
  }

  function formatTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? 'Time unavailable'
      : date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function renderReservations() {
    if (!reservationList) return;

    reservationList.innerHTML = allReservations.filter(r => r.status !== 'Cancelled').map(reservation => {
      const date = formatDate(reservation.start_time);
      // Determine strictly if it's past
      const isPast = new Date(reservation.end_time) < new Date();
      
      const canCancel = reservation.status === 'Pending';
      const statusClass = reservation.status === 'Approved'
        ? 'bg-[#DCFCE7] text-[#15803D]'
        : reservation.status === 'Rejected' || reservation.status === 'Cancelled'
          ? 'bg-[#FEE2E2] text-[#B91C1C]'
          : reservation.status === 'Completed'
            ? 'bg-[#F1F5F9] text-[#475569]'
            : 'bg-[#FEF3C7] text-[#B45309]';
      const statusIcon = reservation.status === 'Approved'
        ? 'check_circle'
        : reservation.status === 'Rejected' || reservation.status === 'Cancelled'
          ? 'error'
          : reservation.status === 'Completed'
            ? 'check_circle'
            : 'schedule';
            
      let moveStatusBadge = '';
      if (reservation.move_status === 'Pending') {
         moveStatusBadge = `<div class="mt-2 text-label-sm font-medium text-amber-600 bg-amber-50 px-2 py-1 rounded border border-amber-200">Move Request Pending review.</div>`;
      } else if (reservation.move_status === 'Rejected' && reservation.move_comment) {
         moveStatusBadge = `<div class="mt-2 text-label-sm font-medium text-red-600 bg-red-50 px-2 py-1 rounded border border-red-200">Move Request Rejected: ${escapeHtml(reservation.move_comment)}</div>`;
      }

      let action = '';
      if (canCancel) {
        action += `<button class="px-space-md py-space-sm bg-[#DC2626] hover:bg-[#B91C1C] text-[#FFFFFF] font-label-sm text-label-sm font-semibold rounded transition-colors flex items-center gap-1 shadow-sm cancel-trigger" data-id="${escapeHtml(reservation.reservation_id)}" data-permit="${escapeHtml(reservation.reservation_id)}"><span class="material-symbols-outlined text-[16px]">cancel</span><span>Cancel Booking</span></button>`;
      }
      if ((reservation.status === 'Pending' || reservation.status === 'Approved') && reservation.move_status !== 'Pending') {
        action += `<button class="px-space-md py-space-sm bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-label-sm text-label-sm font-semibold rounded transition-colors flex items-center gap-1 shadow-sm move-trigger ml-2" data-id="${escapeHtml(reservation.reservation_id)}"><span class="material-symbols-outlined text-[16px]">edit_calendar</span><span>Request to Move</span></button>`;
      }
      if (!action) {
        action = `<span class="p-space-sm text-on-surface-variant" title="Reservation details"><span class="material-symbols-outlined text-[20px]">visibility</span></span>`;
      }

      // Define filter status
      let filterStatus = reservation.status.toLowerCase();
      if (isPast && reservation.status !== 'Rejected' && reservation.status !== 'Cancelled') {
         filterStatus = 'history';
      }

      return `<div data-status="${escapeHtml(filterStatus)}" class="reservation-card bg-surface-container-lowest p-space-md rounded shadow-sm relative overflow-hidden transition-all duration-150 hover:shadow-md">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-space-md">
          <div class="flex items-start gap-space-md">
            <div class="p-space-sm rounded bg-surface-container flex flex-col items-center justify-center min-w-[56px] text-center">
              <span class="font-label-sm text-label-sm text-secondary font-bold uppercase">${date.month}</span>
              <span class="font-headline-md text-headline-md text-on-surface font-bold leading-none">${date.day}</span>
            </div>
            <div class="flex flex-col space-y-space-xs">
              <div class="flex items-center gap-space-sm flex-wrap">
                <span class="font-label-md text-label-md text-primary font-bold">REQ-${escapeHtml(reservation.reservation_id).substring(0,8)}</span>
                <span class="px-2 py-0.5 rounded font-label-sm text-label-sm font-bold ${statusClass} flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">${statusIcon}</span>${escapeHtml(reservation.status)}</span>
                <span class="text-body-sm font-body-sm text-on-surface-variant flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">schedule</span>${formatTime(reservation.start_time)} - ${formatTime(reservation.end_time)}</span>
              </div>
              <div class="font-headline-sm text-headline-sm text-on-surface font-semibold">${escapeHtml(reservation.purpose)}</div>
              <div class="flex items-center gap-space-md text-body-sm font-body-sm text-on-surface-variant flex-wrap">
                <span class="flex items-center gap-1 font-medium text-on-surface"><span class="material-symbols-outlined text-[16px] text-secondary">meeting_room</span>${escapeHtml(reservation.room_name || reservation.room_id)}</span>
              </div>
              ${moveStatusBadge}
            </div>
          </div>
          <div class="flex items-center gap-space-xs shrink-0 self-end md:self-center">${action}</div>
        </div>
      </div>`;
    }).join('');

    // Reattach listeners
    document.querySelectorAll('.cancel-trigger').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const permit = btn.getAttribute('data-permit') || '#BPU-XXXX';
        const id = btn.getAttribute('data-id');
        if (modalPermitCode) modalPermitCode.textContent = 'REQ-' + permit.substring(0,8);
        currentTargetCard = btn.closest('.reservation-card');
        currentTargetReservationId = id;
        if (modal) modal.classList.remove('hidden');
      });
    });

    document.querySelectorAll('.move-trigger').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        currentTargetReservationId = btn.getAttribute('data-id');
        const moveModalOverlay = document.getElementById('moveModalOverlay');
        const moveErrorMsg = document.getElementById('moveErrorMsg');
        if (moveErrorMsg) moveErrorMsg.classList.add('hidden');
        if (moveModalOverlay) {
          moveModalOverlay.classList.remove('opacity-0', 'pointer-events-none');
        }
      });
    });
  }

  if (newReservationBtn) {
    newReservationBtn.addEventListener('click', () => {
      window.location.href = 'rooms.html';
    });
  }

  if (exportSlipBtn) {
    exportSlipBtn.addEventListener('click', () => {
      let csv = 'Permit,Venue,Purpose,Start Time,End Time,Status\n';
      allReservations.forEach(r => {
        csv += `"REQ-${r.reservation_id.substring(0,8)}","${r.room_name || r.room_id}","${r.purpose}","${r.start_time}","${r.end_time}","${r.status}"\n`;
      });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Reservations_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  function applyFilters() {
    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();
    const cards = document.querySelectorAll('.reservation-card');

    cards.forEach(card => {
      const cardStatus = (card.getAttribute('data-status') || '').toLowerCase();
      const text = card.textContent.toLowerCase();

      // For "approved", let's make it match "approved"
      // For "pending", let's make it match "pending"
      // For "history", match "history" OR "completed" OR "rejected" OR "cancelled"
      let matchesFilter = false;
      if (activeFilter === 'all') matchesFilter = true;
      else if (activeFilter === 'history') {
        matchesFilter = ['history', 'completed', 'rejected', 'cancelled'].includes(cardStatus);
      }
      else {
        matchesFilter = (cardStatus === activeFilter);
      }

      const matchesSearch = !query || text.includes(query);

      if (matchesFilter && matchesSearch) {
        card.classList.remove('hidden');
        card.style.display = 'block';
      } else {
        card.classList.add('hidden');
        card.style.display = 'none';
      }
    });
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => {
        t.classList.remove('bg-primary', 'text-on-primary', 'font-semibold', 'shadow-sm');
        t.classList.add('text-on-surface-variant', 'hover:text-on-surface', 'hover:bg-surface-container');
      });
      tab.classList.add('bg-primary', 'text-on-primary', 'font-semibold', 'shadow-sm');
      tab.classList.remove('text-on-surface-variant', 'hover:text-on-surface', 'hover:bg-surface-container');

      activeFilter = tab.getAttribute('data-filter') || 'all';
      applyFilters();
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', applyFilters);
  }

  function closeModal() {
    if (modal) modal.classList.add('hidden');
    currentTargetCard = null;
    currentTargetReservationId = null;
    
    const moveModalOverlay = document.getElementById('moveModalOverlay');
    if (moveModalOverlay) moveModalOverlay.classList.add('opacity-0', 'pointer-events-none');
    const moveForm = document.getElementById('moveForm');
    if (moveForm) moveForm.reset();
  }

  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modalDismiss) modalDismiss.addEventListener('click', closeModal);
  
  const moveModalCloseIcon = document.getElementById('moveModalCloseIcon');
  if (moveModalCloseIcon) moveModalCloseIcon.addEventListener('click', closeModal);
  const moveModalCancelBtn = document.getElementById('moveModalCancelBtn');
  if (moveModalCancelBtn) moveModalCancelBtn.addEventListener('click', closeModal);

  const moveForm = document.getElementById('moveForm');
  if (moveForm) {
    moveForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const moveDate = document.getElementById('moveDate').value;
      const moveStartTime = document.getElementById('moveStartTime').value;
      const moveEndTime = document.getElementById('moveEndTime').value;
      const moveErrorMsg = document.getElementById('moveErrorMsg');

      if (!currentTargetReservationId || !moveDate || !moveStartTime || !moveEndTime) return;

      const requestedStart = `${moveDate} ${moveStartTime}:00`;
      const requestedEnd = `${moveDate} ${moveEndTime}:00`;

      fetch(`${BASE}api/reservations/${currentTargetReservationId}/move-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requested_start_time: requestedStart,
          requested_end_time: requestedEnd
        })
      })
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          fetchReservations(); // reload to show pending badge
          closeModal();
        } else {
          moveErrorMsg.textContent = json.error || 'Failed to submit move request.';
          moveErrorMsg.classList.remove('hidden');
        }
      })
      .catch(err => {
        console.error(err);
        moveErrorMsg.textContent = 'Network error.';
        moveErrorMsg.classList.remove('hidden');
      });
    });
  }

  if (modalConfirm) {
    modalConfirm.addEventListener('click', () => {
      if (currentTargetReservationId) {
        fetch(BASE + 'api/reservations/' + currentTargetReservationId + '/cancel', {
          method: 'PATCH'
        })
        .then(res => res.json())
        .then(json => {
           if (json.reservation_id || json.success) { // Handle both cases
             fetchReservations(); // reload entirely
           } else {
             alert(json.error || 'Failed to cancel reservation');
           }
        })
        .catch(err => {
           console.error(err);
           alert('Network error');
        });
      }
      closeModal();
    });
  }

  fetchReservations();
});
