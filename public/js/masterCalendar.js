/**
 * CampusRoom — Master Calendar page (Phase 4: smart suggestions on top of drag-to-book).
 *
 * Reads GET api/calendar/master. Picking a slot only fills the summary panel
 * (mc/summary.js); the booking itself goes through the existing POST api/reservations.
 *   Day   view: columns = rooms,  one date.
 *   Week  view: columns = days (Mon–Sun), one room.
 *   Month view: one cell per day = how many rooms still have a free period.
 * Filters (mc/filters.js) are applied client-side to the room list; the same
 * all-rooms response also answers "Available Now" and "Only free during…".
 * "Now" always comes from the server (Asia/Manila), never the device clock.
 * Phase 4: when a pick is taken / no longer free / refused with a 409, mc/suggest.js shows the
 * next free times in that room and similar free rooms inside the summary panel.
 */
(function () {
  'use strict';

  const S = window.CampusSchedule;
  const G = window.MCGrid;
  const F = window.MCFilters;
  const M = window.MCSummary;
  const SG = window.MCSuggest;
  const esc = v => window.CampusRoomUtil.escapeHtml(v);
  const BASE = window.location.pathname.replace(/[^\/]*$/, '');
  const query = new URLSearchParams(window.location.search);
  const EMBED = query.get('embed') === '1';
  // Staff/Admin see the same page read-only (full requester detail, no booking panel).
  // The cosmetic role hint only avoids a flash of the booking UI; the SERVER decides
  // the real mode via `viewer_role` on the first /api/calendar/master response.
  const hintRole = (function () { try { return String(localStorage.getItem('campus_role') || '').toLowerCase(); } catch (e) { return ''; } })();
  let READONLY = query.get('readonly') === '1' || hintRole === 'staff' || hintRole === 'admin';
  if (EMBED) document.documentElement.setAttribute('data-embed', '1');
  function setReadonly(on) {
    READONLY = !!on;
    if (READONLY) document.documentElement.setAttribute('data-readonly', '1');
    else document.documentElement.removeAttribute('data-readonly');
  }
  setReadonly(READONLY);
  const CACHE_MS = 60 * 1000;
  const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const el = id => document.getElementById(id);
  const gridEl = el('mcGrid'), tipEl = el('mcTip'), errEl = el('mcError'), titleEl = el('mcTitle');
  const roomSel = el('mcRoom'), dateInp = el('mcDate'), toastEl = el('mcToast');

  const state = {
    view: 'day',        // 'day' | 'week' | 'month'
    dayMode: 'rooms',   // 'rooms' | 'timeline'
    showClasses: false,
    date: '',           // 'YYYY-MM-DD' anchor
    roomId: '',         // week view
    allRooms: [],       // every active room (static fields), from the newest all-rooms fetch
    rules: null,        // newest rules from the server
    current: null,      // { entry, matching, index } being drawn
    clock: null,        // { wallMs, at } from the newest server_now
    firstPaint: true,
    sel: null,          // picked slot { roomId, date, start, end } — survives view/date changes
    scrollTo: null      // minutes to scroll to after the next draw ("Show on calendar")
  };
  const cache = new Map();
  let seq = 0;

  // ---------- date helpers (local parts only, so the device zone cannot shift a day) ----------
  const parseYMD = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s); return new Date(+m[1], +m[2] - 1, +m[3]); };
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const addDays = (s, n) => { const d = parseYMD(s); d.setDate(d.getDate() + n); return ymd(d); };
  const weekStart = s => addDays(s, -((parseYMD(s).getDay() + 6) % 7)); // Monday
  const shortDate = s => { const d = parseYMD(s); return MONTHS[d.getMonth()] + ' ' + d.getDate(); };

  /** Server "now" advanced by elapsed time: { ymd, min }. */
  function now() {
    if (!state.clock) return null;
    const d = new Date(state.clock.wallMs + (Date.now() - state.clock.at));
    return { ymd: ymd(d), min: d.getHours() * 60 + d.getMinutes() };
  }
  function setClock(serverNow) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(serverNow || '');
    if (!m) return;
    state.clock = { wallMs: new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime(), at: Date.now() };
  }

  // ---------- data ----------
  async function fetchMaster(params) {
    const qs = Object.keys(params).filter(k => params[k]).map(k => k + '=' + encodeURIComponent(params[k])).join('&');
    const res = await fetch(BASE + 'api/calendar/master' + (qs ? '?' + qs : ''), { credentials: 'include' });
    if (res.status === 401) { window.location.href = 'index.html'; throw new Error('Signed out'); }
    if (res.status === 403) throw new Error('Your account cannot access this calendar.');
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || !json.success) throw new Error((json && json.message) || 'Could not load the calendar.');
    const data = json.data;
    if (data.viewer_role) setReadonly(String(data.viewer_role).toLowerCase() !== 'customer');
    data.fetchedAt = Date.now();
    setClock(data.server_now);
    return data;
  }

  const slimRoom = ({ room_id, name, capacity, floor, room_type, status, requires_approval }) =>
    ({ room_id, name, capacity, floor, room_type, status, requires_approval });

  /** Cached master-calendar fetch. An all-rooms answer also refreshes the room list the filters use. */
  async function getEntry(start, end, roomIds) {
    const key = start + '|' + end + '|' + (roomIds || '');
    let entry = cache.get(key);
    if (!entry || Date.now() - entry.fetchedAt > CACHE_MS) {
      entry = await fetchMaster({ start, end, room_ids: roomIds || '' });
      entry.reqStart = start; entry.reqEnd = end;
      cache.set(key, entry);
    }
    state.rules = entry.rules;
    F.setRules(entry.rules);
    if (!roomIds) noteRooms(entry);
    return entry;
  }

  function noteRooms(entry) {
    state.allRooms = entry.rooms.map(slimRoom);
    F.setRooms(state.allRooms);
    M.touch();
  }

  const indexOf = entry => ({ entry, rooms: new Map(entry.rooms.map(r => [r.room_id, r])) });
  const mkCtx = index => ({ now: now(), rules: state.rules, index });

  /** First/last visible day of the month grid (Monday-first, whole weeks). */
  function monthRange(date) {
    const first = date.slice(0, 7) + '-01';
    const lastD = parseYMD(first); lastD.setMonth(lastD.getMonth() + 1); lastD.setDate(0);
    return { start: weekStart(first), end: addDays(weekStart(ymd(lastD)), 6) };
  }

  /** Load whatever the current view + filters need, then draw. Newest call wins. */
  async function refresh() {
    const mine = ++seq;
    gridEl.classList.add('mc-loading');
    gridEl.setAttribute('aria-busy', 'true');
    try {
      const f = F.get();
      const n0 = now();
      const need = new Set();
      if (f.now && n0) need.add(n0.ymd);
      const w = F.windowState(f, n0);
      if (w.valid) need.add(w.date);

      const index = {};
      for (const d of need) index[d] = indexOf(await getEntry(d, d, ''));
      if (mine !== seq) return;

      let entry, matching;
      if (state.view === 'week') {
        matching = F.apply(state.allRooms, f, mkCtx(index));
        fillRoomSelect(matching);
        if (matching.length) {
          if (state.roomId && !matching.some(r => r.room_id === state.roomId)) state.roomId = '';
          const ws = weekStart(state.date);
          entry = await getEntry(ws, addDays(ws, 6), state.roomId);
        }
      } else {
        const r = state.view === 'month' ? monthRange(state.date) : { start: weekStart(state.date), end: addDays(weekStart(state.date), 6) };
        entry = await getEntry(r.start, r.end, '');
        matching = F.apply(state.allRooms, f, mkCtx(index));
      }
      if (mine !== seq) return;

      hideError();
      gridEl.classList.remove('mc-loading');
      gridEl.setAttribute('aria-busy', 'false');
      state.current = { entry, matching, index };
      draw();
    } catch (e) {
      if (mine === seq) { gridEl.classList.remove('mc-loading'); gridEl.setAttribute('aria-busy', 'false'); showError(e.message); }
    }
  }

  // ---------- model ----------
  function buildColumn(room, date, entry, head) {
    const rules = entry.rules;
    const col = {
      key: room.room_id + '|' + date, meta: { roomId: room.room_id, date },
      label: room.name + ', ' + shortDate(date),
      head, blocks: [], overlay: null, pastUntil: null, nowMin: null
    };
    const holiday = entry.holidays.find(h => String(h.holiday_date).slice(0, 10) === date);

    if (holiday) col.overlay = { kind: 'holiday', label: holiday.name };
    else if (S.isClosedDay(date, rules.closedDays)) col.overlay = { kind: 'closed', label: 'Closed' };
    else if (room.status === 'Maintenance') col.overlay = { kind: 'maint', label: 'Under maintenance' };
    else {
      const dow = S.dayName(date);
      room.classes.filter(c => c.day_of_week === dow).forEach(c => {
        const label = c.course_code + ' – Sec ' + c.section;
        const range = S.fmt12(c.start_time) + ' – ' + S.fmt12(c.end_time);
        col.blocks.push({
          startMin: G.toMin(c.start_time), endMin: G.toMin(c.end_time),
          cls: 'is-class', label, sub: range, tip: label + ' · ' + range
        });
      });
      room.reservations.filter(r => String(r.start_time).slice(0, 10) === date).forEach(r => {
        const s = S.hhmm(r.start_time), e = S.hhmm(r.end_time);
        const range = S.fmt12(s) + ' – ' + S.fmt12(e);
        const pending = r.status === 'Pending';
        let cls = pending ? 'is-pending' : '', label, tip;
        if (r.is_mine) {
          cls += ' is-mine' + (r.category === 'Exam/Quiz' ? ' is-exam' : '');
          label = r.purpose;
          tip = r.purpose + ' · ' + r.category + ' · ' + r.status + ' · ' + range;
        } else if (READONLY && r.requester_name) {
          label = r.purpose || 'Reserved';
          tip = label + ' · ' + r.requester_name + ' · ' + (r.category || 'Uncategorized') + ' · ' + r.status + ' · ' + range;
        } else {
          label = pending ? 'Reserved (pending)' : 'Reserved';
          tip = (pending ? 'Reserved · Pending approval' : 'Reserved') + ' · ' + range;
        }
        const sub = READONLY && !r.is_mine && r.requester_name ? (r.requester_name + ' · ' + (r.category || 'Uncategorized') + ' · ' + r.status) : range;
        col.blocks.push({ startMin: G.toMin(s), endMin: G.toMin(e), cls, label, sub, tip });
      });
    }

    const n = now();
    if (n) {
      if (date < n.ymd) col.pastUntil = 'all';
      else if (date === n.ymd) { col.pastUntil = n.min; col.nowMin = n.min; }
    }
    return col;
  }

  function buildOverviewColumn(date, entry, head) {
    const col = { key: 'overview|' + date, meta: { roomId: '', date }, label: 'All rooms, ' + shortDate(date), head, blocks: [], overlay: null, pastUntil: null, nowMin: null };
    const holiday = (entry.holidays || []).find(h => String(h.holiday_date).slice(0, 10) === date);
    if (holiday) col.overlay = { kind: 'holiday', label: holiday.name };
    else if (S.isClosedDay(date, entry.rules.closedDays)) col.overlay = { kind: 'closed', label: 'Closed' };
    else {
      entry.rooms.forEach(room => {
        if (room.status === 'Maintenance') return;
        if (state.showClasses) room.classes.filter(c => c.day_of_week === S.dayName(date)).forEach(c => {
          const label = c.course_code + ' – Sec ' + c.section;
          col.blocks.push({ startMin:G.toMin(c.start_time), endMin:G.toMin(c.end_time), cls:'is-class', label, sub:room.name, tip:label+' · '+room.name });
        });
        room.reservations.filter(rv => String(rv.start_time).slice(0,10) === date).forEach(rv => {
          const start = S.hhmm(rv.start_time), end = S.hhmm(rv.end_time), range = S.fmt12(start)+' – '+S.fmt12(end);
          const pending = rv.status === 'Pending';
          const cls = (pending ? 'is-pending ' : '') + (rv.is_mine ? 'is-mine' + (rv.category === 'Exam/Quiz' ? ' is-exam' : '') : '');
          const label = READONLY ? (rv.purpose || 'Reserved') : (rv.is_mine ? rv.purpose : (pending ? 'Reserved (pending)' : 'Reserved'));
          const sub = READONLY ? ((rv.requester_name || 'Requester unavailable')+' · '+room.name+' · '+rv.status) : (room.name+' · '+range+' · '+rv.status);
          const tip = READONLY ? (label+' · '+(rv.category || '')+' · '+sub+' · '+range) : (rv.is_mine ? label+' · '+(rv.category || '')+' · '+range : 'Reserved · '+range);
          col.blocks.push({ startMin:G.toMin(start), endMin:G.toMin(end), cls, label, sub, tip });
        });
      });
    }
    const n = now();
    if (n) { if (date < n.ymd) col.pastUntil = 'all'; else if (date === n.ymd) { col.pastUntil = n.min; col.nowMin = n.min; } }
    return col;
  }

  function renderDayStrip(entry) {
    const strip = el('mcDayStrip');
    if (!strip) return;
    strip.classList.toggle('hidden', state.view !== 'day');
    const summaryNode=el('mcDaySummary'); if(summaryNode) summaryNode.classList.toggle('hidden',state.view!=='day');
    if (state.view !== 'day') return;
    const start = weekStart(state.date), n = now(), days = [];
    for (let i=0;i<7;i++) {
      const date = addDays(start,i), d = parseYMD(date);
      const count = entry.rooms.reduce((sum, room) => sum + room.reservations.filter(rv => String(rv.start_time).slice(0,10)===date).length, 0);
      days.push({ date, label: ['S','M','T','W','T','F','S'][d.getDay()], day:d.getDate(), count });
    }
    if (window.MCDayStrip) window.MCDayStrip.render(strip, days, state.date, n && n.ymd, date => { state.date=date; refresh(); });
    const summary=el('mcDaySummary'), dateLabel=el('mcDaySummaryDate'), countLabel=el('mcDaySummaryCount');
    if (summary) {
      summary.classList.remove('hidden');
      dateLabel.textContent=fmtFullDate(state.date);
      const dayRooms=entry.rooms.filter(room=>room.reservations.some(rv=>String(rv.start_time).slice(0,10)===state.date));
      const count=dayRooms.reduce((sum,room)=>sum+room.reservations.filter(rv=>String(rv.start_time).slice(0,10)===state.date).length,0);
      countLabel.textContent=count+' booking'+(count===1?'':'s');
      const drawer=el('mcDayDrawer'), list=el('mcDayDrawerList');
      if (list && !list.dataset.bound) { list.dataset.bound='1'; el('mcDaySummaryOpen').addEventListener('click',()=>drawer.classList.toggle('hidden')); el('mcDayDrawerClose').addEventListener('click',()=>drawer.classList.add('hidden')); }
      if (list) {
        const items=[];
        entry.rooms.forEach(room=>room.reservations.filter(rv=>String(rv.start_time).slice(0,10)===state.date).forEach(rv=>{
          const start=S.hhmm(rv.start_time), end=S.hhmm(rv.end_time);
          const title=READONLY ? (rv.purpose||'Reserved') : (rv.is_mine ? rv.purpose : 'Reserved');
          const detail=[room.name,S.fmt12(start)+' – '+S.fmt12(end),rv.status,READONLY?rv.requester_name:''].filter(Boolean).join(' · ');
          items.push('<div class="mc-day-drawer-item"><b>'+esc(title)+'</b><span>'+esc(detail)+'</span></div>');
        }));
        list.innerHTML=items.length?items.join(''):'<p class="text-sm text-gray-500 mt-3">No bookings for this day.</p>';
      }
    }
  }
  function fmtFullDate(date) { const d=parseYMD(date); return d.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}); }

  function drawMobileWeekOverview(entry, today) {
    const start=weekStart(state.date), cards=[];
    for(let i=0;i<7;i++) {
      const date=addDays(start,i), items=[];
      entry.rooms.forEach(room=>room.reservations.filter(rv=>String(rv.start_time).slice(0,10)===date).forEach(rv=>{
        const st=S.hhmm(rv.start_time), en=S.hhmm(rv.end_time);
        const title=READONLY?(rv.purpose||'Reserved'):(rv.is_mine?rv.purpose:'Reserved');
        const detail=[room.name,S.fmt12(st)+'–'+S.fmt12(en),rv.status,READONLY?rv.requester_name:''].filter(Boolean).join(' · ');
        items.push({title,detail,room:room.name,start:st,end:en});
      }));
      const shown=items.slice(0,3).map((it,j)=>'<div class="mc-mobile-booking"><b>'+esc(it.title)+'</b><span>'+esc(it.room+' · '+S.fmt12(it.start)+'–'+S.fmt12(it.end))+'</span></div>').join('');
      const more=items.length>3?'<button type="button" class="mc-mobile-more" data-mobile-date="'+date+'">+'+(items.length-3)+' more</button>':'';
      cards.push('<section class="mc-mobile-day'+(date===today?' is-today':'')+'"><header><b>'+esc(fmtFullDate(date))+'</b><span>'+items.length+' booking'+(items.length===1?'':'s')+'</span></header>'+(shown||'<p class="mc-mobile-empty">No bookings</p>')+more+'</section>');
    }
    gridEl.innerHTML='<div class="mc-mobile-week">'+cards.join('')+'</div>';
    gridEl.querySelectorAll('[data-mobile-date]').forEach(btn=>btn.addEventListener('click',()=>{
      const date=btn.dataset.mobileDate, roomItems=[];
      entry.rooms.forEach(room=>room.reservations.filter(rv=>String(rv.start_time).slice(0,10)===date).forEach(rv=>{
        const title=READONLY?(rv.purpose||'Reserved'):(rv.is_mine?rv.purpose:'Reserved');
        roomItems.push({title,detail:room.name+' · '+S.fmt12(S.hhmm(rv.start_time))+'–'+S.fmt12(S.hhmm(rv.end_time))+' · '+rv.status+(READONLY&&rv.requester_name?' · '+rv.requester_name:'')});
      }));
      if(window.MCPopover) window.MCPopover.open(btn,roomItems);
    }));
  }

  function draw() {
    if (G.dragging()) { setTimeout(draw, 250); return; }   // never swap the grid out from under a drag
    const cur = state.current;
    if (!cur) return;
    const { entry, matching } = cur;
    const n = now();
    const today = n ? n.ymd : '';
    const f = F.get();
    const total = state.allRooms.length;
    el('mcCount').textContent = total ? 'Showing ' + matching.length + ' of ' + total + ' room' + (total === 1 ? '' : 's') : '';
    dateInp.value = state.date;
    setTitle();
    renderDayStrip(entry);
    const dayModes = el('mcDayModes'); if (dayModes) dayModes.classList.toggle('hidden', state.view !== 'day');

    el('mcToday').disabled = !!today && ((state.view === 'day' && state.date === today) ||
      (state.view === 'week' && weekStart(state.date) === weekStart(today)) ||
      (state.view === 'month' && state.date.slice(0, 7) === today.slice(0, 7)));

    if (!matching.length) { drawEmpty(f, cur); return; }

    if (state.view === 'week' && !state.roomId && window.innerWidth < 768) {
      drawMobileWeekOverview(entry, today);
      return;
    }

    if (state.view === 'month') { drawMonth(entry, matching, today, n); return; }

    const byId = new Map(entry.rooms.map(r => [r.room_id, r]));
    let columns = [];
    if (state.view === 'day' && state.dayMode === 'rooms') {
      columns = matching.map(m => byId.get(m.room_id)).filter(Boolean).map(room => buildColumn(room, state.date, entry, {
        title: room.name, sub: room.capacity + ' seats · ' + (room.floor == null ? 'Floor —' : 'Floor ' + room.floor),
        badge: room.status === 'Maintenance' ? 'Maintenance' : '', today: false
      }));
    } else if (state.view === 'day') {
      columns = [buildOverviewColumn(state.date, entry, { title: WEEKDAYS[parseYMD(state.date).getDay()], sub: shortDate(state.date), today: state.date === today, badge: 'Timeline' })];
    } else {
      const start = weekStart(state.date);
      for (let i = 0; i < 7; i++) {
        const d = addDays(start, i), head = { title: WEEKDAYS[parseYMD(d).getDay()].slice(0, 3), sub: shortDate(d), today: d === today, badge: '' };
        if (!state.roomId) columns.push(buildOverviewColumn(d, entry, head));
        else { const room = byId.get(state.roomId); if (room) columns.push(buildColumn(room, d, entry, head)); }
      }
    }

    if (!columns.length) {
      gridEl.innerHTML = '<div class="mc-empty">No rooms to show.</div>';
      return;
    }

    const keep = gridEl.scrollTop;
    const grid = G.render(gridEl, {
      open: entry.rules.open, close: entry.rules.close, columns, guides: entry.rules.periods || [], staffReadonly: READONLY, readonly: READONLY || (state.view === 'week' && !state.roomId) || (state.view === 'day' && state.dayMode === 'timeline'),
      units: F.units(entry.rules),
      selection: state.sel ? { key: state.sel.roomId + '|' + state.sel.date, startMin: G.toMin(state.sel.start), endMin: G.toMin(state.sel.end) } : null,
      onPreview: s => { if (s) SG.clear(); M.set(s ? fromGrid(s) : state.sel); },
      onCommit: commitSel,
      onNotice: onGridNotice
    });
    checkSelection(entry);
    if (M && typeof M.touch === 'function') M.touch();
    if (state.scrollTo != null) { grid.scrollToMin(state.scrollTo); state.scrollTo = null; }
    else if (state.firstPaint) {
      state.firstPaint = false;
      const hasToday = columns.some(c => typeof c.nowMin === 'number');
      if (hasToday) grid.scrollToMin(n.min - 60);
    } else {
      gridEl.scrollTop = keep;
    }
  }

  // ---------- picked slot ----------
  const fromGrid = s => ({ roomId: s.meta.roomId, date: s.meta.date, start: G.hm(s.startMin), end: G.hm(s.endMin) });

  function commitSel(s) {
    if (READONLY) return;
    state.sel = s ? fromGrid(s) : null;
    if (EMBED && state.sel && !READONLY) {
      const p = state.sel;
      window.top.location.href = 'master-calendar.html?date=' + encodeURIComponent(p.date) + '&room=' + encodeURIComponent(p.roomId) + '&start=' + encodeURIComponent(p.start) + '&end=' + encodeURIComponent(p.end);
      return;
    }
    SG.clear();
    M.set(state.sel);
    paintSelBadge();
    if (state.sel && !READONLY) { panels.summary.set(true, { persist: false }); if (window.innerWidth < 1500) panels.filters.set(false, { persist: false }); }
    if (state.current) checkSelection(state.current.entry);
  }

  function paintSelBadge() {
    el('mcSummaryBtnBadge').classList.toggle('hidden', !state.sel);
  }

  /**
   * Is the picked slot still free according to the data on screen? (Data can age, or
   * another customer can book it.) Only judged when the loaded range covers it; the
   * server is still the authority on submit.
   */
  function checkSelection(entry) {
    const s = state.sel;
    if (!s || !entry || !entry.reqStart || s.date < entry.reqStart || s.date > entry.reqEnd) return;
    const room = entry.rooms.find(r => r.room_id === s.roomId);
    if (!room) return;
    let text = '';
    if (entry.holidays.some(h => String(h.holiday_date).slice(0, 10) === s.date)) text = 'That date is a holiday.';
    else if (S.isClosedDay(s.date, entry.rules.closedDays)) text = 'The campus is closed that day.';
    else if (room.status === 'Maintenance') text = 'This room is under maintenance.';
    else {
      const clash = S.findConflicts({ class_schedules: room.classes, reservations: room.reservations, holidays: entry.holidays }, s.date, s.start, s.end);
      if (clash.length) text = 'No longer free. ' + S.describe(clash, s.start, s.end);
    }
    M.setProblem(text);
    // Taken or no longer free: don't just say so — offer other times and rooms (Phase 4).
    if (text) SG.request(s, { origin: 'stale', reason: text });
    else SG.clear('stale');
  }

  // ---------- smart suggestions (Phase 4) ----------
  const fmtRange = (a, b) => S.fmt12(a) + ' – ' + S.fmt12(b);

  /** A drag / Shift+extend ran into an occupied period: say so gently and offer the other options. */
  function onGridNotice(text, wanted) {
    if (!wanted) { toast(text); return; }
    toast(text, { label: 'See other options', run: () => showOptionsFor(wanted) });
  }

  function showOptionsFor(w) {
    // Only while the shortened pick the drag left behind is still the current one.
    const c = state.sel;
    if (!c || c.roomId !== w.meta.roomId || c.date !== w.meta.date || c.start < w.start || c.end > w.end) return;
    panels.summary.set(true, { persist: false });
    SG.request({ roomId: w.meta.roomId, date: w.meta.date, start: w.start, end: w.end }, {
      origin: 'drag',
      reason: fmtRange(w.start, w.end) + ' runs into another booking or class in this room.'
    });
  }

  /** The customer chose a suggested room/time: move the pick there (nothing is submitted). */
  async function pickSuggestion(p) {
    SG.clear();
    state.sel = { roomId: p.roomId, date: p.date, start: p.start, end: p.end };
    M.set(state.sel);
    paintSelBadge();
    state.date = p.date;
    state.roomId = p.roomId;
    state.scrollTo = G.toMin(p.start);
    if (state.view === 'month') setView('day', { skipLoad: true });
    await refresh();
    const cur = state.current, room = state.allRooms.find(r => r.room_id === p.roomId);
    const shown = cur && (state.view === 'week' ? state.roomId === p.roomId : cur.matching.some(m => m.room_id === p.roomId));
    if (cur && !shown) toast((room ? room.name : 'That room') + ' is hidden by your filters. Your pick is in the booking summary.');
  }

  let toastTimer = 0;
  function toast(text, action) {
    toastEl.textContent = '';
    const msg = document.createElement('span');
    msg.textContent = text;
    toastEl.appendChild(msg);
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mc-toast-act';
      b.textContent = action.label;
      b.addEventListener('click', () => { toastEl.hidden = true; action.run(); });
      toastEl.appendChild(b);
    }
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, action ? 9000 : 4000);
  }

  function setTitle() {
    if (state.view === 'day') {
      titleEl.textContent = WEEKDAYS[parseYMD(state.date).getDay()] + ', ' + shortDate(state.date) + ', ' + state.date.slice(0, 4);
    } else if (state.view === 'week') {
      const start = weekStart(state.date);
      const a = parseYMD(start), b = parseYMD(addDays(start, 6));
      titleEl.textContent = shortDate(start) + ' – ' + (a.getMonth() === b.getMonth() ? b.getDate() : shortDate(addDays(start, 6))) + ', ' + b.getFullYear();
    } else {
      const d = parseYMD(state.date);
      titleEl.textContent = MONTH_FULL[d.getMonth()] + ' ' + d.getFullYear();
    }
  }

  function drawMonth(entry, matching, today, n) {
    const r = monthRange(state.date);
    const byId = new Map(entry.rooms.map(x => [x.room_id, x]));
    const rows = matching.map(m => byId.get(m.room_id)).filter(Boolean);
    const month = state.date.slice(0, 7);
    const cells = [];
    for (let d = r.start; d <= r.end; d = addDays(d, 1)) {
      let kind = 'open', label = '', free = 0, tot = 0;
      rows.forEach(room => {
        const inf = F.dayInfo(room, d, entry, entry.rules, n);
        if (inf.state === 'holiday' || inf.state === 'closed') { kind = inf.state; label = inf.label; return; }
        tot++;
        if (inf.free > 0) free++;
      });
      const past = !!today && d < today;
      if (kind === 'open' && past) { kind = 'past'; label = 'Past'; }
      const when = shortDate(d);
      const tip = kind === 'holiday' ? when + ' · Holiday — ' + label
        : kind === 'closed' ? when + ' · Campus closed'
        : kind === 'past' ? when + ' · Past'
        : when + ' · ' + free + ' of ' + tot + ' room' + (tot === 1 ? '' : 's') + ' with a free period';
      cells.push({ date: d, day: parseYMD(d).getDate(), inMonth: d.slice(0, 7) === month, today: d === today, past,
        kind, label, free, total: tot, tip });
    }
    const keep = gridEl.scrollTop;
    G.renderMonth(gridEl, { weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], cells });
    gridEl.scrollTop = keep;
  }

  function drawEmpty(f, cur) {
    const ctx = mkCtx(cur.index);
    const keys = F.activeKeys(f, ctx.now);
    if (!keys.length) { gridEl.innerHTML = '<div class="mc-empty">No rooms to show.</div>'; return; }
    const hints = F.relaxHints(state.allRooms, f, ctx);
    gridEl.innerHTML = '<div class="mc-empty"><h3>No rooms match your filters</h3>' +
      '<p>' + (hints.length ? 'Try relaxing one of these:' : 'Try clearing your filters.') + '</p><div>' +
      hints.map(h => '<button type="button" class="mc-relax" data-relax="' + esc(h.key) + '">Remove “' + esc(h.label) +
        '” <span class="text-gray-400 ml-1">+' + h.gain + '</span></button>').join('') +
      '<button type="button" class="mc-relax" data-relax="__all">Clear all filters</button></div></div>';
  }

  // ---------- toolbar ----------
  function fillRoomSelect(list) {
    if (!list.length) { roomSel.innerHTML = ''; return; }
    if (state.roomId && !list.some(r => r.room_id === state.roomId)) state.roomId = '';
    roomSel.innerHTML = '<option value=""' + (!state.roomId ? ' selected' : '') + '>All rooms (overview)</option>' + list.map(r =>
      '<option value="' + esc(r.room_id) + '"' + (r.room_id === state.roomId ? ' selected' : '') + '>' +
      esc(r.name) + ' (' + esc(r.capacity) + ' seats)</option>').join('');
  }

  function setView(view, opts) {
    state.view = view;
    ['Day', 'Week', 'Month'].forEach(v => el('mcView' + v).classList.toggle('is-active', view === v.toLowerCase()));
    roomSel.parentElement.classList.toggle('hidden', view !== 'week');
    el('mcLegendMonth').classList.toggle('hidden', view !== 'month');
    document.querySelector('.mc-legend[aria-label="Legend"]').classList.toggle('hidden', view === 'month');
    if (!(opts && opts.skipLoad)) refresh();
  }

  function step(dir) {
    if (state.view === 'month') {
      const d = parseYMD(state.date), day = d.getDate();
      d.setDate(1); d.setMonth(d.getMonth() + dir);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, last));
      state.date = ymd(d);
    } else {
      state.date = addDays(state.date, (state.view === 'week' ? 7 : 1) * dir);
    }
    refresh();
  }

  el('mcPrev').addEventListener('click', () => step(-1));
  el('mcNext').addEventListener('click', () => step(1));
  el('mcToday').addEventListener('click', () => { const n = now(); if (n) { state.date = n.ymd; refresh(); } });
  el('mcViewDay').addEventListener('click', () => setView('day'));
  el('mcViewWeek').addEventListener('click', () => setView('week'));
  el('mcViewMonth').addEventListener('click', () => setView('month'));
  const dayModes = el('mcDayModes');
  if (dayModes) dayModes.addEventListener('click', e => { const b=e.target.closest('[data-day-mode]'); if (!b) return; state.dayMode=b.dataset.dayMode; dayModes.querySelectorAll('[data-day-mode]').forEach(x=>x.classList.toggle('is-active',x===b)); draw(); });
  const showClasses = el('mcShowClasses');
  if (showClasses) showClasses.addEventListener('change', () => { state.showClasses=showClasses.checked; draw(); });
  roomSel.addEventListener('change', () => { state.roomId = roomSel.value; refresh(); });
  dateInp.addEventListener('change', () => { if (/^\d{4}-\d{2}-\d{2}$/.test(dateInp.value)) { state.date = dateInp.value; refresh(); } });

  // Month cell -> that day; empty-state "relax" buttons.
  gridEl.addEventListener('click', e => {
    const cell = e.target.closest('.mc-mcell[data-date]');
    if (cell) { tipEl.hidden = true; state.date = cell.getAttribute('data-date'); setView('day'); return; }
    const relax = e.target.closest('[data-relax]');
    if (relax) { const k = relax.getAttribute('data-relax'); if (k === '__all') F.clear(); else F.remove(k); }
  });

  // Filters changed (panel or chip). Picking a free-time window jumps to that day.
  function onFilters(f, reason) {
    if (reason === 'window') {
      const w = F.windowState(f, now());
      if (w.valid) {
        state.date = w.date;
        if (state.view === 'month') { setView('day'); return; }
      }
    }
    refresh();
  }

  // ---------- collapsible side panels (filters on the left, booking summary on the right) ----------
  const mobile = () => window.matchMedia('(max-width: 767px)').matches;
  const panels = {};

  function makePanel(cfg) {
    const layout = el('mcLayout'), panel = el(cfg.panel), btn = el(cfg.btn), back = el('mcBackdrop');
    let saved = null;
    try { saved = localStorage.getItem(cfg.key); } catch (e) { /* storage blocked: default below */ }
    let open = mobile() ? false : saved == null ? cfg.defaultOpen() : saved === '1';

    function paint() {
      layout.setAttribute(cfg.attr, open ? 'open' : 'closed');
      panel.inert = !open;
      panel.setAttribute('aria-hidden', open ? 'false' : 'true');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      back.hidden = !(mobile() && (panels.filters && panels.filters.isOpen() || panels.summary && panels.summary.isOpen()));
    }
    // persist:false = the page opened/closed it for the user (a slot was picked), so do not remember it.
    function set(v, o) {
      open = v;
      paint();
      if (!(o && o.persist === false) && !mobile()) { try { localStorage.setItem(cfg.key, v ? '1' : '0'); } catch (e) { /* ignore */ } }
    }
    btn.addEventListener('click', () => set(!open));
    el(cfg.close).addEventListener('click', () => set(false));
    document.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target, typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      if (e.key === cfg.hotkey && !typing) { e.preventDefault(); set(!open); }
      else if (e.key === 'Escape' && open && mobile()) set(false);
    });
    window.matchMedia('(max-width: 767px)').addEventListener('change', paint);
    panels[cfg.name] = { set, isOpen: () => open, paint };
    paint();
  }

  function setupPanels() {
    makePanel({
      name: 'filters', attr: 'data-filters', panel: 'mcFilters', btn: 'mcFiltersBtn', close: 'mcFiltersClose',
      key: 'mc.filters.open', hotkey: '[', defaultOpen: () => !window.matchMedia('(max-width: 1099px)').matches
    });
    // Closed by default unless the screen is wide; picking a slot opens it.
    makePanel({
      name: 'summary', attr: 'data-summary', panel: 'mcSummary', btn: 'mcSummaryBtn', close: 'mcSummaryClose',
      key: 'mc.summary.open', hotkey: ']', defaultOpen: () => window.innerWidth >= 1500
    });
    el('mcBackdrop').addEventListener('click', () => { panels.filters.set(false); panels.summary.set(false); });
    panels.filters.paint(); panels.summary.paint();
  }

  // ---------- tooltip (hover + keyboard focus) ----------
  function showTip(target, x, y) {
    tipEl.textContent = target.getAttribute('data-tip');
    tipEl.hidden = false;
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    tipEl.style.left = Math.min(x + 14, window.innerWidth - w - 8) + 'px';
    tipEl.style.top = (y + 18 + h > window.innerHeight ? y - h - 10 : y + 18) + 'px';
  }
  gridEl.addEventListener('mouseover', e => { const t = e.target.closest('[data-tip]'); if (t) showTip(t, e.clientX, e.clientY); });
  gridEl.addEventListener('mousemove', e => { const t = e.target.closest('[data-tip]'); if (t) showTip(t, e.clientX, e.clientY); else tipEl.hidden = true; });
  gridEl.addEventListener('mouseleave', () => { tipEl.hidden = true; });
  gridEl.addEventListener('scroll', () => { tipEl.hidden = true; });
  gridEl.addEventListener('focusin', e => { const t = e.target.closest('[data-tip]'); if (t) { const r = t.getBoundingClientRect(); showTip(t, r.left, r.top); } });
  gridEl.addEventListener('focusout', () => { tipEl.hidden = true; });

  // ---------- errors ----------
  function showError(msg) {
    errEl.textContent = '';
    const t = document.createElement('span');
    t.textContent = msg + ' ';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'underline font-semibold';
    b.textContent = 'Try again';
    // Before the first load there is no date to refresh: start over.
    b.addEventListener('click', () => { if (state.date) { cache.clear(); refresh(); } else window.location.reload(); });
    errEl.append(t, b);
    errEl.classList.remove('hidden');
  }
  function hideError() { errEl.classList.add('hidden'); }

  // ---------- boot ----------
  async function init() {
    setupPanels();
    F.init({ onChange: onFilters, getNow: now });
    M.init({
      base: BASE,
      getRoom: id => state.allRooms.find(r => r.room_id === id),
      getNow: now,
      validateSeries: (slot, date) => {
        const entry = state.current && state.current.entry;
        const room = entry && entry.rooms.find(x => x.room_id === slot.roomId);
        if (!entry || !room || date < entry.reqStart || date > entry.reqEnd) return 'Date is outside the loaded calendar range';
        if (entry.holidays.some(h => String(h.holiday_date).slice(0,10) === date)) return 'Holiday';
        if (S.isClosedDay(date, entry.rules.closedDays)) return 'Closed day';
        if (room.status === 'Maintenance') return 'Room under maintenance';
        const dow=S.dayName(date), start=G.toMin(slot.start), end=G.toMin(slot.end);
        if (room.classes.some(c=>c.day_of_week===dow && G.toMin(c.start_time)<end && G.toMin(c.end_time)>start)) return 'Class conflict';
        if (room.reservations.some(rv=>String(rv.start_time).slice(0,10)===date && G.toMin(S.hhmm(rv.start_time))<end && G.toMin(S.hhmm(rv.end_time))>start)) return 'Reserved';
        const n=now(); if(n && (date<n.ymd || (date===n.ymd && start<=n.min))) return 'Past';
        return '';
      },
      onClear: () => { state.sel = null; SG.clear(); M.set(null); paintSelBadge(); draw(); },
      onGoto: s => {
        state.date = s.date; state.roomId = s.roomId; state.scrollTo = G.toMin(s.start);
        if (state.view === 'month') setView('day'); else refresh();
      },
      onConflict: (json, text) => {
        if (state.sel) SG.request(state.sel, { origin: 'conflict', reason: text });
        cache.clear(); refresh();
      },
      onBooked: () => { cache.clear(); }
    });
    SG.init({ containerId: 'mcSumSuggest', base: BASE, getNow: now, getSeats: () => F.get().seats, onPick: pickSuggestion });
    try {
      // No dates: the server answers for "today", tells us what time it is, and lists every active room.
      const first = await fetchMaster({});
      const n = now();
      state.date = /^\d{4}-\d{2}-\d{2}$/.test(query.get('date') || '') ? query.get('date') : n.ymd;
      state.rules = first.rules;
      first.reqStart = first.reqEnd = n.ymd;
      cache.set(n.ymd + '|' + n.ymd + '|', first);
      noteRooms(first);
      F.setRules(first.rules);
      const linkedRoom = query.get('room');
      if (linkedRoom && state.allRooms.some(r => r.room_id === linkedRoom)) state.roomId = linkedRoom;
      const linkedStart = query.get('start'), linkedEnd = query.get('end');
      if (linkedRoom && linkedStart && linkedEnd && /^\d{2}:\d{2}$/.test(linkedStart) && /^\d{2}:\d{2}$/.test(linkedEnd)) {
        state.sel = { roomId: linkedRoom, date: state.date, start: linkedStart, end: linkedEnd };
        M.set(state.sel);
      }
      const requestedView = query.get('view');
      setView(['day','week','month'].includes(requestedView) ? requestedView : (EMBED ? 'week' : 'day'));
    } catch (e) {
      gridEl.classList.remove('mc-loading');
      showError(e.message);
    }
    // Resize re-lays out cached data only; preserve time-at-top and selection.
    if ('ResizeObserver' in window) {
      let resizeTimer = null;
      let lastWidth = gridEl.clientWidth, lastHeight = gridEl.clientHeight;
      new ResizeObserver(() => {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (!state.current || G.dragging() || (gridEl.clientWidth === lastWidth && gridEl.clientHeight === lastHeight)) return;
          const oldScale = G.scale();
          const topMinute = state.current.entry ? G.toMin(state.current.entry.rules.open) + gridEl.scrollTop / oldScale : null;
          lastWidth = gridEl.clientWidth; lastHeight = gridEl.clientHeight;
          draw();
          if (topMinute != null) gridEl.scrollTop = Math.max(0, (topMinute - G.toMin(state.current.entry.rules.open)) * G.scale());
        }, 100);
      }).observe(gridEl);
    }
    // Move the "now" line each minute; re-check "Available Now" against fresh data when that chip is on.
    setInterval(() => { if (!state.current || G.dragging()) return; if (F.get().now) refresh(); else draw(); M.touch(); }, 60 * 1000);
  }

  init();
})();
