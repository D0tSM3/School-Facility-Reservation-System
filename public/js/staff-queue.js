/**
 * CampusRoom — Staff Dispatch & Room Maintenance Queue
 * Handles booking approvals, rejections, batch sign-offs, and room maintenance toggles.
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const DB = window.CampusRoomDB;
  if (!DB) return;

  const tabPending = document.getElementById('tab-pending');
  const tabMaintenance = document.getElementById('tab-maintenance');
  const viewPending = document.getElementById('view-pending');
  const viewMaintenance = document.getElementById('view-maintenance');
  const pendingBadge = document.getElementById('pending-badge-count');
  const pendingKpi = document.getElementById('kpi-pending-count');
  const authKpi = document.getElementById('kpi-auth-count');
  const batchApproveBtn = document.getElementById('btn-batch-approve');
  const exportLogBtn = document.getElementById('btn-export-log');
  const toast = document.getElementById('action-toast');
  const toastText = document.getElementById('action-toast-text');
  const toastDismiss = document.getElementById('btn-dismiss-toast');
  const toggle310Btn = document.getElementById('btn-toggle-310');

  let pendingCount = 4;
  let authorizedCount = 31;

  function switchQueueTab(tab) {
    if (!tabPending || !tabMaintenance || !viewPending || !viewMaintenance) return;

    if (tab === 'pending') {
      tabPending.classList.add('bg-surface-container-lowest', 'text-primary', 'shadow-sm');
      tabPending.classList.remove('text-on-surface-variant');
      tabMaintenance.classList.remove('bg-surface-container-lowest', 'text-primary', 'shadow-sm');
      tabMaintenance.classList.add('text-on-surface-variant');

      viewPending.classList.remove('hidden');
      viewMaintenance.classList.add('hidden');
    } else {
      tabMaintenance.classList.add('bg-surface-container-lowest', 'text-primary', 'shadow-sm');
      tabMaintenance.classList.remove('text-on-surface-variant');
      tabPending.classList.remove('bg-surface-container-lowest', 'text-primary', 'shadow-sm');
      tabPending.classList.add('text-on-surface-variant');

      viewPending.classList.add('hidden');
      viewMaintenance.classList.remove('hidden');
    }
  }

  if (tabPending) tabPending.addEventListener('click', () => switchQueueTab('pending'));
  if (tabMaintenance) tabMaintenance.addEventListener('click', () => switchQueueTab('maintenance'));

  function showToast(msg) {
    if (toast && toastText) {
      toastText.textContent = msg;
      toast.classList.remove('hidden');
      toast.classList.add('animate-toast-in');
    }
  }

  function dismissToast() {
    if (toast) toast.classList.add('hidden');
  }

  if (toastDismiss) toastDismiss.addEventListener('click', dismissToast);

  function updateCounters(deltaPending, deltaAuth = 0) {
    pendingCount = Math.max(0, pendingCount + deltaPending);
    authorizedCount += deltaAuth;

    if (pendingBadge) pendingBadge.textContent = `${pendingCount} Requests`;
    if (pendingKpi) pendingKpi.textContent = pendingCount.toString();
    if (authKpi) authKpi.textContent = authorizedCount.toString();
  }

  const approveButtons = document.querySelectorAll('.btn-approve-req');
  approveButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id') || 'BPU-XXXX';
      const name = btn.getAttribute('data-name') || 'Requester';
      const card = document.getElementById('card-' + id);

      if (card) {
        card.style.opacity = '0.3';
        setTimeout(() => {
          card.remove();
          updateCounters(-1, 1);
          DB.updateReservationStatus(id, 'Approved');
          showToast(`Application ${id} (${name}) Approved. Electronic permit and keycard permissions dispatched.`);
        }, 250);
      }
    });
  });

  const rejectButtons = document.querySelectorAll('.btn-reject-req');
  rejectButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id') || 'BPU-XXXX';
      const name = btn.getAttribute('data-name') || 'Requester';
      const card = document.getElementById('card-' + id);

      if (card) {
        card.style.opacity = '0.3';
        setTimeout(() => {
          card.remove();
          updateCounters(-1, 0);
          DB.updateReservationStatus(id, 'Rejected');
          showToast(`Application ${id} (${name}) Rejected. Institutional notice sent to requester.`);
        }, 250);
      }
    });
  });

  if (batchApproveBtn) {
    batchApproveBtn.addEventListener('click', () => {
      const card1 = document.getElementById('card-BPU-9102');
      const card2 = document.getElementById('card-BPU-9105');
      let removed = 0;

      if (card1) { card1.remove(); removed++; DB.updateReservationStatus('BPU-9102', 'Approved'); }
      if (card2) { card2.remove(); removed++; DB.updateReservationStatus('BPU-9105', 'Approved'); }

      if (removed > 0) {
        updateCounters(-removed, removed);
        batchApproveBtn.textContent = 'Batch Completed';
        batchApproveBtn.classList.add('opacity-50', 'pointer-events-none');
        showToast(`Batch approved verified faculty reservations (#BPU-9102, #BPU-9105). Digital door schedules updated.`);
      } else {
        showToast('No pending verified reservations available for batch approval.');
      }
    });
  }

  if (toggle310Btn) {
    toggle310Btn.addEventListener('click', () => {
      const banner = document.getElementById('room-310-banner');
      if (banner) {
        banner.classList.add('bg-[#DCFCE7]/40');
        const textH2 = banner.querySelector('h2');
        const textP = banner.querySelector('p');
        if (textH2) textH2.textContent = 'Humanities Complex • Room 310 is Now Available';
        if (textP) textP.textContent = 'Room status changed to ACTIVE. Ready for academic dispatching.';
        
        toggle310Btn.innerHTML = '<span class="material-symbols-outlined text-[20px] text-green-600">check_circle</span><span>Room 310 Active</span>';
        toggle310Btn.classList.replace('bg-primary', 'bg-[#15803D]');
        toggle310Btn.classList.add('pointer-events-none');

        DB.updateRoom('rm-mq-310', { status: 'Available' });
        showToast('Room 310 restored to Available in the master campus database.');
      }
    });
  }

  const facilityToggleButtons = document.querySelectorAll('.btn-toggle-facility');
  facilityToggleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const roomName = btn.getAttribute('data-room-name') || 'Facility';
      const roomId = btn.getAttribute('data-room-id');

      if (btn.textContent.includes('Maintenance')) {
        btn.textContent = 'Set Available';
        btn.classList.replace('bg-surface-container-highest', 'bg-secondary-fixed');
        if (roomId) DB.updateRoom(roomId, { status: 'Maintenance' });
        showToast(`${roomName} flagged for maintenance inspection.`);
      } else {
        btn.textContent = 'Set Maintenance';
        btn.classList.replace('bg-secondary-fixed', 'bg-surface-container-highest');
        if (roomId) DB.updateRoom(roomId, { status: 'Available' });
        showToast(`${roomName} restored to available booking inventory.`);
      }
    });
  });

  if (exportLogBtn) {
    exportLogBtn.addEventListener('click', () => {
      const logs = DB.getSystemLogs();
      let csv = 'Log ID,User ID,Action,Timestamp\n';
      logs.forEach(l => {
        csv += `"${l.log_id}","${l.user_id || 'System'}","${l.action_type}","${l.timestamp}"\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `BPU_Dispatch_Log_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Generating BPU dispatch log CSV export for current duty shift...');
    });
  }
});
