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
  const newReservationButton = document.getElementById('newReservationBtn');
  const allReservationsCount = document.getElementById('allReservationsCount');
  const pendingReservationsCount = document.getElementById('pendingReservationsCount');
  const approvedReservationsCount = document.getElementById('approvedReservationsCount');
  const historyReservationsCount = document.getElementById('historyReservationsCount');
  const pageTitle = document.querySelector('main h1');
  const pageDescription = pageTitle ? pageTitle.parentElement.querySelector('p') : null;

  let currentTargetCard = null;
  let currentTargetReservationId = null;
  let activeFilter = 'all';
  let allReservations = [];
  let currentEndpoint = '';

  const BASE = window.location.pathname.replace(/[^\/]*$/, '');

  function parseLocalDateTime(value) {
    if (!value) return new Date(NaN);
    return new Date(String(value).replace(' ', 'T'));
  }

  function fetchReservations(endpoint) {
    currentEndpoint = endpoint;
    fetch(BASE + endpoint, { credentials: 'include' })
      .then(res => res.json())
      .then(json => {
        if (!json.success || !json.data) {
          console.error('Error fetching reservations:', json.error || 'Request failed');
          if (reservationList) {
            reservationList.innerHTML = `<div class="p-space-lg text-center text-error">${escapeHtml(json.error || 'Unable to load reservations.')}</div>`;
          }
          return;
        }

        allReservations = json.data;
        renderReservations();
        applyFilters();
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
    const date = parseLocalDateTime(value);
    return Number.isNaN(date.getTime())
      ? { month: '---', day: '--' }
      : {
          month: date.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
          day: date.toLocaleDateString('en-US', { day: '2-digit' })
        };
  }

  function formatTime(value) {
    const date = parseLocalDateTime(value);
    return Number.isNaN(date.getTime())
      ? 'Time unavailable'
      : date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function renderReservations() {
    if (!reservationList) return;

    const activeReservations = allReservations.filter(r => r.status !== 'Cancelled');
    const pendingCount = activeReservations.filter(r => r.status === 'Pending').length;
    const approvedCount = activeReservations.filter(r => r.status === 'Approved').length;
    const historyCount = activeReservations.filter(r => {
      const isPast = parseLocalDateTime(r.end_time) < new Date();
      return isPast || ['Completed', 'Rejected'].includes(r.status);
    }).length;

    if (allReservationsCount) allReservationsCount.textContent = activeReservations.length;
    if (pendingReservationsCount) pendingReservationsCount.textContent = pendingCount;
    if (approvedReservationsCount) approvedReservationsCount.textContent = approvedCount;
    if (historyReservationsCount) historyReservationsCount.textContent = historyCount;

    reservationList.innerHTML = activeReservations.map(reservation => {
      const date = formatDate(reservation.start_time);
      // Determine strictly if it's past
      const isPast = parseLocalDateTime(reservation.end_time) < new Date();
      
      const canCancel = currentRole === 'customer' && reservation.status === 'Pending';
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
            
      const action = canCancel
        ? `<button class="px-space-md py-space-sm bg-[#DC2626] hover:bg-[#B91C1C] text-[#FFFFFF] font-label-sm text-label-sm font-semibold rounded transition-colors flex items-center gap-1 shadow-sm cancel-trigger" data-id="${escapeHtml(reservation.reservation_id)}" data-permit="${escapeHtml(reservation.reservation_id)}"><span class="material-symbols-outlined text-[16px]">cancel</span><span>Cancel Booking</span></button>`
        : `<span class="p-space-sm text-on-surface-variant" title="Reservation details"><span class="material-symbols-outlined text-[20px]">visibility</span></span>`;

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
            </div>
          </div>
          <div class="flex items-center gap-space-xs shrink-0 self-end md:self-center">${action}</div>
        </div>
      </div>`;
    }).join('');

    if (activeReservations.length === 0) {
      reservationList.innerHTML = '<div class="p-space-lg text-center text-on-surface-variant">No reservations found.</div>';
    }

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
  }

  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modalDismiss) modalDismiss.addEventListener('click', closeModal);

  if (modalConfirm) {
    modalConfirm.addEventListener('click', () => {
      if (currentTargetReservationId) {
        fetch(BASE + 'api/reservations/' + currentTargetReservationId + '/cancel', {
          method: 'PATCH'
        })
        .then(res => res.json())
        .then(json => {
           if (json.success) {
             fetchReservations(currentEndpoint); // reload entirely
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

  let currentRole = 'customer';
  if (reservationList) {
    reservationList.innerHTML = '<div class="p-space-lg text-center text-on-surface-variant">Loading reservations...</div>';
  }
  fetch(BASE + 'api/auth/me', { credentials: 'include' })
    .then(res => res.json())
    .then(json => {
      const user = json.success ? json.data : null;
      if (!user) return;

      currentRole = String(user.role || '').toLowerCase();
      const isCustomer = currentRole === 'customer';
      if (newReservationButton) {
        newReservationButton.hidden = !isCustomer;
        newReservationButton.style.display = isCustomer ? 'inline-flex' : 'none';
      }
      if (!isCustomer) {
        if (pageTitle) pageTitle.textContent = 'Reservations';
        if (pageDescription) pageDescription.textContent = 'View facility reservations and their current approval status.';
      }

      fetchReservations(isCustomer ? 'api/reservations/mine' : 'api/reservations');
    })
    .catch(err => {
      console.error('Error fetching user session:', err);
      if (reservationList) {
        reservationList.innerHTML = '<div class="p-space-lg text-center text-error">Unable to verify your session. Please sign in again.</div>';
      }
    });
});
