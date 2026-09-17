/**
 * CampusRoom — My Reservations Management
 * Handles status tab filtering, search, interactive cancellation, and schedule export.
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const DB = window.CampusRoomDB;
  if (!DB) return;

  const currentUser = DB.getCurrentUser();
  const isAdmin = currentUser && currentUser.role === 'Admin';
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
  let activeFilter = 'all';

  const reservations = isAdmin
    ? DB.getReservations()
    : DB.getReservations(currentUser ? currentUser.user_id : null);

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

  function statusLabel(status) {
    return status === 'Pending' ? 'Pending Review' : status;
  }

  function renderReservations() {
    if (!reservationList) return;

    reservationList.innerHTML = reservations.map(reservation => {
      const date = formatDate(reservation.start_time);
      const room = DB.getRoomById(reservation.room_id);
      const owner = isAdmin
        ? `<span>Requester: ${escapeHtml(reservation.customer_name || reservation.customer_id)}</span><span>•</span>`
        : '';
      const canCancel = !isAdmin && reservation.status === 'Pending';
      const statusClass = reservation.status === 'Approved'
        ? 'bg-[#DCFCE7] text-[#15803D]'
        : reservation.status === 'Rejected'
          ? 'bg-[#FEE2E2] text-[#B91C1C]'
          : reservation.status === 'Completed'
            ? 'bg-[#F1F5F9] text-[#475569]'
            : 'bg-[#FEF3C7] text-[#B45309]';
      const statusIcon = reservation.status === 'Approved'
        ? 'check_circle'
        : reservation.status === 'Rejected'
          ? 'error'
          : reservation.status === 'Completed'
            ? 'check_circle'
            : 'schedule';
      const action = canCancel
        ? `<button class="px-space-md py-space-sm bg-[#DC2626] hover:bg-[#B91C1C] text-[#FFFFFF] font-label-sm text-label-sm font-semibold rounded transition-colors flex items-center gap-1 shadow-sm cancel-trigger" data-permit="${escapeHtml(reservation.reservation_id)}"><span class="material-symbols-outlined text-[16px]">cancel</span><span>Cancel Booking</span></button>`
        : `<span class="p-space-sm text-on-surface-variant" title="Reservation details"><span class="material-symbols-outlined text-[20px]">visibility</span></span>`;

      return `<div data-status="${escapeHtml(reservation.status.toLowerCase())}" class="reservation-card bg-surface-container-lowest p-space-md rounded shadow-sm relative overflow-hidden transition-all duration-150 hover:shadow-md">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-space-md">
          <div class="flex items-start gap-space-md">
            <div class="p-space-sm rounded bg-surface-container flex flex-col items-center justify-center min-w-[56px] text-center">
              <span class="font-label-sm text-label-sm text-secondary font-bold uppercase">${date.month}</span>
              <span class="font-headline-md text-headline-md text-on-surface font-bold leading-none">${date.day}</span>
            </div>
            <div class="flex flex-col space-y-space-xs">
              <div class="flex items-center gap-space-sm flex-wrap">
                <span class="font-label-md text-label-md text-primary font-bold">${escapeHtml(reservation.code || reservation.reservation_id)}</span>
                <span class="px-2 py-0.5 rounded font-label-sm text-label-sm font-bold ${statusClass} flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">${statusIcon}</span>${escapeHtml(statusLabel(reservation.status))}</span>
                <span class="text-body-sm font-body-sm text-on-surface-variant flex items-center gap-1"><span class="material-symbols-outlined text-[14px]">schedule</span>${formatTime(reservation.start_time)} - ${formatTime(reservation.end_time)}</span>
              </div>
              <div class="font-headline-sm text-headline-sm text-on-surface font-semibold">${escapeHtml(reservation.purpose)}</div>
              <div class="flex items-center gap-space-md text-body-sm font-body-sm text-on-surface-variant flex-wrap">
                ${owner}<span class="flex items-center gap-1 font-medium text-on-surface"><span class="material-symbols-outlined text-[16px] text-secondary">meeting_room</span>${escapeHtml(room ? room.name : reservation.room_id)}</span><span>•</span><span>Capacity: ${escapeHtml(room ? room.capacity : 'N/A')} pax</span>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-space-xs shrink-0 self-end md:self-center">${action}</div>
        </div>
      </div>`;
    }).join('');
  }

  renderReservations();

  const cards = document.querySelectorAll('.reservation-card');

  // Navigation Redirect for New Reservation
  if (newReservationBtn) {
    newReservationBtn.addEventListener('click', () => {
      window.location.href = 'book-room.html';
    });
  }

  // Export Schedule Slip
  if (exportSlipBtn) {
    exportSlipBtn.addEventListener('click', () => {
      let csv = 'Permit,Venue,Purpose,Start Time,End Time,Status\n';
      reservations.forEach(r => {
        csv += `"${r.code}","${r.room_id}","${r.purpose}","${r.start_time}","${r.end_time}","${r.status}"\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `BPU_Schedule_Permits_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  function applyFilters() {
    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();

    cards.forEach(card => {
      const cardStatus = (card.getAttribute('data-status') || '').toLowerCase();
      const text = card.textContent.toLowerCase();

      const matchesFilter = (activeFilter === 'all') || (cardStatus === activeFilter);
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

  document.querySelectorAll('.cancel-trigger').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const permit = btn.getAttribute('data-permit') || '#BPU-XXXX';
      if (modalPermitCode) modalPermitCode.textContent = permit;
      currentTargetCard = btn.closest('.reservation-card');
      if (modal) modal.classList.remove('hidden');
    });
  });

  function closeModal() {
    if (modal) modal.classList.add('hidden');
    currentTargetCard = null;
  }

  if (modalClose) modalClose.addEventListener('click', closeModal);
  if (modalDismiss) modalDismiss.addEventListener('click', closeModal);

  if (modalConfirm) {
    modalConfirm.addEventListener('click', () => {
      if (currentTargetCard) {
        const permit = modalPermitCode ? modalPermitCode.textContent : '';
        DB.cancelReservation(permit);

        currentTargetCard.style.opacity = '0.45';
        currentTargetCard.setAttribute('data-status', 'history');
        currentTargetCard.className = currentTargetCard.className.replace(/status-border-\w+/, 'status-border-rejected');

        const cancelBtn = currentTargetCard.querySelector('.cancel-trigger');
        if (cancelBtn) {
          cancelBtn.innerHTML = '<span class="material-symbols-outlined text-[16px]">done</span><span>Cancelled</span>';
          cancelBtn.disabled = true;
          cancelBtn.className = 'px-space-md py-space-sm bg-[#64748B] text-white font-label-sm text-label-sm font-semibold rounded shadow-sm cursor-not-allowed flex items-center gap-1';
        }

        const statusPill = currentTargetCard.querySelector('.font-label-sm.font-bold');
        if (statusPill) {
          statusPill.textContent = 'Cancelled by User';
          statusPill.className = 'px-2 py-0.5 rounded font-label-sm text-label-sm font-bold bg-[#FEE2E2] text-[#B91C1C] flex items-center gap-1';
        }
      }
      closeModal();
      applyFilters();
    });
  }
});
