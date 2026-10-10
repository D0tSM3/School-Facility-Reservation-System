/**
 * CampusRoom — Master Calendar smart suggestions (Phase 4).
 *
 * "Don't just show an error." When the slot you picked is taken, no longer
 * free, or the server answers 409, this card (inside the booking summary)
 * offers:
 *   - the next free windows of the same length in the SAME room, and
 *   - a few SIMILAR rooms (same type, enough seats, nearest floor first) that
 *     are free at about the same time.
 * Clicking one hands the new { roomId, date, start, end } to the page, which
 * moves the selection there. Nothing is submitted from here.
 *
 * Data: GET api/calendar/suggest (read-only; the server already checked the
 * first few candidates with ReservationValidator). Every suggestion is still
 * re-validated by the server when the customer submits.
 */
(function () {
  'use strict';

  const S = window.CampusSchedule;
  const esc = v => window.CampusRoomUtil.escapeHtml(v);

  let opts = null, box = null;
  let seq = 0;                 // newest request wins
  let cur = null;              // { key, origin, reason, slot, status: 'loading'|'ok'|'error', data }

  const keyOf = s => [s.roomId, s.date, s.start, s.end].join('|');

  // ---------- small formatters ----------
  const ymdParts = d => /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || '');
  function dayLabel(date) {
    const n = opts && opts.getNow && opts.getNow();
    const p = ymdParts(date);
    if (!p) return String(date || '');
    const d = new Date(+p[1], +p[2] - 1, +p[3]);
    if (n && n.ymd) {
      const t = ymdParts(n.ymd);
      const diff = Math.round((d - new Date(+t[1], +t[2] - 1, +t[3])) / 86400000);
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Tomorrow';
    }
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  const range = (a, b) => S.fmt12(a) + ' – ' + S.fmt12(b);

  // ---------- painting ----------
  function pickBtn(slot, html, label, extraClass) {
    return '<button type="button" class="mc-sug-pick ' + (extraClass || '') + '" data-room="' + esc(slot.roomId) + '" data-date="' + esc(slot.date) +
      '" data-start="' + esc(slot.start) + '" data-end="' + esc(slot.end) + '" aria-label="' + esc(label) + '">' + html + '</button>';
  }

  function paint() {
    if (!box) return;
    if (!cur) { box.innerHTML = ''; box.classList.add('hidden'); return; }
    box.classList.remove('hidden');

    const why = cur.reason ? '<p class="mc-sug-why">' + esc(cur.reason) + '</p>' : '';
    const head = '<div class="mc-sug-head"><span class="material-symbols-outlined" aria-hidden="true">lightbulb</span>Other options</div>';

    if (cur.status === 'loading') {
      box.innerHTML = '<section class="mc-sug" aria-busy="true">' + head + why +
        '<p class="mc-sug-note">Looking for other times and rooms…</p></section>';
      return;
    }
    if (cur.status === 'error') {
      box.innerHTML = '<section class="mc-sug">' + head + why +
        '<p class="mc-sug-note">Couldn’t load suggestions right now. You can still pick another time on the calendar. ' +
        '<button type="button" class="mc-sug-retry underline">Try again</button></p></section>';
      return;
    }

    const d = cur.data;
    const dur = d.duration_min;
    const len = dur % 60 === 0 ? (dur / 60) + ' hr' : dur >= 60 ? Math.floor(dur / 60) + ' hr ' + (dur % 60) + ' min' : dur + ' min';

    const same = d.same_room.length
      ? '<div class="mc-sug-chips">' + d.same_room.map(x => {
          const slot = { roomId: cur.slot.roomId, date: x.date, start: x.start, end: x.end };
          return pickBtn(slot, '<b>' + esc(dayLabel(x.date)) + '</b><span>' + esc(range(x.start, x.end)) + '</span>',
            'Use ' + dayLabel(x.date) + ', ' + range(x.start, x.end) + ' in this room');
        }).join('') + '</div>'
      : '<p class="mc-sug-note">No free ' + esc(len) + ' window in this room over the next 7 open days.</p>';

    const others = d.other_rooms.length
      ? '<div class="mc-sug-rooms">' + d.other_rooms.map(x => {
          const slot = { roomId: x.room_id, date: x.date, start: x.start, end: x.end };
          const meta = [x.capacity + ' seats', x.floor == null ? 'Floor —' : 'Floor ' + x.floor, x.distance].filter(Boolean).join(' · ');
          return pickBtn(slot,
            '<span class="mc-sug-rname">' + esc(x.name) + (x.exact ? '<em class="mc-sug-tag">Same time</em>' : '') + '</span>' +
            '<span class="mc-sug-rmeta">' + esc(meta) + '</span>' +
            '<span class="mc-sug-rslot">' + esc(dayLabel(x.date) + ', ' + range(x.start, x.end)) + '</span>',
            'Switch to ' + x.name + ', ' + dayLabel(x.date) + ' ' + range(x.start, x.end), 'is-room');
        }).join('') + '</div>'
      : '<p class="mc-sug-note">No similar room is free around that time.</p>';

    box.innerHTML = '<section class="mc-sug">' + head + why +
      '<h3 class="mc-sug-h">Next free time in this room</h3>' + same +
      '<h3 class="mc-sug-h">Similar rooms nearby</h3>' + others +
      '</section>';
  }

  // ---------- loading ----------
  async function load() {
    const mine = ++seq;
    const slot = cur.slot;
    const qs = 'room_id=' + encodeURIComponent(slot.roomId) + '&date=' + encodeURIComponent(slot.date) +
      '&start=' + encodeURIComponent(slot.start) + '&end=' + encodeURIComponent(slot.end);
    const seats = opts.getSeats ? String(opts.getSeats() || '').trim() : '';
    let json = null, ok = false;
    try {
      const res = await fetch(opts.base + 'api/calendar/suggest?' + qs + (/^\d+$/.test(seats) ? '&capacity=' + seats : ''), { credentials: 'include' });
      if (res.status === 401) { window.location.href = 'index.html'; return; }
      json = await res.json().catch(() => null);
      ok = res.ok && !!json && json.success !== false && !!json.data && Array.isArray(json.data.same_room) && Array.isArray(json.data.other_rooms);
    } catch (_) { ok = false; }
    if (mine !== seq || !cur) return;               // selection changed meanwhile
    cur.status = ok ? 'ok' : 'error';
    cur.data = ok ? json.data : null;
    paint();
  }

  // ---------- public ----------
  /**
   * Show options for `slot` ({ roomId, date, start, end }).
   * o.origin: 'stale' (the grid says it is taken) | 'conflict' (server 409) | 'drag' (the drag hit a booking)
   * o.reason: one plain-language sentence shown above the options.
   * Asking again for the same slot only refreshes the reason (a server reason beats the grid's own).
   */
  function request(slot, o) {
    if (!opts || !slot) return;
    o = o || {};
    const key = keyOf(slot);
    if (cur && cur.key === key) {
      if (o.reason && (cur.origin === 'stale' || o.origin === 'conflict') && cur.reason !== o.reason) {
        cur.reason = o.reason; cur.origin = o.origin || cur.origin; paint();
      }
      if (cur.status === 'error' && o.retry) { cur.status = 'loading'; paint(); load(); }
      return;
    }
    cur = { key, origin: o.origin || 'stale', reason: o.reason || '', slot: Object.assign({}, slot), status: 'loading', data: null };
    paint();
    load();
  }

  /** Remove the card. clear('stale') only if the card came from a stale-slot check (the problem is gone). */
  function clear(origin) {
    if (!cur || (origin && cur.origin !== origin)) return;
    cur = null; seq++;                                // drops any answer still in flight
    paint();
  }

  function init(o) {
    opts = o;
    box = document.getElementById(o.containerId);
    if (!box) return;
    box.addEventListener('click', e => {
      if (e.target.closest('.mc-sug-retry') && cur) { request(cur.slot, { origin: cur.origin, retry: true }); return; }
      const b = e.target.closest('.mc-sug-pick');
      if (!b || !opts.onPick) return;
      opts.onPick({ roomId: b.dataset.room, date: b.dataset.date, start: b.dataset.start, end: b.dataset.end });
    });
    paint();
  }

  window.MCSuggest = Object.freeze({ init, request, clear, active: () => !!cur });
})();
