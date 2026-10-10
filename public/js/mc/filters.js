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
  let ui = null;

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
    '<label class="mc-opt"><input type="checkbox" data-' + kind + '="' + esc(o.key) + '"' + (checked ? ' checked' : '') + '>' +
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

    ui.chips.querySelectorAll('button[data-chip]').forEach(btn => {
      const c = CHIPS.find(x => x.id === btn.getAttribute('data-chip'));
      const on = !!c.active(f, rooms), enabled = c.enabled ? c.enabled(rooms) : true;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.disabled = !enabled;
      btn.title = enabled ? '' : 'No rooms of this kind in the system';
    });
  }

  function renderOptions() {
    const o = buildOptions(rooms);
    const sig = JSON.stringify(o);
    if (sig === optionSig) return;
    optionSig = sig;
    ui.types.innerHTML = o.types.map(t => optionHtml('type', t, f.types.includes(t.key))).join('') ||
      '<p class="text-xs text-gray-400">No rooms.</p>';
    ui.floors.innerHTML = o.floors.map(x => optionHtml('floor', x, f.floors.includes(x.key))).join('') ||
      '<p class="text-xs text-gray-400">No rooms.</p>';
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
      clear: $('mcClear'), badge: $('mcFilterBadge'), btnBadge: $('mcFiltersBtnBadge'), chips: $('mcChips')
    };

    ui.chips.innerHTML = CHIPS.map(c =>
      '<button type="button" class="mc-chip" data-chip="' + c.id + '" aria-pressed="false">' +
      '<span class="material-symbols-outlined" aria-hidden="true">' + c.icon + '</span>' + esc(c.label) + '</button>').join('');
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
    $('mcWinClear').addEventListener('click', () => { f.winDate = f.winFrom = f.winTo = ''; fire('window'); });
    ui.clear.addEventListener('click', () => { clear(); });
    sync();
  }

  function setRooms(list) {
    rooms = list;
    if (!ui) return;
    renderOptions();
    sync();
  }

  function clear() { f = blank(); fire('clear'); }

  /** Drop one filter group (used by the empty-state "relax" buttons). */
  function remove(key) {
    if (key === 'seats') { f.seats = ''; f.tight = false; }
    else if (key === 'types') f.types = [];
    else if (key === 'floors') f.floors = [];
    else if (key === 'window') f.winDate = f.winFrom = f.winTo = '';
    else if (key === 'now') f.now = false;
    fire('remove');
  }

  const get = () => ({ ...f, types: f.types.slice(), floors: f.floors.slice() });
  function setRules(r) { rules = r; sync(); }

  window.MCFilters = Object.freeze({
    init, setRooms, setRules, get, clear, remove, sync,
    apply, relaxHints, activeKeys, windowState, dayInfo, buildOptions, typeKey, units
  });
})();
