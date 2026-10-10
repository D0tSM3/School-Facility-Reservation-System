/* Safe-text popover listing every booking in a crowded cluster ("+N more").
 * open(anchor, items, opts)  items: [{ title, time, detail, cls }]   opts: { title }
 * Closes on x, Esc, or a click outside; focus returns to the chip that opened it. */
(function (root) {
  'use strict';
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let onDoc = null, onKey = null, opener = null;

  function close() {
    document.querySelectorAll('.mc-more-popover').forEach(x => x.remove());
    if (onDoc) { document.removeEventListener('pointerdown', onDoc, true); onDoc = null; }
    if (onKey) { document.removeEventListener('keydown', onKey, true); onKey = null; }
    if (opener && document.contains(opener)) { try { opener.focus({ preventScroll: true }); } catch (_) { /* ignore */ } }
    opener = null;
  }

  function open(anchor, items, opts) {
    close();
    opener = anchor;
    const heading = (opts && opts.title) || 'Bookings at this time';
    const pop = document.createElement('div');
    pop.className = 'mc-more-popover';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', heading);
    pop.innerHTML =
      '<button type="button" class="mc-more-close" aria-label="Close">×</button>' +
      '<strong>' + esc(heading) + '</strong>' +
      '<span class="mc-more-count">' + items.length + ' booking' + (items.length === 1 ? '' : 's') + '</span>' +
      '<ul>' + items.map(x =>
        '<li class="' + esc(x.cls || '') + '">' +
        (x.time ? '<em>' + esc(x.time) + '</em>' : '') +
        '<b>' + esc(x.title || 'Reserved') + '</b>' +
        (x.detail ? '<span>' + esc(x.detail) + '</span>' : '') + '</li>').join('') + '</ul>';
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 12)) + 'px';
    pop.style.top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 12)) + 'px';
    pop.querySelector('.mc-more-close').addEventListener('click', close);
    onDoc = e => { if (!pop.contains(e.target) && !anchor.contains(e.target)) close(); };
    onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
    pop.querySelector('.mc-more-close').focus({ preventScroll: true });
    return pop;
  }
  root.MCPopover = Object.freeze({ open, close });
})(window);
