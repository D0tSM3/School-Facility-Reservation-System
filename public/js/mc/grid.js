/**
 * CampusRoom — Master Calendar grid renderer (Day / Week columns + Month cells)
 * and the click-and-drag slot picker (Phase 3).
 *
 * Time is positioned in absolute pixels (SCALE px per minute) so a 90-minute
 * block is visibly taller than a 30-minute one.
 *
 * model = {
 *   open: 'HH:MM', close: 'HH:MM',
 *   units: [[startMin, endMin], …],          // snap periods (clipped to hours); [] ⇒ no picking
 *   selection: null | { key, startMin, endMin },
 *   onPreview(sel|null), onCommit(sel|null),
 *   onNotice(text, wanted)   // wanted = { meta, start, end } the window the drag tried to cover when it hit a booking (Phase 4), else null
 *   columns: [{
 *     key, label, meta,                      // key = unique per column; meta is handed back in sel
 *     head:   { title, sub, today, badge },
 *     blocks: [{ startMin, endMin, cls, label, sub, tip }],
 *     overlay: null | { kind: 'holiday'|'closed'|'maint', label },
 *     pastUntil: null | 'all' | minutes,     // hatched, un-selectable past
 *     nowMin: null | minutes                 // red "now" line
 *   }]
 * }
 * sel = { key, meta, startMin, endMin }      // always whole periods, one column
 *
 * Picking: mouse drag (or click, Shift+click to extend); touch/pen tap-tap;
 * keyboard on the focusable free periods (Enter, Shift+Arrows, Esc). Nothing is
 * submitted here — the page only receives the chosen window.
 */
