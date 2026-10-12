(function () {
  'use strict';

  var INACTIVITY_TIMEOUT_MS = 3 * 60 * 1000;
  var timer;

  function resetTimer() {
    window.clearTimeout(timer);
    timer = window.setTimeout(function () {
      window.location.replace('landing.html');
    }, INACTIVITY_TIMEOUT_MS);
  }

  ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart', 'input'].forEach(function (eventName) {
    document.addEventListener(eventName, resetTimer, { passive: true });
  });

  resetTimer();
})();
