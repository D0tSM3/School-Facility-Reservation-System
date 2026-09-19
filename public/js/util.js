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
