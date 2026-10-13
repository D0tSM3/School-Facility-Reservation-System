/**
 * CampusRoom — Client-side inactivity logout.
 * Two-minute timeout is intended for testing; adjust before production use.
 */
(function () {
  'use strict';

  var TIMEOUT_MS = 2 * 60 * 1000;
  var BASE = window.location.pathname.replace(/[^\/]*$/, '');
  var timer;
  var loggingOut = false;

  function clearRoleHint() {
    try {
      sessionStorage.removeItem('campus_role');
    } catch (err) {
      console.warn('Unable to clear the session role hint', err);
    }

    try {
      localStorage.removeItem('campus_role');
    } catch (err) {
      console.warn('Unable to clear the persistent role hint', err);
    }
  }

  function expireSession() {
    if (loggingOut) return;
    loggingOut = true;
    clearTimeout(timer);
    clearRoleHint();

    fetch(BASE + 'api/auth/logout', {
      method: 'POST',
      credentials: 'include'
    })
      .catch(function (err) {
        console.error('Failed to end the inactive session', err);
      })
      .finally(function () {
        window.location.href = 'index.html';
      });
  }

  function resetTimer() {
    if (loggingOut) return;
    clearTimeout(timer);
    timer = setTimeout(expireSession, TIMEOUT_MS);
  }

  ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart', 'input'].forEach(function (eventName) {
    document.addEventListener(eventName, resetTimer, { passive: true });
  });

  resetTimer();
})();
