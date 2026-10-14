/**
 * CampusRoom — Master Calendar Gantt renderer (Day view, Time on X, Rooms on Y).
 *
 * model = {
 *   open, close: 'HH:MM',
 *   units: [[startMin, endMin], …],               // 30-minute booking units
 *   groups: [{ key, label|null, open, rows: [column…] }],   // label null ⇒ headerless (flat list)
 *   selection: null | { key, startMin, endMin },
 *   readonly, staffReadonly,
 *   onPreview(sel|null), onCommit(sel|null), onNotice(text, wanted), onToggleGroup(key)
 * }
 * A row is the same "column" object the vertical grid uses (key, meta, head, blocks,
 * overlay, pastUntil, nowMin), so both views share one data builder.
 * sel = { key, meta, startMin, endMin } — whole units, one row.
 *
 * Used for Day view (rows = rooms) and for Week view with one room selected (rows = the seven
 * days; model.cornerLabel names the room). A row's head may carry { today, weekend } to tint it.
 * Short bookings (30 min is only ~54px) switch to a compact label + compact time instead of clipping.
 *
 * Layout: the container is the single scroller. The time header is sticky to the top,
 * the room-name column sticky to the left, so 50 rooms scroll down and the day scrolls
 * across without losing either label.
 */
(function () {
  'use strict';

  const esc = v => window.CampusRoomUtil.escapeHtml(v);
  const toMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const fmt12 = t => window.CampusSchedule.fmt12(t);
  const range12 = (s, e) => fmt12(hm(s)) + ' – ' + fmt12(hm(e));
  /** '8:00–8:30' (no AM/PM): fits a 30-minute block; the tooltip carries the full wording. */
  const short = m => { const h = Math.floor(m / 60) % 12 || 12; return h + ':' + String(m % 60).padStart(2, '0'); };
  const rangeShort = (s, e) => short(s) + '–' + short(e);
  const NARROW_PX = 120, TINY_PX = 64;      // below these widths a block/selection uses its compact look

  const ROW_H = 54, GROUP_H = 40, HEAD_H = 38, LANE_CAP = 2;
  let LABEL_W = 200;             // room-name column; narrower on phones so the timeline keeps most of the width
  const PX_PER_MIN = 1.8;        // 30 minutes = 54px (same density as the vertical grid)
  let PPM = PX_PER_MIN;          // px per minute (fixed)
  let ctx = null, drag = null, sel = null;
  const bound = new WeakSet();

  function isBlocked(c, u) {
    if (c.overlay || c.pastUntil === 'all') return true;
    if (typeof c.pastUntil === 'number' && u[0] <= c.pastUntil) return true;
    return c.blocks.some(b => b.startMin < u[1] && b.endMin > u[0]);
  }

  /** Every block chained to `anchor` by overlap (what the "+N more" popover lists). */
  function clusterOf(blocks, anchor) {
    const cl = [anchor];
    let grew = true;
    while (grew) {
      grew = false;
      const lo = Math.min(...cl.map(x => x.startMin)), hi = Math.max(...cl.map(x => x.endMin));
      blocks.forEach(b => { if (!cl.includes(b) && b.startMin < hi && b.endMin > lo) { cl.push(b); grew = true; } });
    }
    return cl.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  }

  // ---------- markup ----------
  function blockHtml(b, lane, openMin, closeMin) {
    const s = Math.max(b.startMin, openMin), e = Math.min(b.endMin, closeMin);
    if (e <= s) return '';
    const n = Math.max(1, lane.laneCount), h = (ROW_H - 6) / n;
    const left = (s - openMin) * PPM, width = Math.max((e - s) * PPM - 1, 6);
    const narrow = width < NARROW_PX, tiny = width < TINY_PX;
    const subTxt = narrow ? rangeShort(s, e) : (b.sub || range12(b.startMin, b.endMin));
    return '<div class="mc-block mc-g-block ' + esc(b.cls) + (b.rt ? ' ' + esc(b.rt) : '') + (n > 1 ? ' is-compact' : '') + (narrow ? ' is-narrow' : '') + (tiny ? ' is-tiny' : '') + '" tabindex="0"' +
      ' style="left:' + left + 'px;width:' + width + 'px;top:' + (3 + lane.lane * h) + 'px;height:' + (h - 2) + 'px;right:auto"' +
      ' data-tip="' + esc(b.tip) + '" aria-label="' + esc(b.tip) + '">' +
      '<span class="mc-block-t">' + esc(b.label) + '</span>' +
      '<span class="mc-block-s">' + esc(subTxt) + '</span></div>';
  }

  function moreChips(c, ri, lanes, openMin) {
    const sorted = c.blocks.map((b, i) => ({ b, i })).sort((a, b) => a.b.startMin - b.b.startMin || a.b.endMin - b.b.endMin);
    const out = [];
    let cluster = [], end = -Infinity;
    function flush() {
      const hidden = cluster.filter(x => lanes[x.i] && lanes[x.i].hidden);
      if (hidden.length) {
        const first = hidden.reduce((a, x) => x.b.startMin < a.b.startMin ? x : a, hidden[0]);
        const n = hidden.length;
        out.push('<button type="button" class="mc-more-chip mc-g-more" data-ri="' + ri + '" data-bi="' + first.i + '" style="left:' +
          Math.max(0, (first.b.startMin - openMin) * PPM) + 'px;bottom:3px" aria-haspopup="dialog" aria-label="Show ' + n +
          ' more booking' + (n === 1 ? '' : 's') + '">+' + n + ' more</button>');
      }
      cluster = []; end = -Infinity;
    }
    sorted.forEach(x => { if (cluster.length && x.b.startMin >= end) flush(); cluster.push(x); end = Math.max(end, x.b.endMin); });
    flush();
    return out.join('');
  }

  function laneHtml(c, ri, m, W) {
    const { openMin, closeMin, units, blocked } = m;
    let h = '';
    if (c.overlay) {
      h += '<div class="mc-ov mc-g-ov is-' + esc(c.overlay.kind) + '"><span>' + esc(c.overlay.label) + '</span></div>';
    } else {
      const lanes = window.MCLanes.layout(c.blocks, LANE_CAP);
      units.forEach((u, i) => {
        if (m.model.readonly || blocked[ri][i]) return;
        h += '<div class="mc-gslot" role="button" tabindex="-1" data-ri="' + ri + '" data-u="' + i + '"' +
          ' style="left:' + ((u[0] - openMin) * PPM) + 'px;width:' + ((u[1] - u[0]) * PPM) + 'px"' +
          ' aria-label="' + esc('Select ' + c.label + ', ' + range12(u[0], u[1])) + '"></div>';
      });
      h += c.blocks.map((b, i) => lanes[i] && lanes[i].hidden ? '' : blockHtml(b, lanes[i] || { lane: 0, laneCount: 1 }, openMin, closeMin)).join('');
      h += moreChips(c, ri, lanes, openMin);
    }
    if (c.pastUntil === 'all') h += '<div class="mc-ov mc-g-past is-past" style="left:0;width:' + W + 'px"></div>';
    else if (typeof c.pastUntil === 'number' && c.pastUntil > openMin) {
      h += '<div class="mc-ov mc-g-past is-past" style="left:0;width:' + ((Math.min(c.pastUntil, closeMin) - openMin) * PPM) + 'px"></div>';
    }
    if (typeof c.nowMin === 'number' && c.nowMin >= openMin && c.nowMin <= closeMin) {
      h += '<div class="mc-g-now" style="left:' + ((c.nowMin - openMin) * PPM) + 'px"></div>';
    }
    return h;
  }

  /** Folder row: label + a strip showing, per half hour, how many of its rooms are still free. */
  function heatHtml(g, rowIdx, m) {
    const { units, openMin } = m;
    if (!g.rows.length) return '';
    if (g.rows.every(r => r.overlay)) return '<div class="mc-g-heatnote">' + esc(g.rows[0].overlay.label) + '</div>';
    return units.map((u, i) => {
      let free = 0;
      g.rows.forEach(r => { if (!m.blocked[rowIdx.get(r)][i]) free++; });
      const ratio = free / g.rows.length;
      const heat = free === 0 ? 0 : ratio <= 0.25 ? 1 : ratio <= 0.5 ? 2 : ratio <= 0.75 ? 3 : 4;
      return '<i class="heat-' + heat + '" style="left:' + ((u[0] - openMin) * PPM) + 'px;width:' + ((u[1] - u[0]) * PPM) + 'px"' +
        ' data-tip="' + esc(free + ' of ' + g.rows.length + ' free · ' + range12(u[0], u[1])) + '"></i>';
    }).join('');
  }

  // ---------- selection ----------
  const laneEl = ri => ctx.container.querySelector('.mc-g-lane[data-ri="' + ri + '"]');

  function paintSel() {
    ctx.container.querySelectorAll('.mc-gsel:not(.is-series)').forEach(n => n.remove());
    if (!sel) return;
    const lane = laneEl(sel.ri);
    if (!lane) return;
    const s = ctx.units[sel.a][0], e = ctx.units[sel.b][1];
    const d = document.createElement('div');
    const wpx = (e - s) * PPM;
    d.className = 'mc-gsel' + (wpx < NARROW_PX ? ' is-narrow' : '') + (wpx < TINY_PX ? ' is-tiny' : '');
    d.style.left = ((s - ctx.openMin) * PPM) + 'px';
    d.style.width = wpx + 'px';
    d.setAttribute('data-tip', 'Selected · ' + range12(s, e));
    d.innerHTML = '<span class="mc-sel-t">Selected</span><span class="mc-sel-s">' + esc(wpx < NARROW_PX ? rangeShort(s, e) : range12(s, e)) + '</span>';
    lane.appendChild(d);
  }

  const toSel = x => x ? { key: ctx.rows[x.ri].key, meta: ctx.rows[x.ri].meta, startMin: ctx.units[x.a][0], endMin: ctx.units[x.b][1] } : null;

  function reach(ri, from, to, t) {
    let a = from, b = to, hit = false;
    const row = ctx.blocked[ri];
    if (t > b) { for (let i = b + 1; i <= t; i++) { if (row[i]) { hit = true; break; } b = i; } }
    else if (t < a) { for (let i = a - 1; i >= t; i--) { if (row[i]) { hit = true; break; } a = i; } }
    return { a, b, hit };
  }

  function unitAt(ri, clientX) {
    const el = laneEl(ri);
    if (!el) return -1;
    const m = ctx.openMin + (clientX - el.getBoundingClientRect().left) / PPM;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < ctx.units.length; i++) {
      const u = ctx.units[i];
      if (m >= u[0] && m < u[1]) return i;
      const d = m < u[0] ? u[0] - m : m - u[1];
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function setSel(next, commit) {
    sel = next;
    paintSel();
    const out = toSel(sel);
    if (commit) ctx.model.onCommit && ctx.model.onCommit(out);
    else ctx.model.onPreview && ctx.model.onPreview(out);
  }

  const CROSS_MSG = 'Stopped at an occupied time — your selection can’t cross another booking or class.';
  function notice(want) {
    if (!ctx.model.onNotice) return;
    ctx.model.onNotice(CROSS_MSG, {
      meta: ctx.rows[want.ri].meta, start: hm(ctx.units[want.a][0]), end: hm(ctx.units[want.b][1])
    });
  }

  function pick(ri, t, mode) {
    const same = sel && sel.ri === ri;
    if (mode === 'extend' && same) {
      const r = reach(ri, sel.a, sel.b, t);
      if (r.hit) notice({ ri, a: Math.min(sel.a, t), b: Math.max(sel.b, t) });
      setSel({ ri, a: r.a, b: r.b }, true);
    } else if (mode === 'tap' && same && (t < sel.a || t > sel.b)) {
      const r = reach(ri, sel.a, sel.b, t);
      setSel(r.hit ? { ri, a: t, b: t } : { ri, a: r.a, b: r.b }, true);
    } else {
      setSel({ ri, a: t, b: t }, true);
    }
  }

  // ---------- pointer / click / keyboard ----------
  function onPointerDown(e) {
    if (!ctx || e.button > 0) return;
    const slot = e.target.closest('.mc-gslot');
    if (!slot || e.pointerType !== 'mouse') return;
    const ri = +slot.dataset.ri, u = +slot.dataset.u;
    e.preventDefault();
    if (e.shiftKey && sel && sel.ri === ri) { pick(ri, u, 'extend'); return; }
    drag = { ri, anchor: u, a: u, b: u, pointerId: e.pointerId, before: sel };
    try { ctx.container.setPointerCapture(e.pointerId); } catch (_) { /* older browsers */ }
    setSel({ ri, a: u, b: u }, false);
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const box = ctx.container.getBoundingClientRect();
    if (e.clientX < box.left + LABEL_W + 40) ctx.container.scrollLeft -= 12;
    else if (e.clientX > box.right - 40) ctx.container.scrollLeft += 12;
    const t = unitAt(drag.ri, e.clientX);
    if (t < 0) return;
    const r = reach(drag.ri, drag.anchor, drag.anchor, t);
    drag.hit = r.hit; drag.want = t;
    if (r.a !== drag.a || r.b !== drag.b) { drag.a = r.a; drag.b = r.b; setSel({ ri: drag.ri, a: r.a, b: r.b }, false); }
  }

  function endDrag(e, cancelled) {
    if (!drag || (e && e.pointerId !== drag.pointerId)) return;
    const d = drag; drag = null;
    try { ctx.container.releasePointerCapture(d.pointerId); } catch (_) { /* ignore */ }
    if (cancelled) { sel = d.before; paintSel(); ctx.model.onPreview && ctx.model.onPreview(toSel(sel)); return; }
    if (d.hit) notice({ ri: d.ri, a: Math.min(d.anchor, d.want), b: Math.max(d.anchor, d.want) });
    setSel({ ri: d.ri, a: d.a, b: d.b }, true);
  }

  function onClick(e) {
    if (!ctx) return;
    const more = e.target.closest('.mc-g-more');
    if (more) {
      const blocks = ctx.rows[+more.dataset.ri].blocks, anchor = blocks[+more.dataset.bi];
      if (window.MCPopover && anchor) {
        const cl = clusterOf(blocks, anchor);
        const lo = Math.min(...cl.map(x => x.startMin)), hi = Math.max(...cl.map(x => x.endMin));
        window.MCPopover.open(more, cl.map(b => {
          const t = range12(b.startMin, b.endMin);
          return { title: b.label, time: t, detail: b.sub && b.sub !== t ? b.sub : '', cls: (/is-mine/.test(b.cls) ? 'is-mine' : /is-class/.test(b.cls) ? 'is-class' : /is-pending/.test(b.cls) ? 'is-pending' : '') + (b.rt ? ' ' + b.rt : '') };
        }), { title: ctx.rows[+more.dataset.ri].head.title + ' · ' + range12(lo, hi) });
      }
      e.preventDefault(); return;
    }
    const grp = e.target.closest('.mc-g-grouprow');
    if (grp) { ctx.model.onToggleGroup && ctx.model.onToggleGroup(grp.dataset.group); return; }
    const block = e.target.closest('.mc-block');
    if (block && ctx.model.staffReadonly) { try { window.top.location.hash = '#reservations'; } catch (_) { /* ignore */ } e.preventDefault(); return; }
    const slot = e.target.closest('.mc-gslot');
    if (!slot || e.pointerType === 'mouse') return;       // mouse is handled by pointerdown/up
    pick(+slot.dataset.ri, +slot.dataset.u, 'tap');
  }

  function focusSlot(ri, u) {
    const el = ctx.container.querySelector('.mc-gslot[data-ri="' + ri + '"][data-u="' + u + '"]');
    if (el) { el.focus(); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return true; }
    return false;
  }

  function onKeyDown(e) {
    if (!ctx) return;
    const grp = e.target.closest && e.target.closest('.mc-g-grouprow');
    if (grp && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ctx.model.onToggleGroup && ctx.model.onToggleGroup(grp.dataset.group); return; }
    const slot = e.target.closest && e.target.closest('.mc-gslot');
    if (!slot) return;
    const ri = +slot.dataset.ri, u = +slot.dataset.u;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(ri, u, e.shiftKey ? 'extend' : 'new'); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      if (e.shiftKey) {
        if (!sel || sel.ri !== ri) setSel({ ri, a: u, b: u }, true);
        const t = (dir > 0 ? sel.b : sel.a) + dir;
        if (t < 0 || t >= ctx.units.length) return;
        pick(ri, t, 'extend'); focusSlot(ri, t); return;
      }
      for (let i = u + dir; i >= 0 && i < ctx.units.length; i += dir) if (focusSlot(ri, i)) break;
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      for (let r = ri + dir; r >= 0 && r < ctx.rows.length; r += dir) {
        let found = false;
        for (let d = 0; d < ctx.units.length && !found; d++) found = focusSlot(r, u + d) || focusSlot(r, u - d);
        if (found) break;
      }
    }
  }

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !ctx || !(sel || drag)) return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (drag) endDrag({ pointerId: drag.pointerId }, true); else setSel(null, true);
  });

  function bind(container) {
    if (bound.has(container)) return;
    bound.add(container);
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', e => endDrag(e, false));
    container.addEventListener('pointercancel', e => endDrag(e, true));
    container.addEventListener('click', onClick);
    container.addEventListener('keydown', onKeyDown);
  }

  // ---------- public ----------
  function render(container, model) {
    const openMin = toMin(model.open), closeMin = toMin(model.close), span = Math.max(1, closeMin - openMin);
    LABEL_W = (window.innerWidth || 1024) < 640 ? 128 : 200;
    PPM = PX_PER_MIN;                // fixed density: 30 minutes = 54px, the scroller handles the rest
    const W = span * PPM;
    const units = model.units || [];

    const rows = [], rowIdx = new Map();
    model.groups.forEach(g => g.rows.forEach(r => { rowIdx.set(r, rows.length); rows.push(r); }));
    const blocked = rows.map(c => units.map(u => isBlocked(c, u)));
    drag = null;
    ctx = { container, model, openMin, closeMin, units, rows, blocked };

    const laneStyle = 'width:' + W + 'px;--hrw:' + (60 * PPM) + 'px;--halfw:' + (30 * PPM) + 'px;--qw:' + (15 * PPM) + 'px;' +
      '--hoff:' + (((60 - (openMin % 60)) % 60) * PPM) + 'px;--qoff:' + (((15 - (openMin % 15)) % 15) * PPM) + 'px';
    const laneCls = 'mc-g-lane';

    let h = '<div class="mc-gantt" style="--lw:' + LABEL_W + 'px">';
    // sticky time header
    const step = 30;
    h += '<div class="mc-g-head" style="height:' + HEAD_H + 'px"><div class="mc-g-corner"><span class="mc-g-corner-t">' + esc(model.cornerLabel || 'Room') + '</span></div><div class="mc-g-times" style="width:' + W + 'px">';
    for (let m = Math.ceil(openMin / step) * step; m <= closeMin; m += step) {
      h += '<span class="mc-g-tl' + (m % 60 ? ' is-minor' : '') + '" style="left:' + ((m - openMin) * PPM) + 'px">' + esc(fmt12(hm(m))) + '</span>';
    }
    h += '</div></div>';

    model.groups.forEach(g => {
      if (g.label != null) {
        h += '<div class="mc-g-row mc-g-grouprow' + (g.open ? ' is-open' : '') + '" role="button" tabindex="0" data-group="' + esc(g.key) + '"' +
          ' aria-expanded="' + (g.open ? 'true' : 'false') + '" style="height:' + GROUP_H + 'px">' +
          '<div class="mc-g-label ' + (window.MCRoomColor ? window.MCRoomColor.cls(g.key) : '') + '"><span class="material-symbols-outlined" aria-hidden="true">' + (g.open ? 'folder_open' : 'folder') + '</span>' +
          '<b>' + esc(g.label) + '</b><em>' + g.rows.length + ' room' + (g.rows.length === 1 ? '' : 's') + '</em></div>' +
          '<div class="' + laneCls + ' mc-g-heat" style="' + laneStyle + '">' + heatHtml(g, rowIdx, ctx) + '</div></div>';
      }
      if (g.label == null || g.open) {
        g.rows.forEach(c => {
          const ri = rowIdx.get(c);
          h += '<div class="mc-g-row" style="height:' + ROW_H + 'px"><div class="mc-g-label' + (g.label != null ? ' is-nested' : '') + (c.head.today ? ' is-today' : '') + (c.head.weekend ? ' is-weekend' : '') + (c.head.rt ? ' has-rt ' + esc(c.head.rt) : '') + '">' +
            '<b>' + esc(c.head.title) + '</b>' + (c.head.badge ? '<span class="mc-badge">' + esc(c.head.badge) + '</span>' : '') +
            '<span>' + esc(c.head.sub) + '</span></div>' +
            '<div class="' + laneCls + (c.head.weekend ? ' is-weekend' : '') + '" data-ri="' + ri + '" style="' + laneStyle + '">' + laneHtml(c, ri, ctx, W) + '</div></div>';
        });
      }
    });
    h += '</div>';
    container.innerHTML = h;
    bind(container);

    // One focusable slot per row (arrow keys move from there) keeps Tab usable with 50 rows.
    container.querySelectorAll('.mc-g-lane[data-ri]').forEach(l => { const s = l.querySelector('.mc-gslot'); if (s) s.tabIndex = 0; });

    sel = null;
    const s = model.selection;
    if (s && units.length) {
      const ri = rows.findIndex(c => c.key === s.key);
      if (ri >= 0 && container.querySelector('.mc-g-lane[data-ri="' + ri + '"]')) {
        const a = units.findIndex(u => u[1] > s.startMin), bRev = units.slice().reverse().findIndex(u => u[0] < s.endMin);
        const b = bRev < 0 ? -1 : units.length - 1 - bRev;
        if (a >= 0 && b >= a) { sel = { ri, a, b }; paintSel(); }
      }
    }
    // Other days of a multi-day booking: same time on each row, shown as fixed highlights (not draggable).
    (model.extraSelections || []).forEach(x => {
      const ri = rows.findIndex(c => c.key === x.key);
      const lane = ri >= 0 && container.querySelector('.mc-g-lane[data-ri="' + ri + '"]');
      if (!lane || !units.length) return;
      const a = units.findIndex(u => u[1] > x.startMin), bRev = units.slice().reverse().findIndex(u => u[0] < x.endMin);
      const b = bRev < 0 ? -1 : units.length - 1 - bRev;
      if (a < 0 || b < a) return;
      const s = units[a][0], e = units[b][1], wpx = (e - s) * PPM, d = document.createElement('div');
      d.className = 'mc-gsel is-series' + (x.blocked ? ' is-blocked' : '') + (wpx < NARROW_PX ? ' is-narrow' : '') + (wpx < TINY_PX ? ' is-tiny' : '');
      d.style.left = ((s - openMin) * PPM) + 'px';
      d.style.width = wpx + 'px';
      const label = x.blocked ? 'Blocked' : 'Included';
      d.setAttribute('data-tip', label + ' · ' + range12(s, e) + (x.reason ? ' · ' + x.reason : ''));
      d.innerHTML = '<span class="mc-sel-t">' + label + '</span><span class="mc-sel-s">' + esc(wpx < NARROW_PX ? rangeShort(s, e) : range12(s, e)) + '</span>';
      lane.appendChild(d);
    });
    return { scrollToMin: m => { container.scrollLeft = Math.max(0, (m - openMin) * PPM - 40); } };
  }

  function reset() { ctx = null; drag = null; sel = null; }

  window.MCGantt = Object.freeze({ render, reset, dragging: () => !!drag, active: () => !!ctx, scale: () => PPM });
})();
