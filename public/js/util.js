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

  /**
   * Parse a MySQL/Postgres DATETIME string ("2024-10-26 10:00:00") as local
   * time. Lifted from staff-queue.js (Section 8): strict-spec browsers
   * (Safari and others) refuse to parse the space-separated form that
   * `new Date(value)` accepted on Chrome/Firefox, silently returning an
   * Invalid Date and dropping reservations from Upcoming/Past tiles.
   * Swapping the space for "T" makes it valid ISO 8601 everywhere.
   */
  function parseDate(value) {
    if (!value) return null;
    const date = new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  window.CampusRoomUtil = Object.freeze({ escapeHtml, parseDate });
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
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('rebook')) {
        // Clear rebook state by navigating. If they came from my-reservations, go back there.
        // Otherwise, strip the query string so the next 'Reserve' click uses a clean state.
        if (document.referrer && document.referrer.includes('my-reservations.html')) {
          window.location.href = 'my-reservations.html';
        } else {
          window.location.href = window.location.pathname;
        }
        return;
      }
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }

    // Clone buttons to strip out `navigateBack` listeners previously attached by booking.js
    let currentClose = document.getElementById('closeBookingModalBtn');
    if (currentClose) {
      const newClose = currentClose.cloneNode(true);
      if (currentClose.parentNode) currentClose.parentNode.replaceChild(newClose, currentClose);
      newClose.addEventListener('click', closeModal);
    }

    let currentCancel = document.getElementById('cancelModalBtn');
    if (currentCancel) {
      const newCancel = currentCancel.cloneNode(true);
      if (currentCancel.parentNode) currentCancel.parentNode.replaceChild(newCancel, currentCancel);
      newCancel.addEventListener('click', closeModal);
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

