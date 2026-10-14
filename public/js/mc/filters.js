/**
 * CampusRoom — Master Calendar filters (Phase 2).
 *
 * One filter object drives BOTH the left panel and the shortcut chips, so they
 * can never disagree. Everything is client-side over data the page already has
 * (room list + the master-calendar response); nothing here touches booking.
 *
 * Pure helpers (availability, matching) are exported next to the UI so Month
 * view and the "Available Now" chip share one definition of "free":
 *   - a time unit is a class period (rules.periods) clipped to business hours,
 *     or a half-hour if no periods are configured;
 *   - a unit is free when no class and no Pending/Approved reservation overlaps
 *     it (same rule as schedule.js: start < other.end && end > other.start)
 *     and, for today, it starts after "now" (the server requires a future start).
 *
 * Filter keys: seats | types | floors | window | now
 *
 * Room type and Floor each have a search box + "select all matching". The search text is
 * view-only state (it narrows which checkboxes are listed, never what is filtered); only the
 * ticked boxes live in the filter object. A multi-word search needs every word to match, so
 * "comp lab" finds "Computer Lab".
 */
(function () {
  'use strict';

  const S = window.CampusSchedule;
  const esc = v => window.CampusRoomUtil.escapeHtml(v);
  const toMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const TIGHT_FACTOR = 1.5;

  // ---------- state ----------
  const blank = () => ({ seats: '', tight: false, types: [], floors: [], winDate: '', winFrom: '', winTo: '', now: false });
  let f = blank();
  let rooms = [];            // every active room (static fields)
  let rules = null;          // latest rules from the server
  let onChange = () => {};
  let getNow = () => null;
  let optionSig = '';
  let optLabels = { types: new Map(), floors: new Map() };   // key -> label, for the section summaries
  let openSec = null;        // accordion: key of the one open section (null = all closed)
  let secChosen = false;     // true once the user (or the rail) picked a section: stop auto-choosing
  let ui = null;
  const query = { types: '', floors: '' };      // search text per list (not part of the filter)
  const FLOOR_SEARCH_MIN = 7;                    // the Floor search box appears once there are this many floors
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---------- pure helpers ----------
  const typeKey = t => String(t == null ? '' : t).trim().toLowerCase();
  const floorKey = x => (x == null || x === '' ? '' : String(x));

  /** [[startMin, endMin], ...] occupying `room` on `date` (classes + Pending/Approved reservations). */
  function busy(room, date) {
    const dow = S.dayName(date), out = [];
    (room.classes || []).forEach(c => {
      if (c.day_of_week === dow) out.push([toMin(c.start_time), toMin(c.end_time)]);
    });
    (room.reservations || []).forEach(r => {
      if (String(r.start_time).slice(0, 10) === date) out.push([toMin(S.hhmm(r.start_time)), toMin(S.hhmm(r.end_time))]);
    });
    return out;
  }

  /** Whole-day state for one room: open | holiday | closed | maint. */
  function dayState(room, date, entry, r) {
    const hol = (entry.holidays || []).find(h => String(h.holiday_date).slice(0, 10) === date);
    if (hol) return { state: 'holiday', label: hol.name };
    if (S.isClosedDay(date, r.closedDays)) return { state: 'closed', label: 'Closed' };
    if (room.status === 'Maintenance') return { state: 'maint', label: 'Under maintenance' };
    return { state: 'open', label: '' };
  }

  /** Half-hour booking units; class periods remain visual guides, not booking units. */
  function units(r) {
    const o = toMin(r.open), c = toMin(r.close), out = [];
    for (let m = Math.ceil(o / 30) * 30; m + 30 <= c; m += 30) out.push([m, m + 30]);
    return out;
  }

  const overlaps = (list, s, e) => list.some(x => x[0] < e && x[1] > s);

  /** { state, label, free, total } — how many bookable units are left that day. */
  function dayInfo(room, date, entry, r, now) {
    const st = dayState(room, date, entry, r);
    if (st.state !== 'open') return { state: st.state, label: st.label, free: 0, total: 0 };
    const us = units(r), b = busy(room, date);
    let free = 0;
    if (!now || date >= now.ymd) {
      us.forEach(u => {
        if (now && date === now.ymd && u[0] <= now.min) return;   // already started
        if (!overlaps(b, u[0], u[1])) free++;
      });
    }
    return { state: 'open', label: '', free, total: us.length };
  }

  /**
   * "Fully booked" = an open day with bookable units but none left (for today: none still ahead of
   * "now"). Past days, closed/holiday days and rooms under maintenance are never called fully booked,
   * so the "Hide fully booked" toggle can't blank out a whole calendar by accident.
   */
  function isFullyBooked(room, date, entry, r, now) {
    if (now && date < now.ymd) return false;
    const inf = dayInfo(room, date, entry, r, now);
    return inf.state === 'open' && inf.total > 0 && inf.free === 0;
  }

  function isFreeNow(room, entry, r, now) {
    if (room.status !== 'Available') return false;
    if (dayState(room, now.ymd, entry, r).state !== 'open') return false;
    if (now.min < toMin(r.open) || now.min >= toMin(r.close)) return false;
    return !busy(room, now.ymd).some(x => x[0] <= now.min && now.min < x[1]);
  }

  /** Reads the "free during" inputs. valid ⇒ apply it; problem ⇒ text for the panel. */
  function windowState(fl, now) {
    const any = !!(fl.winDate || fl.winFrom || fl.winTo);
    if (!any) return { any: false, valid: false, problem: '' };
    if (!fl.winDate || !fl.winFrom || !fl.winTo) return { any, valid: false, problem: 'Pick a date and both times.' };
    if (fl.winTo <= fl.winFrom) return { any, valid: false, problem: 'The end time must be after the start time.' };
    if (now && (fl.winDate < now.ymd || (fl.winDate === now.ymd && toMin(fl.winFrom) <= now.min))) {
      return { any, valid: false, problem: 'That time has already started — pick a later one.' };
    }
    return { any, valid: true, problem: '', date: fl.winDate, start: toMin(fl.winFrom), end: toMin(fl.winTo) };
  }

  function isFreeWindow(room, entry, r, w) {
    if (dayState(room, w.date, entry, r).state !== 'open') return false;
    if (w.start < toMin(r.open) || w.end > toMin(r.close)) return false;
    return !overlaps(busy(room, w.date), w.start, w.end);
  }

  /**
   * ctx = { now:{ymd,min}|null, rules, index:{ [date]: { entry, rooms: Map(room_id → room) } } }
   * `skip` ignores one filter key (used to count what relaxing it would give back).
   */
  function matches(room, fl, ctx, skip) {
    if (skip !== 'seats' && fl.seats !== '') {
      const n = Number(fl.seats);
      if (!(room.capacity >= n)) return false;
      if (fl.tight && room.capacity > n * TIGHT_FACTOR) return false;
    }
    if (skip !== 'types' && fl.types.length && !fl.types.includes(typeKey(room.room_type))) return false;
    if (skip !== 'floors' && fl.floors.length && !fl.floors.includes(floorKey(room.floor))) return false;
    if (skip !== 'now' && fl.now && ctx.now) {
      const slot = ctx.index[ctx.now.ymd], live = slot && slot.rooms.get(room.room_id);
      if (!live || !isFreeNow(live, slot.entry, ctx.rules, ctx.now)) return false;
    }
    if (skip !== 'window') {
      const w = windowState(fl, ctx.now);
      if (w.valid) {
        const slot = ctx.index[w.date], live = slot && slot.rooms.get(room.room_id);
        if (!live || !isFreeWindow(live, slot.entry, ctx.rules, w)) return false;
      }
    }
    return true;
  }

  /** Matching rooms; closest fit first when a seat count is set (D7), otherwise input order (by name). */
  function apply(list, fl, ctx, skip) {
    const out = list.filter(r => matches(r, fl, ctx, skip));
    if (fl.seats !== '' && skip !== 'seats') {
      out.sort((a, b) => (a.capacity - b.capacity) || String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
    }
    return out;
  }

  function activeKeys(fl, now) {
    const k = [];
    if (fl.seats !== '') k.push('seats');
    if (fl.types.length) k.push('types');
    if (fl.floors.length) k.push('floors');
    if (windowState(fl, now).valid) k.push('window');
    if (fl.now) k.push('now');
    return k;
  }

  const KEY_LABEL = {
    seats: fl => fl.tight ? 'Seats ' + fl.seats + '–' + Math.floor(Number(fl.seats) * TIGHT_FACTOR) : 'Seats ≥ ' + fl.seats,
    types: () => 'Room type',
    floors: () => 'Floor',
    window: () => 'Free-time window',
    now: () => 'Available Now'
  };

  /** [{ key, label, gain }] — filters that, if removed, would bring rooms back. */
  function relaxHints(list, fl, ctx) {
    const base = apply(list, fl, ctx).length;
    return activeKeys(fl, ctx.now)
      .map(key => ({ key, label: KEY_LABEL[key](fl), gain: apply(list, fl, ctx, key).length - base }))
      .filter(h => h.gain > 0);
  }

  // ---------- shortcut chips (data-driven: add one = add one object) ----------
  const labKeys = list => [...new Set(list.map(r => typeKey(r.room_type)).filter(k => k.includes('lab')))];
  const CHIPS = [
    {
      id: 'now', label: 'Available Now', icon: 'bolt',
      active: fl => fl.now,
      toggle: fl => { fl.now = !fl.now; }
    },
    {
      id: 'labs', label: 'Labs', icon: 'science',
      enabled: list => labKeys(list).length > 0,
      active: (fl, list) => {
        const k = labKeys(list);
        return k.length > 0 && fl.types.length === k.length && k.every(x => fl.types.includes(x));
      },
      toggle: (fl, list) => { fl.types = CHIPS[1].active(fl, list) ? [] : labKeys(list); }
    },
    {
      id: 'big', label: 'More than 40 Seats', icon: 'groups',
      active: fl => Number(fl.seats) === 41 && !fl.tight,
      toggle: fl => { if (CHIPS[2].active(fl)) fl.seats = ''; else { fl.seats = 41; fl.tight = false; } }
    }
  ];

  // ---------- option lists (types / floors) ----------
  function buildOptions(list) {
    const types = new Map(), floors = new Map();
    list.forEach(r => {
      const tk = typeKey(r.room_type), shown = String(r.room_type == null ? '' : r.room_type).trim();
      const t = types.get(tk) || { key: tk, spellings: new Map(), count: 0 };
      t.count++; if (shown) t.spellings.set(shown, (t.spellings.get(shown) || 0) + 1);
      types.set(tk, t);
      const fk = floorKey(r.floor);
      const fo = floors.get(fk) || { key: fk, count: 0 };
      fo.count++; floors.set(fk, fo);
    });
    const typeList = [...types.values()].map(t => ({
      key: t.key, count: t.count,
      label: t.key === '' ? 'Unspecified' : [...t.spellings.entries()].sort((a, b) => b[1] - a[1])[0][0]
    })).sort((a, b) => (a.key === '') - (b.key === '') || a.label.localeCompare(b.label));
    const floorList = [...floors.values()].map(x => ({
      key: x.key, count: x.count, label: x.key === '' ? 'Unspecified' : 'Floor ' + x.key
    })).sort((a, b) => (a.key === '') - (b.key === '') || Number(a.key) - Number(b.key));
    return { types: typeList, floors: floorList };
  }

  const optionHtml = (kind, o, checked) =>
    '<label class="mc-opt' + (kind === 'type' && window.MCRoomColor ? ' ' + window.MCRoomColor.cls(o.key) : '') + '"><input type="checkbox" data-' + kind + '="' + esc(o.key) + '"' + (checked ? ' checked' : '') + '>' +
    (kind === 'type' ? '<i class="mc-rt-dot" aria-hidden="true"></i>' : '') +
    '<span>' + esc(o.label) + '</span><em>' + o.count + '</em></label>';

  // ---------- UI ----------
  const $ = id => document.getElementById(id);

  function fire(reason) { sync(); onChange(get(), reason); }

  function sync() {
    if (!ui) return;
    const now = getNow();
    if (document.activeElement !== ui.seats) ui.seats.value = f.seats === '' ? '' : String(f.seats);
    ui.tight.checked = f.tight && f.seats !== '';
    ui.tight.disabled = f.seats === '';
    ui.tightWrap.hidden = f.seats === '';      // only offered once a seat count is set
    ui.types.querySelectorAll('input').forEach(i => { i.checked = f.types.includes(i.getAttribute('data-type')); });
    ui.floors.querySelectorAll('input').forEach(i => { i.checked = f.floors.includes(i.getAttribute('data-floor')); });
    ui.winDate.value = f.winDate; ui.winFrom.value = f.winFrom; ui.winTo.value = f.winTo;
    if (now) ui.winDate.min = now.ymd;

    const w = windowState(f, now);
    let hint = w.problem;
    if (w.valid && rules) {
      if (w.start < toMin(rules.open) || w.end > toMin(rules.close)) {
        hint = 'Outside business hours (' + S.fmt12(rules.open) + ' – ' + S.fmt12(rules.close) + ') — no room can be booked then.';
      } else if (S.isClosedDay(w.date, rules.closedDays)) {
        hint = 'The campus is closed on ' + S.dayName(w.date) + 's.';
      }
    }
    ui.winHint.textContent = hint;
    ui.winHint.classList.toggle('hidden', !hint);

    const n = activeKeys(f, now).length;
    [ui.badge, ui.btnBadge].forEach(b => { b.textContent = String(n); b.classList.toggle('hidden', n === 0); });
    ui.clear.disabled = n === 0 && !w.any;
    paintSections(w);
    paintLists();

    ui.chips.querySelectorAll('button[data-chip]').forEach(btn => {
      const c = CHIPS.find(x => x.id === btn.getAttribute('data-chip'));
      const on = !!c.active(f, rooms), enabled = c.enabled ? c.enabled(rooms) : true;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.disabled = !enabled;
      btn.title = enabled ? c.label : 'No rooms of this kind in the system';
    });
  }

  // ---------- accordion ----------
  const pickedLabels = (kind, keys) => keys.map(k => optLabels[kind].get(k) || (kind === 'floors' ? 'Floor ' + k : k));
  const summarize = list => list.length <= 1 ? (list[0] || '') : list[0] + ' +' + (list.length - 1);
  const shortDate = d => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(d || ''); return m ? MONTHS[+m[1] - 1] + ' ' + (+m[2]) : ''; };

  /** Section header value + "has a selection" state + per-section Clear links. */
  function paintSections(w) {
    const sums = {
      seats: f.seats === '' ? '' : '≥ ' + f.seats + (f.tight ? ' · no oversized rooms' : ''),
      types: summarize(pickedLabels('types', f.types)),
      floors: summarize(pickedLabels('floors', f.floors)),
      window: !w.any ? '' : (w.valid || (f.winDate && f.winFrom && f.winTo))
        ? shortDate(f.winDate) + ' · ' + S.fmt12(f.winFrom) + '–' + S.fmt12(f.winTo)
        : 'Incomplete'
    };
    const empty = { seats: 'Any', types: 'Any', floors: 'Any', window: 'Any time' };
    ui.accs.forEach(acc => {
      const key = acc.getAttribute('data-sec'), has = sums[key] !== '';
      acc.classList.toggle('has-value', has);
      acc.classList.toggle('is-warn', key === 'window' && (!!w.problem || sums.window === 'Incomplete'));
      acc.querySelector('[data-sum]').textContent = has ? sums[key] : empty[key];
      const clr = acc.querySelector('[data-clear]'); if (clr) clr.hidden = !has;
    });
  }

  function paintAccordion() {
    ui.accs.forEach(acc => {
      const key = acc.getAttribute('data-sec'), on = key === openSec;
      acc.classList.toggle('is-open', on);
      acc.querySelector('.mc-acc-btn').setAttribute('aria-expanded', on ? 'true' : 'false');
      acc.querySelector('.mc-acc-body').hidden = !on;
    });
    ui.lists.forEach(paintScrollCue);
  }

  /** Open one section (closing the rest); toggling the open one closes it. */
  function setOpen(key, on) {
    secChosen = true;
    openSec = on === false ? (openSec === key ? null : openSec) : key;
    paintAccordion();
  }

  /** Opened from outside (the collapsed rail's icons): focus the section's first control. */
  function openSection(key) {
    setOpen(key, true);
    const acc = ui && ui.accs.find(a => a.getAttribute('data-sec') === key);
    const t = acc && acc.querySelector('.mc-acc-body input:not([disabled])');
    if (t) t.focus({ preventScroll: true });
  }

  /** Framed + scrollbar + fade only when the list really overflows; plain when it fits. */
  function paintScrollCue(list) {
    const wrap = list.parentElement, can = list.scrollHeight > list.clientHeight + 1;
    wrap.classList.toggle('is-scrollable', can);
    wrap.classList.toggle('is-end', !can || list.scrollTop + list.clientHeight >= list.scrollHeight - 2);
    if (can) list.setAttribute('tabindex', '0'); else list.removeAttribute('tabindex');   // keyboard users can scroll it
  }

  /** First open: the section that already has a selection, otherwise Room type (the most used). */
  function chooseDefaultSection() {
    if (secChosen || !ui) return;
    const w = windowState(f, getNow());
    const has = { seats: f.seats !== '', types: f.types.length > 0, floors: f.floors.length > 0, window: w.any };
    openSec = ['seats', 'types', 'floors', 'window'].find(k => has[k]) || 'types';
    paintAccordion();
  }

  // ---------- search + select-all-matching (Room type / Floor) ----------
  const LISTS = {
    types:  { attr: 'type',  noun: 'room types', one: 'room type', optKey: 'types' },
    floors: { attr: 'floor', noun: 'floors',     one: 'floor',     optKey: 'floors' }
  };

  /** Every typed word must appear in the option's label (or key): "comp lab" → "Computer Lab". */
  function textMatches(label, key, q) {
    const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const hay = (String(label) + ' ' + String(key)).toLowerCase();
    return words.every(w => hay.includes(w));
  }

  /** Option keys of one list that the current search text keeps visible, in list order. */
  function visibleKeys(kind) {
    return [...optLabels[LISTS[kind].optKey].entries()]
      .filter(([k, label]) => textMatches(label, k, query[kind]))
      .map(([k]) => k);
  }

  function paintList(kind) {
    const L = LISTS[kind], el = ui[kind + 'S'];
    if (!el) return;
    const q = query[kind].trim(), total = optLabels[L.optKey].size;
    const shown = new Set(visibleKeys(kind));
    const picked = f[kind];

    // Floors: only worth a search box when the list is long (or while a search is active).
    el.wrap.hidden = kind === 'floors' && total < FLOOR_SEARCH_MIN && !q;

    el.list.querySelectorAll('input[data-' + L.attr + ']').forEach(i => {
      i.closest('label').hidden = !shown.has(i.getAttribute('data-' + L.attr));
    });
    el.clearBtn.hidden = !query[kind];

    const m = shown.size;
    el.count.textContent = !total ? '' : q ? m + ' of ' + total + ' match' : total + ' ' + (total === 1 ? L.one : L.noun);

    const allOn = m > 0 && [...shown].every(k => picked.includes(k));
    el.all.textContent = (allOn ? 'Deselect ' : 'Select ') + (q ? 'matching' : 'all');
    el.all.disabled = m === 0;
    el.all.setAttribute('aria-label', (allOn ? 'Deselect ' : 'Select ') + (q ? m + ' matching ' : 'all ') + L.noun);

    const none = !!total && m === 0;
    el.none.hidden = !none;
    if (none) el.none.innerHTML = 'No ' + L.noun + ' match “' + esc(q) + '”. <button type="button" data-clear-search="' + kind + '">Clear search</button>';
    paintScrollCue(el.list);
  }

  function paintLists() { if (ui && ui.typesS) { paintList('types'); paintList('floors'); } }

  function setQuery(kind, v) {
    query[kind] = v;
    if (ui[kind + 'S'].input.value !== v) ui[kind + 'S'].input.value = v;
    paintList(kind);
    ui[kind + 'S'].list.scrollTop = 0;
  }

  /** Tick every visible option, or — if they are all ticked already — untick them. */
  function toggleMatching(kind) {
    const keys = visibleKeys(kind);
    if (!keys.length) return;
    const allOn = keys.every(k => f[kind].includes(k));
    const set = new Set(f[kind]);
    keys.forEach(k => { if (allOn) set.delete(k); else set.add(k); });
    f[kind] = [...set];
    fire(kind);
  }

  function bindSearch(kind, Kind) {
    const S = ui[kind + 'S'] = {
      wrap: $('mc' + Kind + 'SearchWrap'), input: $('mc' + Kind + 'Search'), clearBtn: $('mc' + Kind + 'SearchX'),
      count: $('mc' + Kind + 'Count'), all: $('mc' + Kind + 'All'), none: $('mc' + Kind + 'None'), list: ui[kind]
    };
    S.input.addEventListener('input', () => setQuery(kind, S.input.value));
    S.input.addEventListener('keydown', e => {
      if (e.key === 'Escape' && S.input.value) { e.preventDefault(); e.stopPropagation(); setQuery(kind, ''); }
      else if (e.key === 'Enter') e.preventDefault();
    });
    S.clearBtn.addEventListener('click', () => { setQuery(kind, ''); S.input.focus(); });
    S.all.addEventListener('click', () => toggleMatching(kind));
    S.none.addEventListener('click', e => { if (e.target.closest('[data-clear-search]')) { setQuery(kind, ''); S.input.focus(); } });
  }

  function renderOptions() {
    const o = buildOptions(rooms);
    const sig = JSON.stringify(o);
    if (sig === optionSig) return;
    optionSig = sig;
    optLabels = { types: new Map(o.types.map(t => [t.key, t.label])), floors: new Map(o.floors.map(x => [x.key, x.label])) };
    ui.types.innerHTML = o.types.map(t => optionHtml('type', t, f.types.includes(t.key))).join('') ||
      '<p class="text-xs text-gray-400">No rooms.</p>';
    ui.floors.innerHTML = o.floors.map(x => optionHtml('floor', x, f.floors.includes(x.key))).join('') ||
      '<p class="text-xs text-gray-400">No rooms.</p>';
    paintLists();
  }

  function toggleIn(arr, v, on) {
    const s = new Set(arr);
    if (on) s.add(v); else s.delete(v);
    return [...s];
  }

  function init(opts) {
    onChange = opts.onChange || onChange;
    getNow = opts.getNow || getNow;
    ui = {
      seats: $('mcSeats'), tight: $('mcTight'), types: $('mcTypes'), floors: $('mcFloors'),
      winDate: $('mcWinDate'), winFrom: $('mcWinFrom'), winTo: $('mcWinTo'), winHint: $('mcWinHint'),
      clear: $('mcClear'), badge: $('mcFilterBadge'), btnBadge: $('mcFiltersBtnBadge'), chips: $('mcChips'),
      tightWrap: $('mcTightWrap'), accs: [...document.querySelectorAll('#mcFilters .mc-acc')]
    };
    ui.lists = [ui.types, ui.floors];
    bindSearch('types', 'Types');
    bindSearch('floors', 'Floors');

    // Accordion headers (one open at a time) and the per-section "Clear" links.
    ui.accs.forEach(acc => acc.querySelector('.mc-acc-btn').addEventListener('click', () => {
      const key = acc.getAttribute('data-sec');
      setOpen(key, openSec !== key);
    }));
    $('mcFilters').addEventListener('click', e => {
      const c = e.target.closest('[data-clear]');
      if (c) remove(c.getAttribute('data-clear'));
    });
    ui.lists.forEach(l => l.addEventListener('scroll', () => paintScrollCue(l), { passive: true }));
    if ('ResizeObserver' in window) { const ro = new ResizeObserver(entries => entries.forEach(en => paintScrollCue(en.target))); ui.lists.forEach(l => ro.observe(l)); }
    window.addEventListener('resize', () => ui.lists.forEach(paintScrollCue));

    ui.chips.innerHTML = CHIPS.map(c =>
      '<button type="button" class="mc-chip" data-chip="' + c.id + '" aria-pressed="false">' +
      '<span class="material-symbols-outlined" aria-hidden="true">' + c.icon + '</span><span class="mc-chip-l">' + esc(c.label) + '</span></button>').join('');
    ui.chips.addEventListener('click', e => {
      const btn = e.target.closest('button[data-chip]');
      if (!btn || btn.disabled) return;
      CHIPS.find(c => c.id === btn.getAttribute('data-chip')).toggle(f, rooms);
      fire('chip');
    });

    const readSeats = () => {
      const n = parseInt(ui.seats.value, 10);
      f.seats = Number.isFinite(n) && n > 0 ? Math.min(n, 9999) : '';
      if (f.seats === '') f.tight = false;
    };
    // Only fire when the value really changed: a no-op blur/"change" must not redraw the grid
    // under the user's mouse (that swallows the click they were about to make).
    const commitSeats = () => {
      const prev = f.seats;
      readSeats();
      if (f.seats !== prev) fire('seats');
    };
    let timer = null;
    ui.seats.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(commitSeats, 250); });
    ui.seats.addEventListener('change', () => { clearTimeout(timer); commitSeats(); });
    ui.tight.addEventListener('change', () => { f.tight = ui.tight.checked && f.seats !== ''; fire('seats'); });

    ui.types.addEventListener('change', e => {
      const i = e.target.closest('input[data-type]');
      if (i) { f.types = toggleIn(f.types, i.getAttribute('data-type'), i.checked); fire('types'); }
    });
    ui.floors.addEventListener('change', e => {
      const i = e.target.closest('input[data-floor]');
      if (i) { f.floors = toggleIn(f.floors, i.getAttribute('data-floor'), i.checked); fire('floors'); }
    });

    const readWindow = () => { f.winDate = ui.winDate.value; f.winFrom = ui.winFrom.value; f.winTo = ui.winTo.value; fire('window'); };
    [ui.winDate, ui.winFrom, ui.winTo].forEach(i => i.addEventListener('change', readWindow));
    ui.clear.addEventListener('click', () => { clear(); });
    chooseDefaultSection();
    sync();
  }

  function setRooms(list) {
    rooms = list;
    if (!ui) return;
    renderOptions();
    chooseDefaultSection();
    sync();
  }

  function clear() {
    f = blank();
    if (ui && ui.typesS) { query.types = query.floors = ''; ui.typesS.input.value = ui.floorsS.input.value = ''; }
    fire('clear');
  }

  /** Drop one filter group (used by the empty-state "relax" buttons). */
  function remove(key) {
    if (key === 'seats') { f.seats = ''; f.tight = false; }
    else if (key === 'types') { f.types = []; if (ui && ui.typesS) setQuery('types', ''); }
    else if (key === 'floors') { f.floors = []; if (ui && ui.floorsS) setQuery('floors', ''); }
    else if (key === 'window') f.winDate = f.winFrom = f.winTo = '';
    else if (key === 'now') f.now = false;
    fire('remove');
  }

  /** Set floors/types from outside the panel (the "choose a floor / room type" gate). */
  function set(patch, reason) {
    if (patch.floors) f.floors = patch.floors.map(String);
    if (patch.types) f.types = patch.types.map(String);
    fire(reason || 'set');
  }

  const get = () => ({ ...f, types: f.types.slice(), floors: f.floors.slice() });
  function setRules(r) { rules = r; sync(); }

  window.MCFilters = Object.freeze({
    init, setRooms, setRules, get, set, clear, remove, sync, openSection,
    apply, relaxHints, activeKeys, windowState, dayInfo, isFullyBooked, buildOptions, typeKey, units, textMatches
  });
})();
