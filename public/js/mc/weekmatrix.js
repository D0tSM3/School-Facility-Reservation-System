/**
 * CampusRoom — Master Calendar week matrix (Week view, all rooms).
 *
 * Rooms down the side, the seven days across. Every cell holds one small bar that spans the
 * business day, with a segment wherever that room is busy, so a whole week of a whole floor
 * reads at a glance. Nothing is selected here: clicking a cell (or a day heading) opens that
 * day, where the exact times can be picked.
 *
 * model = {
 *   open, close: 'HH:MM',
 *   days:   [{ date, title:'Mon', sub:'Oct 12', today, weekend }],            // 7 entries
 *   groups: [{ key, label|null, open, rooms: [room…], summary: [{ free, total }…] }],
 *   onOpenDay(date, roomId|''), onToggleGroup(key)
 * }
 * room = { roomId, name, sub, badge, cells: [{ date, blocks, overlay, pastUntil, nowMin, text, tip }…] }
 *   blocks are the same objects the Gantt uses: { startMin, endMin, cls, … }.
 *
 * Segment kinds come from the block's cls so a later colour scheme only has to restyle
 * .mc-wk-seg.is-class / .is-taken / .is-pending / .is-mine in CSS.
 */
(function () {
  'use strict';

  const esc = v => window.CampusRoomUtil.escapeHtml(v);
  const toMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const bound = new WeakSet();
  let handlers = null;

  const kindOf = cls => /is-mine/.test(cls) ? 'is-mine' : /is-class/.test(cls) ? 'is-class' : /is-pending/.test(cls) ? 'is-pending' : 'is-taken';

  function barHtml(cell, openMin, closeMin) {
    const span = Math.max(1, closeMin - openMin);
    const pct = m => Math.max(0, Math.min(100, (m - openMin) / span * 100));
    if (cell.overlay) return '<span class="mc-wk-bar is-off" aria-hidden="true"></span>';
    let h = '<span class="mc-wk-bar" style="--hrs:' + (span / 60) + '" aria-hidden="true">';
    (cell.blocks || []).forEach(b => {
      const s = Math.max(b.startMin, openMin), e = Math.min(b.endMin, closeMin);
      if (e <= s) return;
      h += '<i class="mc-wk-seg ' + kindOf(b.cls) + (b.rt ? ' ' + esc(b.rt) : '') + '" style="left:' + pct(s) + '%;width:' + (pct(e) - pct(s)) + '%"></i>';
    });
    if (cell.pastUntil === 'all') h += '<i class="mc-wk-past" style="left:0;width:100%"></i>';
    else if (typeof cell.pastUntil === 'number' && cell.pastUntil > openMin) h += '<i class="mc-wk-past" style="left:0;width:' + pct(cell.pastUntil) + '%"></i>';
    if (typeof cell.nowMin === 'number' && cell.nowMin >= openMin && cell.nowMin <= closeMin) h += '<i class="mc-wk-now" style="left:' + pct(cell.nowMin) + '%"></i>';
    return h + '</span>';
  }

  function cellHtml(room, cell, day, r, c, openMin, closeMin) {
    const past = cell.pastUntil === 'all';
    const full = !cell.overlay && !past && cell.full;
    const cls = 'mc-wk-cell' + (day.today ? ' is-today' : '') + (day.weekend ? ' is-weekend' : '') + (past ? ' is-past' : '') +
      (cell.overlay ? ' is-off' : '') + (full ? ' is-full' : '');
    return '<button type="button" class="' + cls + '" tabindex="-1" data-r="' + r + '" data-c="' + c + '" data-date="' + esc(cell.date) + '"' +
      ' data-room="' + esc(room.roomId) + '" data-tip="' + esc(cell.tip) + '" aria-label="' + esc(cell.tip + '. Open this day.') + '">' +
      barHtml(cell, openMin, closeMin) + '<span class="mc-wk-txt">' + esc(cell.text) + '</span></button>';
  }

  function summaryHtml(s, day, rowKey) {
    const total = s ? s.total : 0, free = s ? s.free : 0;
    const ratio = total ? free / total : 0;
    const heat = !total ? 'x' : free === 0 ? '0' : ratio <= 0.25 ? '1' : ratio <= 0.5 ? '2' : ratio <= 0.75 ? '3' : '4';
    const txt = !total ? '—' : free + ' of ' + total + ' free';
    return '<button type="button" class="mc-wk-sum heat-' + heat + (day.today ? ' is-today' : '') + (day.weekend ? ' is-weekend' : '') + '" tabindex="-1" data-date="' + esc(day.date) + '" data-room="" ' +
      'data-tip="' + esc(rowKey + ' · ' + day.title + ' ' + day.sub + ' · ' + (total ? free + ' of ' + total + ' rooms have free time' : 'not bookable')) + '">' + esc(txt) + '</button>';
  }

  function render(container, model) {
    const openMin = toMin(model.open), closeMin = toMin(model.close);
    const fmt12 = t => window.CampusSchedule.fmt12(t);
    handlers = model;

    // keep keyboard focus on the same cell across a redraw
    const act = document.activeElement;
    const keep = act && container.contains(act) && act.classList && act.classList.contains('mc-wk-cell') ? { room: act.dataset.room, date: act.dataset.date } : null;

    let h = '<div class="mc-wk" role="table" aria-label="Week at a glance: rooms by day">';
    h += '<div class="mc-wk-corner" role="columnheader"><b>Room</b><span>Bar = ' + esc(fmt12(model.open)) + ' – ' + esc(fmt12(model.close)) + '</span></div>';
    h += model.days.map(d =>
      '<button type="button" class="mc-wk-dayhead' + (d.today ? ' is-today' : '') + (d.weekend ? ' is-weekend' : '') + '" role="columnheader" data-date="' + esc(d.date) + '" data-room="" ' +
      'aria-label="' + esc(d.title + ' ' + d.sub + '. Open this day.') + '"><b>' + esc(d.title) + '</b><span>' + esc(d.sub) + '</span></button>').join('');

    let r = 0;
    model.groups.forEach(g => {
      if (g.label != null) {
        h += '<div class="mc-wk-row" role="row"><div class="mc-wk-label mc-wk-grouplabel ' + (window.MCRoomColor ? window.MCRoomColor.cls(g.key) : '') + (g.open ? ' is-open' : '') + '" role="button" tabindex="0" data-group="' + esc(g.key) + '" aria-expanded="' + (g.open ? 'true' : 'false') + '">' +
          '<span class="material-symbols-outlined" aria-hidden="true">' + (g.open ? 'folder_open' : 'folder') + '</span><b>' + esc(g.label) + '</b><em>' + g.rooms.length + ' room' + (g.rooms.length === 1 ? '' : 's') + '</em></div>' +
          model.days.map((d, i) => summaryHtml(g.summary && g.summary[i], d, g.label)).join('') + '</div>';
      }
      if (g.label == null || g.open) {
        g.rooms.forEach(room => {
          h += '<div class="mc-wk-row" role="row"><div class="mc-wk-label' + (g.label != null ? ' is-nested' : '') + (room.rt ? ' has-rt ' + esc(room.rt) : '') + '" role="rowheader"><b>' + esc(room.name) + '</b>' +
            (room.badge ? '<span class="mc-badge">' + esc(room.badge) + '</span>' : '') + '<span>' + esc(room.sub) + '</span></div>' +
            room.cells.map((cell, c) => cellHtml(room, cell, model.days[c], r, c, openMin, closeMin)).join('') + '</div>';
          r++;
        });
      }
    });
    h += '</div>';
    container.innerHTML = h;
    bind(container);

    // roving tabindex: one tab stop for the whole matrix, arrow keys move inside it
    const cells = [...container.querySelectorAll('.mc-wk-cell')];
    const first = (keep && cells.find(x => x.dataset.room === keep.room && x.dataset.date === keep.date)) || cells.find(x => x.classList.contains('is-today')) || cells[0];
    if (first) first.tabIndex = 0;
    if (keep && first && first.dataset.room === keep.room && first.dataset.date === keep.date) first.focus({ preventScroll: true });
  }

  function onClick(e) {
    if (!handlers) return;
    const grp = e.target.closest('.mc-wk-grouplabel');
    if (grp) { handlers.onToggleGroup && handlers.onToggleGroup(grp.dataset.group); return; }
    const t = e.target.closest('.mc-wk-cell, .mc-wk-sum, .mc-wk-dayhead');
    if (t && t.dataset.date) handlers.onOpenDay && handlers.onOpenDay(t.dataset.date, t.dataset.room || '');
  }

  function onKeyDown(e) {
    if (!handlers) return;
    const grp = e.target.closest && e.target.closest('.mc-wk-grouplabel');
    if (grp && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); handlers.onToggleGroup && handlers.onToggleGroup(grp.dataset.group); return; }
    const cell = e.target.closest && e.target.closest('.mc-wk-cell');
    if (!cell) return;
    const r = +cell.dataset.r, c = +cell.dataset.c;
    let nr = r, nc = c;
    if (e.key === 'ArrowRight') nc++; else if (e.key === 'ArrowLeft') nc--;
    else if (e.key === 'ArrowDown') nr++; else if (e.key === 'ArrowUp') nr--;
    else if (e.key === 'Home') nc = 0; else if (e.key === 'End') nc = 6;
    else return;
    e.preventDefault();
    const box = cell.closest('.mc-wk');
    const next = box && box.querySelector('.mc-wk-cell[data-r="' + nr + '"][data-c="' + nc + '"]');
    if (!next) return;
    cell.tabIndex = -1; next.tabIndex = 0; next.focus();
    next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function bind(container) {
    if (bound.has(container)) return;
    bound.add(container);
    container.addEventListener('click', onClick);
    container.addEventListener('keydown', onKeyDown);
  }

  function reset() { handlers = null; }

  window.MCWeek = Object.freeze({ render, reset });
})();
