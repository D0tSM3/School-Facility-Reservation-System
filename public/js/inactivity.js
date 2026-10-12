/**
 * CampusRoom — Client-side inactivity logout.
 */
(function () {
  'use strict';

  var INACTIVITY_MINUTES = 15;
  var WARNING_BEFORE_LOGOUT_SECONDS = 60;
  var TIMEOUT_MS = INACTIVITY_MINUTES * 60 * 1000;
  var WARNING_MS = Math.max(0, TIMEOUT_MS - WARNING_BEFORE_LOGOUT_SECONDS * 1000);
  var BASE = window.location.pathname.replace(/[^\/]*$/, '');
  var timer;
  var warningTimer;
  var warning;
  var loggingOut = false;

  function hideWarning() {
    if (warning) warning.hidden = true;
  }

  function showWarning() {
    if (loggingOut) return;
    if (!warning) {
      warning = document.createElement('div');
      warning.setAttribute('role', 'status');
      warning.setAttribute('aria-live', 'polite');
      warning.textContent = 'You will be signed out in 1 minute due to inactivity. Move or interact to stay signed in.';
      warning.style.position = 'fixed';
      warning.style.top = '1rem';
      warning.style.left = '50%';
      warning.style.transform = 'translateX(-50%)';
      warning.style.zIndex = '10000';
      warning.style.maxWidth = 'calc(100% - 2rem)';
      warning.style.padding = '0.75rem 1rem';
      warning.style.border = '1px solid #d39e00';
      warning.style.borderRadius = '0.25rem';
      warning.style.backgroundColor = '#fff3cd';
      warning.style.color = '#664d03';
      warning.style.fontFamily = 'sans-serif';
      warning.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.2)';
      document.body.appendChild(warning);
    }
    warning.hidden = false;
  }

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
    clearTimeout(warningTimer);
    hideWarning();
    warningTimer = setTimeout(showWarning, WARNING_MS);
    timer = setTimeout(expireSession, TIMEOUT_MS);
  }

  ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart', 'input'].forEach(function (eventName) {
    document.addEventListener(eventName, resetTimer, { passive: true });
  });

  resetTimer();
})();