(function () {
  'use strict';

  let SCALE = 1.2; // px per minute; recalculated for the available viewport
  const esc = v => window.CampusRoomUtil.escapeHtml(v);
  const toMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const hm = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  const fmt12 = t => window.CampusSchedule.fmt12(t);
  const range12 = (s, e) => fmt12(hm(s)) + ' – ' + fmt12(hm(e));

  // ---------- state of the grid that is currently on screen ----------
  let ctx = null;        // { container, model, openMin, closeMin, blocked: bool[col][unit] }
  let drag = null;       // { colIdx, anchor, a, b, pointerId, before }
  let sel = null;        // { colIdx, a, b } — the visible selection
  const bound = new WeakSet();

  // ---------- markup ----------
  function blockHtml(b, openMin, closeMin, lane) {
    const s = Math.max(b.startMin, openMin), e = Math.min(b.endMin, closeMin);
    if (e <= s) return '';
    const top = (s - openMin) * SCALE;
    const height = Math.max((e - s) * SCALE, 14);
    const time = range12(b.startMin, b.endMin);
    lane = lane || { lane: 0, laneCount: 1 };
    const left = lane.lane * 100 / lane.laneCount, width = 100 / lane.laneCount;
    return '<div class="mc-block ' + esc(b.cls) + '" tabindex="0"' +
      ' style="top:' + top + 'px;height:' + height + 'px;left:' + left + '%;width:' + width + '%"' +
      ' data-tip="' + esc(b.tip) + '" aria-label="' + esc(b.tip) + '">' +
      '<span class="mc-block-t">' + esc(b.label) + '</span>' +
      '<span class="mc-block-s">' + esc(b.sub || time) + '</span></div>';
  }

  /** A unit is un-pickable if the column is closed/past or anything overlaps it. */
  function isBlocked(c, u) {
    if (c.overlay || c.pastUntil === 'all') return true;
    if (typeof c.pastUntil === 'number' && u[0] <= c.pastUntil) return true; // server: start must be in the future
    return c.blocks.some(b => b.startMin < u[1] && b.endMin > u[0]);
  }

  function moreChips(c, ci, openMin, lanes) {
    const sorted = c.blocks.map((b,i)=>({b,i})).sort((a,b)=>a.b.startMin-b.b.startMin || a.b.endMin-b.b.endMin);
    const out=[]; let cluster=[], end=-Infinity;
    function flush() {
      const hidden=cluster.filter(x=>lanes[x.i] && lanes[x.i].hidden);
      if(hidden.length) {
        const first=hidden.reduce((a,x)=>x.b.startMin<a.b.startMin?x:a,hidden[0]);
        const n=hidden.length, top=(first.b.startMin-openMin)*SCALE;
        out.push('<button type="button" class="mc-more-chip" data-more-ci="'+ci+'" data-more-index="'+first.i+'" style="top:'+top+'px;left:66.666%;width:33.334%;" aria-label="Show '+n+' more bookings">+'+n+' more</button>');
      }
      cluster=[]; end=-Infinity;
    }
    sorted.forEach(x=>{ if(cluster.length && x.b.startMin>=end) flush(); cluster.push(x); end=Math.max(end,x.b.endMin); });
    flush(); return out.join('');
  }

  function columnHtml(c, ci, m, total, hr, off) {
    const { openMin, closeMin, units, blocked } = m;
    const lanes = window.MCLanes ? window.MCLanes.layout(c.blocks, 3) : c.blocks.map(() => ({ lane: 0, laneCount: 1, hidden: false }));
    let h = '<div class="mc-col" data-ci="' + ci + '" style="height:' + total + 'px;--hr:' + hr + 'px;--half:' + (30 * SCALE) + 'px;--off:' + off + 'px">';

    if (c.overlay) {
      h += '<div class="mc-ov is-' + esc(c.overlay.kind) + '" style="top:0;height:' + total + 'px"><span>' +
           esc(c.overlay.label) + '</span></div>';
    } else {
      // Class periods are faint guides only; booking units remain 30 minutes.
      (m.model.guides || []).forEach(period => {
        const gs=Math.max(openMin,toMin(period[0])), ge=Math.min(closeMin,toMin(period[1]));
        if (ge>gs) h += '<div class="mc-guide-band" aria-hidden="true" style="top:'+((gs-openMin)*SCALE)+'px;height:'+((ge-gs)*SCALE)+'px"><span>'+esc(fmt12(period[0])+'–'+fmt12(period[1]))+'</span></div>';
      });
      // Read-only embeds display occupancy but never render selectable slots.
      // Minutes no period covers (e.g. before the first period) can't be booked: shade them.
      if (units.length) {
        let cursor = openMin;
        const gaps = [];
        units.forEach(u => { if (u[0] > cursor) gaps.push([cursor, u[0]]); cursor = Math.max(cursor, u[1]); });
        if (cursor < closeMin) gaps.push([cursor, closeMin]);
        gaps.forEach(g => { h += '<div class="mc-ov is-gap" style="top:' + ((g[0] - openMin) * SCALE) + 'px;height:' + ((g[1] - g[0]) * SCALE) + 'px"></div>'; });
      }
      units.forEach((u, i) => {
        if (m.model.readonly || blocked[ci][i]) return;
        h += '<div class="mc-slot" role="button" tabindex="0" data-ci="' + ci + '" data-u="' + i + '"' +
          ' style="top:' + ((u[0] - openMin) * SCALE) + 'px;height:' + ((u[1] - u[0]) * SCALE) + 'px"' +
          ' aria-label="' + esc('Select ' + c.label + ', ' + range12(u[0], u[1])) + '"></div>';
      });
      h += c.blocks.map((b, i) => lanes[i] && lanes[i].hidden ? '' : blockHtml(b, openMin, closeMin, lanes[i])).join('');
      h += moreChips(c, ci, openMin, lanes);
    }

    if (c.pastUntil === 'all') {
      h += '<div class="mc-ov is-past" style="top:0;height:' + total + 'px"></div>';
    } else if (typeof c.pastUntil === 'number' && c.pastUntil > openMin) {
      const ph = (Math.min(c.pastUntil, closeMin) - openMin) * SCALE;
      h += '<div class="mc-ov is-past" style="top:0;height:' + ph + 'px"></div>';
    }
    if (typeof c.nowMin === 'number' && c.nowMin >= openMin && c.nowMin <= closeMin) {
      h += '<div class="mc-now" style="top:' + ((c.nowMin - openMin) * SCALE) + 'px"></div>';
    }
    return h + '</div>';
  }

  // ---------- selection drawing ----------
  function colEl(ci) { return ctx.container.querySelector('.mc-col[data-ci="' + ci + '"]'); }

  function paintSel() {
    ctx.container.querySelectorAll('.mc-sel').forEach(n => n.remove());
    if (!sel) return;
    const wrap = colEl(sel.colIdx);
    if (!wrap) return;
    const s = ctx.units[sel.a][0], e = ctx.units[sel.b][1];
    const d = document.createElement('div');
    d.className = 'mc-sel';
    d.style.top = ((s - ctx.openMin) * SCALE) + 'px';
    d.style.height = ((e - s) * SCALE) + 'px';
    d.innerHTML = '<span class="mc-sel-t">Selected</span><span class="mc-sel-s">' + esc(range12(s, e)) + '</span>';
    wrap.appendChild(d);
  }

  const toSel = x => x ? {
    key: ctx.model.columns[x.colIdx].key,
    meta: ctx.model.columns[x.colIdx].meta,
    startMin: ctx.units[x.a][0],
    endMin: ctx.units[x.b][1]
  } : null;

  // ---------- picking logic ----------
  /** Widen/narrow from `anchorA..anchorB` toward unit `t`, stopping at the first un-pickable unit. */
  function reach(ci, from, to, t) {
    let a = from, b = to, hit = false;
    const row = ctx.blocked[ci];
    if (t > b) { for (let i = b + 1; i <= t; i++) { if (row[i]) { hit = true; break; } b = i; } }
    else if (t < a) { for (let i = a - 1; i >= t; i--) { if (row[i]) { hit = true; break; } a = i; } }
    return { a, b, hit };
  }

  function unitAt(ci, clientY, strict) {
    const el = colEl(ci);
    if (!el) return -1;
    const m = ctx.openMin + (clientY - el.getBoundingClientRect().top) / SCALE;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < ctx.units.length; i++) {
      const u = ctx.units[i];
      if (m >= u[0] && m < u[1]) return i;
      if (strict) continue;
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
  /** `want` = { colIdx, a, b } unit range the user tried to cover; handed on as { meta, start, end } times. */
  function notice(t, want) {
    if (!ctx.model.onNotice) return;
    const info = want ? {
      meta: ctx.model.columns[want.colIdx].meta,
      start: hm(ctx.units[want.a][0]),
      end: hm(ctx.units[want.b][1])
    } : null;
    ctx.model.onNotice(t, info);
  }

  /**
   * Choose unit `t` in column `ci`.
   *   mode 'new'    — start a fresh one-period selection;
   *   mode 'extend' — widen the current selection (same column) to `t`, stopping at the first
   *                   occupied period (Shift+click, Shift+Arrow);
   *   mode 'tap'    — touch/pen: a tap outside the current selection extends it, a tap inside
   *                   (or one that would cross a booking) starts over from that period.
   */
  function pick(ci, t, mode) {
    const same = sel && sel.colIdx === ci;
    if (mode === 'extend' && same) {
      const r = reach(ci, sel.a, sel.b, t);
      if (r.hit) notice(CROSS_MSG, { colIdx: ci, a: Math.min(sel.a, t), b: Math.max(sel.b, t) });
      setSel({ colIdx: ci, a: r.a, b: r.b }, true);
    } else if (mode === 'tap' && same && (t < sel.a || t > sel.b)) {
      const r = reach(ci, sel.a, sel.b, t);
      setSel(r.hit ? { colIdx: ci, a: t, b: t } : { colIdx: ci, a: r.a, b: r.b }, true);
    } else {
      setSel({ colIdx: ci, a: t, b: t }, true);
    }
  }

  // ---------- pointer handling (mouse = drag; touch/pen = tap, tap) ----------
  function onPointerDown(e) {
    if (!ctx || e.button > 0) return;
    const slot = e.target.closest('.mc-slot');
    if (!slot || e.pointerType !== 'mouse') return;          // touch/pen are handled on click
    const ci = +slot.dataset.ci, u = +slot.dataset.u;
    e.preventDefault();                                       // no text selection while dragging
    if (e.shiftKey && sel && sel.colIdx === ci) { pick(ci, u, 'extend'); return; }
    drag = { colIdx: ci, anchor: u, a: u, b: u, pointerId: e.pointerId, before: sel };
    try { ctx.container.setPointerCapture(e.pointerId); } catch (_) { /* older browsers */ }
    setSel({ colIdx: ci, a: u, b: u }, false);
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    // Nudge the scroller when the pointer nears its top/bottom edge.
    const box = ctx.container.getBoundingClientRect();
    if (e.clientY < box.top + 70) ctx.container.scrollTop -= 12;
    else if (e.clientY > box.bottom - 24) ctx.container.scrollTop += 12;

    const t = unitAt(drag.colIdx, e.clientY, false);
    if (t < 0) return;
    const r = reach(drag.colIdx, drag.anchor, drag.anchor, t);
    drag.hit = r.hit;
    drag.want = t;                                            // how far the pointer actually went
    if (r.a !== drag.a || r.b !== drag.b) {
      drag.a = r.a; drag.b = r.b;
      setSel({ colIdx: drag.colIdx, a: r.a, b: r.b }, false);
    }
  }

  function endDrag(e, cancelled) {
    if (!drag || (e && e.pointerId !== drag.pointerId)) return;
    const d = drag; drag = null;
    try { ctx.container.releasePointerCapture(d.pointerId); } catch (_) { /* ignore */ }
    if (cancelled) { sel = d.before; paintSel(); ctx.model.onPreview && ctx.model.onPreview(toSel(sel)); return; }
    if (d.hit) notice(CROSS_MSG, { colIdx: d.colIdx, a: Math.min(d.anchor, d.want), b: Math.max(d.anchor, d.want) });
    setSel({ colIdx: d.colIdx, a: d.a, b: d.b }, true);
  }

  function onClick(e) {
    if (!ctx) return;
    const more = e.target.closest('.mc-more-chip');
    if (more) {
      const ci=Number(more.dataset.moreCi), index=Number(more.dataset.moreIndex), blocks=ctx.model.columns[ci].blocks, anchor=blocks[index];
      if (window.MCPopover && anchor) {
        let cluster=blocks.filter(b=>b.startMin<anchor.endMin && b.endMin>anchor.startMin), changed=true;
        while(changed){changed=false;cluster.forEach(a=>blocks.forEach(b=>{if(b.startMin<Math.max(...cluster.map(x=>x.endMin)) && b.endMin>Math.min(...cluster.map(x=>x.startMin)) && !cluster.includes(b)){cluster.push(b);changed=true;}}));}
        window.MCPopover.open(more,cluster.map(b=>({title:b.label,detail:b.sub||range12(b.startMin,b.endMin)})));
      }
      e.preventDefault(); return;
    }
    const block = e.target.closest('.mc-block');
    if (block && ctx.model.staffReadonly) { try { window.top.location.hash = '#reservations'; } catch (_) {} e.preventDefault(); return; }
    const slot = e.target.closest('.mc-slot');
    if (!slot) return;
    // Mouse is fully handled by pointerdown/up; this path is touch, pen and old browsers.
    if (e.pointerType === 'mouse') return;
    pick(+slot.dataset.ci, +slot.dataset.u, 'tap');          // second tap in the same column extends
  }

  // ---------- keyboard ----------
  function focusSlot(ci, u) {
    const el = ctx.container.querySelector('.mc-slot[data-ci="' + ci + '"][data-u="' + u + '"]');
    if (el) { el.focus(); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); return true; }
    return false;
  }

  function onKeyDown(e) {
    if (!ctx) return;
    const slot = e.target.closest && e.target.closest('.mc-slot');
    if (!slot) return;
    const ci = +slot.dataset.ci, u = +slot.dataset.u;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(ci, u, e.shiftKey ? 'extend' : 'new');
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      if (e.shiftKey) {
        if (!sel || sel.colIdx !== ci) setSel({ colIdx: ci, a: u, b: u }, true);
        const t = (dir > 0 ? sel.b : sel.a) + dir;
        if (t < 0 || t >= ctx.units.length) return;
        pick(ci, t, 'extend');
        focusSlot(ci, t);
        return;
      }
      for (let i = u + dir; i >= 0 && i < ctx.units.length; i += dir) if (focusSlot(ci, i)) break;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      for (let c = ci + dir; c >= 0 && c < ctx.model.columns.length; c += dir) {
        let found = false;
        for (let d = 0; d < ctx.units.length && !found; d++) found = focusSlot(c, u + d) || focusSlot(c, u - d);
        if (found) break;
      }
    }
  }

  // Esc cancels a drag or clears the picked slot from anywhere on the page (but not while typing).
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !ctx || !(sel || drag)) return;
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (drag) endDrag({ pointerId: drag.pointerId }, true);
    else setSel(null, true);
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

  // ---------- public: render ----------
  /** Draw the grid into `container` (the single scroll element). Returns {scrollToMin}. */
  function render(container, model) {
    const openMin = toMin(model.open), closeMin = toMin(model.close);
    const availableHeight = Math.max(320, Math.min((window.innerHeight || 900) - 260, 1000));
    SCALE = Math.max(0.9, Math.min(1.6, availableHeight / Math.max(1, closeMin - openMin)));
    const total = (closeMin - openMin) * SCALE;
    const hr = 60 * SCALE;
    const off = ((60 - (openMin % 60)) % 60) * SCALE;
    const n = model.columns.length;
    const units = model.units || [];
    const blocked = model.columns.map(c => units.map(u => isBlocked(c, u)));

    // Keep keyboard focus on the same slot across a redraw.
    const act = document.activeElement;
    const keepFocus = act && container.contains(act) && act.classList && act.classList.contains('mc-slot')
      ? { ci: act.dataset.ci, u: act.dataset.u } : null;

    drag = null;
    ctx = { container, model, openMin, closeMin, units, blocked };

    let h = '<div class="mc-grid" style="--mc-ppm:' + SCALE + 'px;grid-template-columns:var(--mc-time-col,64px) repeat(' + n + ',minmax(var(--mc-col-min,120px),1fr))">';
    h += '<div class="mc-corner"></div>';
    h += model.columns.map(c =>
      '<div class="mc-head' + (c.head.today ? ' is-today' : '') + '">' +
      '<div class="mc-head-title">' + esc(c.head.title) +
      (c.head.badge ? '<span class="mc-badge">' + esc(c.head.badge) + '</span>' : '') + '</div>' +
      '<div class="mc-head-sub">' + esc(c.head.sub) + '</div></div>').join('');

    h += '<div class="mc-times" style="height:' + total + 'px">';
    for (let m = Math.ceil(openMin / 60) * 60; m <= closeMin; m += 60) {
      h += '<span class="mc-time-label" style="top:' + ((m - openMin) * SCALE) + 'px">' + esc(fmt12(hm(m))) + '</span>';
    }
    h += '</div>';

    h += model.columns.map((c, ci) => columnHtml(c, ci, ctx, total, hr, off)).join('');
    h += '</div>';
    container.innerHTML = h;
    bind(container);

    // Re-draw the selection if its column is on screen (matched by key, not position).
    sel = null;
    const s = model.selection;
    if (s && units.length) {
      const ci = model.columns.findIndex(c => c.key === s.key);
      if (ci >= 0) {
        const a = units.findIndex(u => u[1] > s.startMin), bRev = units.slice().reverse().findIndex(u => u[0] < s.endMin);
        const b = bRev < 0 ? -1 : units.length - 1 - bRev;
        if (a >= 0 && b >= a) { sel = { colIdx: ci, a, b }; paintSel(); }
      }
    }
    if (keepFocus) focusSlot(+keepFocus.ci, +keepFocus.u);

    return { scrollToMin: m => { container.scrollTop = Math.max(0, (m - openMin) * SCALE - 100); } };
  }

  /** Is a drag in progress? (The page must not redraw mid-drag.) */
  const dragging = () => !!drag;
  const scale = () => SCALE;

  /** Scroll so a time (minutes) is near the top — used when jumping to a chosen slot. */
  function scrollTo(container, min) {
    if (!ctx || ctx.container !== container) return;
    container.scrollTop = Math.max(0, (min - ctx.openMin) * SCALE - 100);
  }

  /**
   * Month view: one button per day showing how many rooms still have a free
   * period. Not draggable — clicking a day (data-date) is handled by the page.
   *
   * model = {
   *   weekdays: ['Mon', ...7],
   *   cells: [{ date, day, inMonth, today, past, kind: 'open'|'closed'|'holiday',
   *             label, free, total, tip }]   // length = 7 * weeks
   * }
   */
  function renderMonth(container, model) {
    ctx = null; drag = null; sel = null;
    let h = '<div class="mc-month">';
    h += model.weekdays.map(w => '<div class="mc-mhead">' + esc(w) + '</div>').join('');
    h += model.cells.map(c => {
      const ratio = c.total ? c.free / c.total : 0;
      const heat = c.kind !== 'open' ? 'x' : c.free === 0 ? '0' : ratio <= 0.25 ? '1' : ratio <= 0.5 ? '2' : ratio <= 0.75 ? '3' : '4';
      const text = c.kind !== 'open' ? c.label
        : !c.total ? 'No rooms'
        : c.free === 0 ? 'Fully booked'
        : c.free + (c.free === 1 ? ' room free' : ' rooms free');
      return '<button type="button" class="mc-mcell heat-' + heat + (c.inMonth ? '' : ' is-out') +
        (c.today ? ' is-today' : '') + (c.past ? ' is-past' : '') + '"' +
        ' data-date="' + esc(c.date) + '" data-tip="' + esc(c.tip) + '" aria-label="' + esc(c.tip) + '">' +
        '<span class="mc-mday">' + esc(c.day) + '</span>' +
        '<span class="mc-mtext">' + esc(text) + '</span>' +
        (c.kind === 'open' && c.total ? '<span class="mc-mbar"><i style="width:' + Math.round(ratio * 100) + '%"></i></span>' : '') +
        '</button>';
    }).join('');
    container.innerHTML = h + '</div>';
  }

  window.MCGrid = Object.freeze({ render, renderMonth, scrollTo, dragging, toMin, hm, scale: () => SCALE });
})();
