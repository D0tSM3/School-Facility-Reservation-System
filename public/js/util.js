/**
 * CampusRoom — shared front-end helpers.
 *
 * Plain script, no modules (matches the rest of public/js). Load it with
 * <script src="js/util.js"></script> BEFORE any page script that uses it.
 *
 *   const { escapeHtml } = window.CampusRoomUtil;
 *
 * escapeHtml() used to be copy-pasted into reservations.js and staff-queue.js;
 * this is the single definition now (Section 12).
 */
(function () {
  'use strict';

  const HTML_ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  };

  /** Escape a value for safe use in HTML text AND in quoted attribute values. */
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (character) => HTML_ESCAPES[character]);
  }

  window.CampusRoomUtil = Object.freeze({ escapeHtml });
})();
window.openBookingModal = async function(roomId, rebookId = null) {
  window.bookingModalTargetRoomId = roomId;
  window.bookingModalRebookId = rebookId;
  
  const modal = document.getElementById('bookingModalOverlay');
  if (!modal) return;
  
  if (!modal.dataset.closeInitialized) {
    if (typeof window.initBookingForm === 'function') {
      window.initBookingForm();
    }
    const closeBtn = document.getElementById('closeBookingModalBtn');
    const cancelBtn = document.getElementById('cancelModalBtn');

    function closeModal() {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }

    if (closeBtn) closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) {
      // Just in case it had previous navigateBack listeners from booking.js, clone it to reset
      const newCancel = cancelBtn.cloneNode(true);
      if (cancelBtn.parentNode) {
        cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
        newCancel.addEventListener('click', closeModal);
      } else {
        cancelBtn.addEventListener('click', closeModal);
      }
    }
    modal.dataset.closeInitialized = 'true';
  }
  
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  
  const roomSelect = document.getElementById('roomSelect');
  if (roomSelect && roomId) {
    roomSelect.value = roomId;
    roomSelect.dispatchEvent(new Event('change'));
  }
};

