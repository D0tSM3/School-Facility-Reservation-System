/**
 * CampusRoom — Staff Dispatch & Room Maintenance Queue
 * Handles booking approvals, rejections, batch sign-offs, and room maintenance toggles.
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const BASE = window.location.pathname.replace(/[^\/]*$/, '');

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

  function apiUpdateReservation(id, status, callback) {
    fetch(BASE + 'api/reservations/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    })
    .then(res => res.json())
    .then(json => {
      if (json.success) callback(true);
      else callback(false, json.error);
    })
    .catch(err => callback(false, err));
  }

  function apiUpdateRoom(id, status, callback) {
    fetch(BASE + 'api/rooms/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    })
    .then(res => res.json())
    .then(json => {
      if (json.success) callback(true);
      else callback(false, json.error);
    })
    .catch(err => callback(false, err));
  }

  const approveButtons = document.querySelectorAll('.btn-approve-req');
  approveButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id') || 'BPU-XXXX';
      const name = btn.getAttribute('data-name') || 'Requester';
      const card = document.getElementById('card-' + id);

      if (card) {
        card.style.opacity = '0.3';
        apiUpdateReservation(id, 'Approved', (success) => {
          if (success) {
            card.remove();
            updateCounters(-1, 1);
            showToast(`Application ${id} (${name}) Approved. Electronic permit and keycard permissions dispatched.`);
          } else {
            card.style.opacity = '1';
            showToast(`Failed to approve ${id}`);
          }
        });
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
        apiUpdateReservation(id, 'Rejected', (success) => {
          if (success) {
            card.remove();
            updateCounters(-1, 0);
            showToast(`Application ${id} (${name}) Rejected. Institutional notice sent to requester.`);
          } else {
            card.style.opacity = '1';
            showToast(`Failed to reject ${id}`);
          }
        });
      }
    });
  });

  if (batchApproveBtn) {
    batchApproveBtn.addEventListener('click', () => {
      const card1 = document.getElementById('card-BPU-9102');
      const card2 = document.getElementById('card-BPU-9105');
      let removed = 0;

      const finishBatch = () => {
        if (removed > 0) {
          updateCounters(-removed, removed);
          batchApproveBtn.textContent = 'Batch Completed';
          batchApproveBtn.classList.add('opacity-50', 'pointer-events-none');
          showToast(`Batch approved verified faculty reservations (#BPU-9102, #BPU-9105). Digital door schedules updated.`);
        } else {
          showToast('No pending verified reservations available for batch approval.');
        }
      };

      if (card1) {
        apiUpdateReservation('BPU-9102', 'Approved', (ok) => {
           if(ok) { card1.remove(); removed++; }
           if(card2) {
              apiUpdateReservation('BPU-9105', 'Approved', (ok2) => {
                if(ok2) { card2.remove(); removed++; }
                finishBatch();
              });
           } else {
              finishBatch();
           }
        });
      } else if (card2) {
        apiUpdateReservation('BPU-9105', 'Approved', (ok) => {
           if(ok) { card2.remove(); removed++; }
           finishBatch();
        });
      } else {
        finishBatch();
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

        apiUpdateRoom('rm-mq-310', 'Available', () => {});
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
        if (roomId) apiUpdateRoom(roomId, 'Maintenance', () => {});
        showToast(`${roomName} flagged for maintenance inspection.`);
      } else {
        btn.textContent = 'Set Maintenance';
        btn.classList.replace('bg-secondary-fixed', 'bg-surface-container-highest');
        if (roomId) apiUpdateRoom(roomId, 'Available', () => {});
        showToast(`${roomName} restored to available booking inventory.`);
      }
    });
  });

  if (exportLogBtn) {
    exportLogBtn.addEventListener('click', () => {
      fetch(BASE + 'api/logs')
        .then(res => res.json())
        .then(json => {
           if(!json.success) { showToast('Error fetching logs'); return; }
           const logs = json.data;
           let csv = 'Log ID,User ID,Action,Timestamp\n';
           logs.forEach(l => {
             csv += `"${l.log_id}","${l.user_id || 'System'}","${l.action}"\n`;
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
        })
        .catch(() => showToast('Network error fetching logs'));
    });
  }

  // --- Move Requests Logic ---
  const tabMoves = document.getElementById('tab-moves');
  const viewMoves = document.getElementById('view-moves');
  const moveBadgeCount = document.getElementById('move-badge-count');
  
  let currentMoveRequestId = null;
  const moveReviewModalOverlay = document.getElementById('moveReviewModalOverlay');
  const moveReviewComment = document.getElementById('moveReviewComment');
  const moveReviewErrorMsg = document.getElementById('moveReviewErrorMsg');

  function openMoveModal(reqId) {
    currentMoveRequestId = reqId;
    if (moveReviewComment) moveReviewComment.value = '';
    if (moveReviewErrorMsg) moveReviewErrorMsg.classList.add('hidden');
    if (moveReviewModalOverlay) moveReviewModalOverlay.classList.remove('opacity-0', 'pointer-events-none');
  }

  function closeMoveModal() {
    currentMoveRequestId = null;
    if (moveReviewModalOverlay) moveReviewModalOverlay.classList.add('opacity-0', 'pointer-events-none');
  }

  const moveReviewCloseIcon = document.getElementById('moveReviewCloseIcon');
  if (moveReviewCloseIcon) moveReviewCloseIcon.addEventListener('click', closeMoveModal);
  const moveReviewCancelBtn = document.getElementById('moveReviewCancelBtn');
  if (moveReviewCancelBtn) moveReviewCancelBtn.addEventListener('click', closeMoveModal);

  function submitMoveReview(status) {
    if (!currentMoveRequestId) return;
    const comment = (moveReviewComment ? moveReviewComment.value : '').trim();
    if (status === 'Rejected' && !comment) {
      if (moveReviewErrorMsg) {
        moveReviewErrorMsg.textContent = 'A comment is required for rejection.';
        moveReviewErrorMsg.classList.remove('hidden');
      }
      return;
    }

    fetch(`${BASE}api/reservations/move-requests/${currentMoveRequestId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, comment })
    })
    .then(res => res.json())
    .then(json => {
      if (json.success) {
        closeMoveModal();
        showToast(`Move Request ${status}`);
        loadMoveRequests();
      } else {
        if (moveReviewErrorMsg) {
          moveReviewErrorMsg.textContent = json.error || `Failed to ${status} move request.`;
          moveReviewErrorMsg.classList.remove('hidden');
        }
      }
    })
    .catch(err => {
      console.error(err);
      if (moveReviewErrorMsg) {
        moveReviewErrorMsg.textContent = 'Network error.';
        moveReviewErrorMsg.classList.remove('hidden');
      }
    });
  }

  const moveReviewRejectBtn = document.getElementById('moveReviewRejectBtn');
  if (moveReviewRejectBtn) moveReviewRejectBtn.addEventListener('click', () => submitMoveReview('Rejected'));
  const moveReviewApproveBtn = document.getElementById('moveReviewApproveBtn');
  if (moveReviewApproveBtn) moveReviewApproveBtn.addEventListener('click', () => submitMoveReview('Approved'));

  function formatDateTime(val) {
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return '---';
    return d.toLocaleDateString('en-US', {month:'short', day:'2-digit'}) + ' ' + 
           d.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit'});
  }

  function renderMoveRequests(requests) {
    if (!viewMoves) return;
    viewMoves.innerHTML = '';
    if (requests.length === 0) {
      viewMoves.innerHTML = '<p class="text-on-surface-variant p-space-md text-center bg-surface-container-lowest rounded-lg shadow-sm">No pending move requests.</p>';
      return;
    }

    viewMoves.innerHTML = requests.map(req => `
      <div class="relative bg-surface-container-lowest rounded-lg shadow-sm overflow-hidden transition-all hover:shadow-md">
        <div class="absolute left-0 top-0 bottom-0 w-1.5 bg-amber-500"></div>
        <div class="p-space-md pl-space-lg flex flex-col xl:flex-row xl:items-center justify-between gap-space-md">
          <div class="space-y-2 flex-1">
            <div class="flex items-center gap-space-xs">
              <span class="px-space-xs py-1 rounded bg-secondary-fixed text-on-secondary-fixed font-label-sm">REQ-${req.reservation_id.substring(0,8)}</span>
              <span class="px-space-xs py-1 rounded bg-amber-100 text-amber-800 font-label-sm">MOVE REQUEST</span>
            </div>
            <div class="text-on-surface text-body-md font-body-md">
              <span class="font-semibold text-primary">Original Time:</span> ${formatDateTime(req.old_start_time)} - ${formatDateTime(req.old_end_time)}
            </div>
            <div class="text-on-surface text-body-md font-body-md">
              <span class="font-semibold text-secondary">Requested Time:</span> ${formatDateTime(req.requested_start_time)} - ${formatDateTime(req.requested_end_time)}
            </div>
          </div>
          <div class="flex items-center gap-space-xs justify-end flex-shrink-0 pt-space-xs xl:pt-0">
            <button class="btn-review-move flex items-center gap-space-xs px-space-md py-2 rounded-lg bg-surface-container-high text-on-surface hover:bg-surface-container-highest shadow-sm font-label-lg transition-all" data-id="${req.request_id}">
              <span class="material-symbols-outlined text-[18px]">rate_review</span>
              <span>Review Request</span>
            </button>
          </div>
        </div>
      </div>
    `).join('');

    document.querySelectorAll('.btn-review-move').forEach(btn => {
      btn.addEventListener('click', () => {
        openMoveModal(btn.getAttribute('data-id'));
      });
    });
  }

  function loadMoveRequests() {
    fetch(`${BASE}api/reservations/move-requests`)
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          const reqs = json.data;
          if (moveBadgeCount) moveBadgeCount.textContent = `${reqs.length} Requests`;
          renderMoveRequests(reqs);
        }
      })
      .catch(console.error);
  }

  if (tabMoves) {
    tabMoves.addEventListener('click', () => {
      switchQueueTab('moves');
    });
  }
  
  // Need to modify switchQueueTab
  const originalSwitch = switchQueueTab;
  switchQueueTab = function(tab) {
    const allTabs = [tabPending, tabMaintenance, tabMoves];
    const allViews = [viewPending, viewMaintenance, viewMoves];
    
    allTabs.forEach(t => {
      if (t) {
        t.classList.remove('bg-surface-container-lowest', 'text-primary', 'shadow-sm');
        t.classList.add('text-on-surface-variant');
      }
    });
    
    allViews.forEach(v => {
      if (v) v.classList.add('hidden');
    });

    let activeTab = null, activeView = null;
    if (tab === 'pending') { activeTab = tabPending; activeView = viewPending; }
    else if (tab === 'maintenance') { activeTab = tabMaintenance; activeView = viewMaintenance; }
    else if (tab === 'moves') { activeTab = tabMoves; activeView = viewMoves; }

    if (activeTab) {
      activeTab.classList.add('bg-surface-container-lowest', 'text-primary', 'shadow-sm');
      activeTab.classList.remove('text-on-surface-variant');
    }
    if (activeView) activeView.classList.remove('hidden');
  };

  loadMoveRequests();

});
