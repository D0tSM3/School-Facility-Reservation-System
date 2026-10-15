/**
 * CampusRoom — Master Calendar booking summary.
 *
 * The right-hand panel. It shows the slot picked on the grid, collects what
 * the booking form asks for (classification, purpose, equipment, policy) and
 * submits through the EXISTING POST api/reservations with exactly the payload
 * booking.js sends:
 *   { room_id, purpose, category, classification, start_time, end_time, equipment_notes }
 * Nothing here changes a booking rule: the server (ReservationValidator and
 * the DB trigger) still decides everything. Direct booking: a successful
 * request is confirmed immediately, and a 409 means the slot is unavailable.
 */
(function () {
  'use strict';

  const S = window.CampusSchedule;
  const esc = v => window.CampusRoomUtil.escapeHtml(v);

  // The Reservations.category ENUM verbatim (booking.js PURPOSE_LABELS) — [value sent, label shown].
  const CATEGORIES = [
    ['Academic Lecture', 'Academic Lecture'],
    ['Faculty Defense', 'Faculty Defense'],
    ['Student Org Meeting', 'Student Org Meeting'],
    ['Dept Workshop', 'Dept Workshop'],
    ['Exam/Quiz', 'Exam / Quiz'],
    ['Other', 'Other (specify)']
  ];
  // Same canonical names and defaults as book-room.html's #equipmentOptions.
  const EQUIPMENT = [
    { name: 'Wireless Lapel Mic', note: '2 Transmitters & fresh batteries', on: true },
    { name: 'HDMI Cable Kit', note: 'USB-C to 4K / DisplayPort', on: true },
    { name: 'Archival Recording Pod', note: 'Fixed dual cam room capture', on: false }
  ];
  const POLICY = 'I confirm that this reservation complies with BPU Administrative Space Policies and acknowledge responsibility for room integrity. I guarantee immediate vacancy at the conclusion of the approved slot and will ensure all campus AV peripherals are safely docked.';
  const PURPOSE_MAX = 200;

  let opts = null, body = null;
  let sel = null;            // { roomId, date, start, end }
  let problem = '';
  let submitting = false, done = false;
  const f = { category: '', customClassification: '', purpose: '', policy: false, equip: new Set(EQUIPMENT.filter(e => e.on).map(e => e.name)), repeat: { mode: 'single', through: '', activeDates: null } };
  let seriesState = { days: [], blocked: [], valid: true };
  let seriesSig = '';

  const $ = id => document.getElementById(id);

  const fmtDate = ymd => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';
  };
  const mins = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  function fmtDur(a, b) {
    const d = mins(b) - mins(a), h = Math.floor(d / 60), m = d % 60;
    return (h ? h + ' hr' : '') + (h && m ? ' ' : '') + (m ? m + ' min' : '');
  }
  const equipmentString = () => EQUIPMENT.filter(e => f.equip.has(e.name)).map(e => e.name).join(', ').substring(0, 500) || 'Standard Academic Setup';
  const classification = () => f.category === 'Other' ? f.customClassification.trim() : f.category;
  const classificationIsValid = () => {
    const value = classification();
    return !!value && value.length <= 100 && (f.category !== 'Other' || value !== 'Other');
  };

  // ---------- markup (built once; inputs survive re-selecting a slot) ----------
  function build() {
    body.innerHTML =
      '<div id="mcSumEmpty" class="mc-sum-empty">' +
        '<span class="material-symbols-outlined" aria-hidden="true">touch_app</span>' +
        '<p class="font-semibold text-gray-800">No time slot selected</p>' +
        '<p>Click or drag across a <b>green</b> area of the calendar to pick a room and time. ' +
        'Hold <kbd>Shift</kbd> and click to extend. On a phone, tap the first period, then the last.</p>' +
        '<p class="mc-quick-or">or enter the details here</p>' +
        '<form id="mcQuick" class="mc-quick" novalidate>' +
          '<label class="mc-flabel" for="mcQRoom">Room</label><select id="mcQRoom" class="mc-input"></select>' +
          '<label class="mc-flabel" for="mcQDate">Date</label><input id="mcQDate" type="date" class="mc-input" />' +
          '<span class="mc-flabel">Time</span>' +
          '<div class="mc-time-edit"><label class="sr-only" for="mcQStart">Start time</label><select id="mcQStart" class="mc-input"></select>' +
            '<span aria-hidden="true">to</span>' +
            '<label class="sr-only" for="mcQEnd">End time</label><select id="mcQEnd" class="mc-input"></select></div>' +
          '<p id="mcQMsg" class="hidden mc-fwarn" role="alert"></p>' +
          '<button type="submit" class="mc-submit">Show on calendar</button>' +
        '</form>' +
      '</div>' +
      '<form id="mcSumForm" class="hidden" novalidate>' +
        /* Everything between here and the footer scrolls; the header (in the page) and the footer stay put. */
        '<div class="mc-sum-scrollwrap" id="mcSumScrollWrap">' +
        '<div class="mc-sum-scroll" id="mcSumScroll" tabindex="-1">' +

          '<section class="mc-card" aria-labelledby="mcCardRoomT">' +
            '<header class="mc-card-h"><span class="material-symbols-outlined" aria-hidden="true">meeting_room</span><h3 id="mcCardRoomT">Room and time</h3></header>' +
            '<dl class="mc-sum-dl">' +
              '<div><dt>Room</dt><dd><label class="sr-only" for="mcSumRoomSel">Room</label><select id="mcSumRoomSel" class="mc-input"></select><span id="mcSumRoom" class="block mt-1"></span></dd></div>' +
              '<div><dt>Date</dt><dd><label class="sr-only" for="mcSumDateIn">Date</label><input id="mcSumDateIn" type="date" class="mc-input" /></dd></div>' +
              '<div><dt>Time</dt><dd>' +
                '<div class="mc-time-edit"><label class="sr-only" for="mcSumStart">Start time</label><select id="mcSumStart" class="mc-input"></select>' +
                '<span aria-hidden="true">to</span>' +
                '<label class="sr-only" for="mcSumEnd">End time</label><select id="mcSumEnd" class="mc-input"></select></div>' +
                '<span id="mcSumDur" class="block text-xs text-gray-500"></span><span class="block text-xs text-gray-500">Minimum booking: 30 minutes</span></dd></div>' +
            '</dl>' +
            '<p id="mcSumApproval" class="mc-sum-approval"></p>' +
            '<p id="mcSumProblem" class="hidden mc-fwarn" role="alert"></p>' +
          '</section>' +

          '<section class="mc-card" aria-labelledby="mcCardRepeatT">' +
            '<header class="mc-card-h"><span class="material-symbols-outlined" aria-hidden="true">event_repeat</span><h3 id="mcCardRepeatT">Repeat</h3></header>' +
            '<label class="sr-only" for="mcRepeatMode">Repeat booking</label>' +
            '<select id="mcRepeatMode" class="mc-input"><option value="single">One day</option><option value="consecutive">Consecutive days</option><option value="specific">Specific days</option></select>' +
            '<div id="mcRepeatThroughWrap" class="hidden mt-2"><label for="mcRepeatThrough" class="mc-flabel">Through date (maximum 7 days)</label><input id="mcRepeatThrough" type="date" class="mc-input" /></div>' +
            '<div id="mcRepeatDays" class="hidden mt-2" aria-live="polite"></div>' +
            '<p id="mcRepeatHint" class="mc-fnote">Minimum booking: 30 minutes.</p>' +
          '</section>' +

          '<section class="mc-card" aria-labelledby="mcCardCatT">' +
            '<header class="mc-card-h"><span class="material-symbols-outlined" aria-hidden="true">category</span><h3 id="mcCardCatT">Classification <span class="mc-req" title="Required">*</span></h3></header>' +
            '<div class="mc-cats" role="radiogroup" aria-labelledby="mcCardCatT">' + CATEGORIES.map((c, i) =>
              '<label class="mc-cat"><input type="radio" name="mcCat" value="' + esc(c[0]) + '" id="mcCat' + i + '"><span>' + esc(c[1]) + '</span></label>').join('') +
            '</div>' +
            '<div id="mcCustomClassificationWrap" class="hidden mt-2">' +
              '<label class="mc-flabel" for="mcCustomClassification">Custom classification <span class="mc-req" title="Required">*</span></label>' +
              '<input id="mcCustomClassification" type="text" maxlength="100" class="mc-input" placeholder="Enter custom classification" />' +
              '<p class="mc-fnote">Enter a specific classification, not “Other”. Maximum 100 characters.</p>' +
            '</div>' +
          '</section>' +

          '<section class="mc-card" aria-labelledby="mcCardPurposeT">' +
            '<header class="mc-card-h"><span class="material-symbols-outlined" aria-hidden="true">edit_note</span><h3 id="mcCardPurposeT"><label for="mcPurpose">Purpose <span class="mc-req" title="Required">*</span></label></h3></header>' +
            '<textarea id="mcPurpose" rows="3" maxlength="' + PURPOSE_MAX + '" class="mc-input" placeholder="e.g. Weekly officers’ meeting — agenda review"></textarea>' +
            '<p class="mc-fnote text-right"><span id="mcPurposeCount">0</span>/' + PURPOSE_MAX + '</p>' +
          '</section>' +

          '<section class="mc-card" aria-labelledby="mcCardEquipT">' +
            '<header class="mc-card-h"><span class="material-symbols-outlined" aria-hidden="true">devices</span><h3 id="mcCardEquipT">Equipment</h3></header>' +
            '<p class="mc-card-sub">Selected: <b id="mcSumEquip"></b></p>' +
            '<div role="group" aria-labelledby="mcCardEquipT">' +
            EQUIPMENT.map((e, i) =>
              '<label class="mc-opt"><input type="checkbox" data-equip="' + esc(e.name) + '" id="mcEq' + i + '"' + (e.on ? ' checked' : '') + '>' +
              '<span>' + esc(e.name) + '<em class="block">' + esc(e.note) + '</em></span></label>').join('') +
            '</div>' +
          '</section>' +

          '<section class="mc-card mc-card-policy" aria-labelledby="mcCardPolicyT">' +
            '<header class="mc-card-h"><span class="material-symbols-outlined" aria-hidden="true">policy</span><h3 id="mcCardPolicyT">Policy <span class="mc-req" title="Required">*</span></h3></header>' +
            '<label class="mc-opt items-start"><input type="checkbox" id="mcPolicy" class="mt-0.5">' +
            '<span class="text-xs leading-relaxed"><b class="block text-amber-900">Institutional Space Policy Acknowledgement</b>' +
            '<span class="text-amber-800">' + esc(POLICY) + '</span></span></label>' +
          '</section>' +

          '<p class="mc-fnote mc-sum-more">Need several days? <a id="mcSumFull" class="text-[#7a1f2b] hover:underline" href="book-room.html">Use the full booking form →</a></p>' +
        '</div>' +
        '<button type="button" id="mcSumMore" class="mc-sum-morecue" hidden><span class="material-symbols-outlined" aria-hidden="true">keyboard_arrow_down</span>More below</button>' +
        '</div>' +

        /* pinned footer: message, submit, secondary links */
        '<div class="mc-sum-foot">' +
          '<div id="mcSumMsg" class="hidden mc-sum-msg" role="alert"></div>' +
          '<p id="mcSumNeeds" class="mc-sum-needs" aria-live="polite"></p>' +
          '<button id="mcSumSubmit" type="submit" class="mc-submit" disabled>Review &amp; submit</button>' +
          '<div class="mc-sum-links">' +
            '<button id="mcSumClear" type="button" class="text-gray-500 hover:underline">Clear selection</button>' +
            '<button id="mcSumGoto" type="button" class="text-[#7a1f2b] hover:underline">Show on calendar</button>' +
          '</div>' +
        '</div>' +
      '</form>';

    body.addEventListener('change', e => {
      const t = e.target;
      if (t.id === 'mcSumStart' || t.id === 'mcSumEnd') { editTimes(t.id === 'mcSumStart'); return; }
      if (t.id === 'mcSumRoomSel') { changeSlot({ roomId: t.value }); return; }
      if (t.id === 'mcSumDateIn') { changeSlot({ date: t.value }); return; }
      if (t.id === 'mcQStart' || t.id === 'mcQEnd') { quickTimes(t.id === 'mcQStart'); return; }
      if (t.id === 'mcQRoom' || t.id === 'mcQDate') { quickMsg(''); return; }
      if (t.id === 'mcRepeatMode') { f.repeat.mode=t.value; f.repeat.activeDates=null; f.repeat.through=sel ? sel.date : ''; refresh(); return; }
      if (t.id === 'mcRepeatThrough') { f.repeat.through=t.value; f.repeat.activeDates=null; refresh(); return; }
      if (t.matches && t.matches('[data-repeat-date]')) { const boxes=Array.from(body.querySelectorAll('[data-repeat-date]')); f.repeat.activeDates=boxes.filter(b=>b.checked).map(b=>b.value); refresh(); return; }
      if (t.name === 'mcCat') {
        f.category = t.value;
        const customWrap = $('mcCustomClassificationWrap');
        const customInput = $('mcCustomClassification');
        const isOther = f.category === 'Other';
        customWrap.classList.toggle('hidden', !isOther);
        customInput.required = isOther;
        if (!isOther) {
          f.customClassification = '';
          customInput.value = '';
        }
      }
      else if (t.id === 'mcPolicy') f.policy = t.checked;
      else if (t.dataset && t.dataset.equip) {
        if (t.checked) f.equip.add(t.dataset.equip); else f.equip.delete(t.dataset.equip);
        paintEquip();
      }
      refresh();
    });
    $('mcCustomClassification').addEventListener('input', e => {
      f.customClassification = e.target.value;
      refresh();
    });
    $('mcPurpose').addEventListener('input', e => { f.purpose = e.target.value; $('mcPurposeCount').textContent = e.target.value.length; refresh(); });
    $('mcSumForm').addEventListener('submit', e => { e.preventDefault(); openConfirm($('mcSumSubmit')); });
    $('mcQuick').addEventListener('submit', e => { e.preventDefault(); applyQuick(); });
    $('mcSumClear').addEventListener('click', () => { if (!submitting && opts.onClear) opts.onClear(); });
    $('mcSumGoto').addEventListener('click', () => { if (sel && opts.onGoto) opts.onGoto(Object.assign({}, sel)); });
    wireScrollCue();
  }

  // ---------- scroll cue: visible scrollbar + edge shadows + "More below" pill ----------
  function paintScrollCue() {
    const sc = $('mcSumScroll'), wrap = $('mcSumScrollWrap'), more = $('mcSumMore');
    if (!sc || !wrap) return;
    const can = sc.scrollHeight - sc.clientHeight > 4;
    const atTop = sc.scrollTop <= 2, atEnd = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4;
    wrap.classList.toggle('is-scrollable', can);
    wrap.classList.toggle('is-top', !can || atTop);
    wrap.classList.toggle('is-end', !can || atEnd);
    if (more) more.hidden = !can || atEnd;
  }
  function wireScrollCue() {
    const sc = $('mcSumScroll'), more = $('mcSumMore');
    sc.addEventListener('scroll', paintScrollCue, { passive: true });
    more.addEventListener('click', () => sc.scrollBy({ top: Math.max(120, sc.clientHeight * 0.7), behavior: 'smooth' }));
    window.addEventListener('resize', paintScrollCue);
    if (window.ResizeObserver) { const ro = new ResizeObserver(paintScrollCue); ro.observe(sc); if (sc.firstElementChild) ro.observe(sc.firstElementChild); }
  }

  // ---------- repeat controls and per-day client checks ----------
  function addDays(ymd, n) { const d=new Date(ymd+'T12:00:00'); d.setDate(d.getDate()+n); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
  function repeatDays() {
    if (!sel) return [];
    if (f.repeat.mode === 'single') return [sel.date];
    const through = f.repeat.through || sel.date;
    let all;
    try { all = window.MCSeries ? window.MCSeries.expand(sel.date, through) : [sel.date]; } catch (_) { return []; }
    return f.repeat.mode === 'specific' && Array.isArray(f.repeat.activeDates) ? all.filter(d=>f.repeat.activeDates.includes(d)) : all;
  }
  function paintRepeat() {
    const mode=$('mcRepeatMode'), through=$('mcRepeatThrough'), wrap=$('mcRepeatThroughWrap'), daysEl=$('mcRepeatDays'), hint=$('mcRepeatHint');
    if (!mode || !sel) return;
    mode.value=f.repeat.mode;
    const multi=f.repeat.mode!=='single';
    wrap.classList.toggle('hidden',!multi);
    through.min=sel.date; through.max=addDays(sel.date,6); through.value=f.repeat.through || sel.date;
    let all=[]; try { all=multi ? window.MCSeries.expand(sel.date,through.value) : [sel.date]; } catch (e) { all=[]; }
    const selected=Array.isArray(f.repeat.activeDates) ? f.repeat.activeDates : all;
    if (f.repeat.mode==='specific') {
      daysEl.classList.remove('hidden');
      daysEl.innerHTML=all.map(d=>'<label class="mc-repeat-day"><input type="checkbox" data-repeat-date value="'+d+'"'+(selected.includes(d)?' checked':'')+'><span>'+esc(fmtDate(d))+'</span></label>').join('');
    } else { daysEl.classList.add('hidden'); daysEl.innerHTML=''; }
    const days=repeatDays();
    const checked=days.length ? days : [];
    const blocked=[];
    if (opts.validateSeries && checked.length) checked.forEach(d=>{const reason=opts.validateSeries(sel,d); if(reason) blocked.push({date:d,reason});});
    seriesState={days:checked,blocked,valid:checked.length>0 && blocked.length===0};
    emitSeries(checked.length > 1 ? checked.map(d=>{const b=blocked.find(x=>x.date===d);return {date:d,blocked:!!b,reason:b?b.reason:''};}) : []);
    const status=checked.map(d=>{const b=blocked.find(x=>x.date===d);return '<div class="mc-repeat-result'+(b?' is-blocked':' is-free')+'"><span>'+(b?'✕':'✓')+'</span><span>'+esc(fmtDate(d))+(b?' — '+esc(b.reason):' — Available')+'</span></div>';}).join('');
    let skip=''; if (blocked.length && f.repeat.mode==='consecutive') skip='<button id="mcSkipBlocked" type="button" class="mc-repeat-skip">Skip blocked days</button>';
    hint.innerHTML=(days.length>3?'More than 3 booked days: staff approval is required. ':'Minimum booking: 30 minutes. ')+status+skip;
    const skipBtn=$('mcSkipBlocked'); if(skipBtn) skipBtn.addEventListener('click',()=>{f.repeat.mode='specific';f.repeat.activeDates=checked.filter(d=>!blocked.some(b=>b.date===d));refresh();});
  }

  /** Tell the page which days a multi-day booking covers so the calendar can show them. Only when they change. */
  function emitSeries(list) {
    const sig = sel ? sel.roomId + '|' + sel.start + '|' + sel.end + '|' + JSON.stringify(list) : '';
    if (sig === seriesSig) return;
    seriesSig = sig;
    if (opts.onSeriesChange) Promise.resolve().then(() => opts.onSeriesChange(list.map(x => Object.assign({}, x))));
  }

  // ---------- editable start / end (filled by the drag; can be fine-tuned by hand) ----------
  const hmOf = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  /** Every start / end boundary the booking grid offers, plus the current pick (e.g. one that came from a link). */
  function boundaries() {
    const set = new Set();
    (opts.getUnits ? opts.getUnits() : []).forEach(u => { set.add(u[0]); set.add(u[1]); });
    if (sel) { set.add(mins(sel.start)); set.add(mins(sel.end)); }
    return Array.from(set).sort((a, b) => a - b);
  }
  function fillSelect(el, values, current) {
    const sig = values.join(',');
    if (el.dataset.sig !== sig) {
      el.innerHTML = values.map(m => '<option value="' + hmOf(m) + '">' + esc(S.fmt12(hmOf(m))) + '</option>').join('');
      el.dataset.sig = sig;
    }
    el.value = current;
  }
  function paintTimes() {
    const all = boundaries(), st = mins(sel.start), en = mins(sel.end);
    fillSelect($('mcSumStart'), all.filter(m => m < en || m === st), sel.start);
    fillSelect($('mcSumEnd'), all.filter(m => m > st || m === en), sel.end);
    $('mcSumDur').textContent = fmtDur(sel.start, sel.end);
  }
  /** The user changed a select: keep end > start, tell the page so the grid and the conflict check follow. */
  function editTimes(startChanged) {
    if (!sel || submitting || done) return;
    let start = $('mcSumStart').value, end = $('mcSumEnd').value;
    if (mins(end) <= mins(start)) {
      if (startChanged) { const next = boundaries().find(m => m > mins(start)); end = next == null ? sel.end : hmOf(next); }
      else start = sel.start;
    }
    if (mins(end) <= mins(start)) { paintTimes(); return; }
    sel = Object.assign({}, sel, { start, end });
    refresh();
    if (opts.onTimesChanged) opts.onTimesChanged(Object.assign({}, sel));
  }

  // ---------- typed-in room / date / time (works with or without a slot picked on the grid) ----------
  const bookableRooms = () => (opts.getRooms ? opts.getRooms() : []).filter(r => r.status !== 'Maintenance');
  function fillRooms(el, current) {
    const list = bookableRooms();
    const sig = list.map(r => r.room_id).join(',');
    if (el.dataset.sig !== sig) {
      el.innerHTML = '<option value="">Choose a room…</option>' +
        list.map(r => '<option value="' + esc(r.room_id) + '">' + esc(r.name) + ' (' + esc(r.capacity) + ' seats)</option>').join('');
      el.dataset.sig = sig;
    }
    el.value = list.some(r => r.room_id === current) ? current : '';
  }
  function quickMsg(text) {
    const m = $('mcQMsg');
    m.textContent = text || '';
    m.classList.toggle('hidden', !text);
  }
  /** Fill the empty-state form. Never overwrites what the person is in the middle of typing. */
  function paintQuick() {
    const room = $('mcQRoom'), date = $('mcQDate'), st = $('mcQStart'), en = $('mcQEnd');
    if (!room || !date) return;
    const keep = { room: room.value, start: st.value, end: en.value };
    fillRooms(room, keep.room);
    const now = opts.getNow && opts.getNow();
    if (!date.value && now) date.value = now.ymd;
    const all = boundaries();
    fillSelect(st, all.slice(0, -1), keep.start && all.includes(mins(keep.start)) ? keep.start : (all.length ? hmOf(all[0]) : ''));
    const s0 = st.value ? mins(st.value) : 0;
    const ends = all.filter(m => m > s0);
    const defEnd = ends.find(m => m - s0 >= 60) || ends[0];
    fillSelect(en, ends, keep.end && ends.includes(mins(keep.end)) ? keep.end : (defEnd == null ? '' : hmOf(defEnd)));
  }
  /** Keep end after start in the empty-state form. */
  function quickTimes(startChanged) {
    quickMsg('');
    const st = $('mcQStart'), en = $('mcQEnd');
    if (!st.value) return;
    const all = boundaries(), s0 = mins(st.value), prevEnd = en.value;
    const ends = all.filter(m => m > s0);
    const keep = prevEnd && ends.includes(mins(prevEnd)) ? prevEnd : (ends.length ? hmOf(ends[0]) : '');
    fillSelect(en, ends, keep);
  }
  function applyQuick() {
    if (submitting || done) return;
    const roomId = $('mcQRoom').value, date = $('mcQDate').value, start = $('mcQStart').value, end = $('mcQEnd').value;
    if (!roomId) return quickMsg('Choose a room.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return quickMsg('Choose a date.');
    if (!start || !end || mins(end) <= mins(start)) return quickMsg('Choose a start time and a later end time.');
    quickMsg('');
    if (opts.onPickSlot) opts.onPickSlot({ roomId, date, start, end });
  }
  /** Room or date edited inside the filled-in summary: move the pick (and the calendar) there. */
  function changeSlot(patch) {
    if (!sel || submitting || done) return;
    const next = Object.assign({}, sel, patch);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next.date) || !opts.getRoom(next.roomId)) { refresh(); return; }
    if (opts.onPickSlot) opts.onPickSlot(next);
  }

  // ---------- pre-confirmation slip: last look before anything is saved ----------
  let confirmModal = null;
  function buildConfirmModal() {
    const wrap = document.createElement('div');
    wrap.className = 'mc-modal hidden';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'mcConfirmTitle');
    wrap.innerHTML =
      '<div class="mc-modal-card">' +
        '<div class="mc-modal-head">' +
          '<span class="material-symbols-outlined" aria-hidden="true">fact_check</span>' +
          '<div><h2 id="mcConfirmTitle">Review your reservation</h2>' +
          '<p>Nothing is saved until you confirm.</p></div>' +
        '</div>' +
        '<dl class="mc-sum-dl mc-confirm-dl" data-confirm-body></dl>' +
        '<p data-confirm-approval class="mc-sum-approval"></p>' +
        '<div class="mc-modal-actions">' +
          '<button type="button" data-confirm-back class="mc-modal-btn">Go back &amp; edit</button>' +
          '<button type="button" data-confirm-ok class="mc-modal-btn is-primary">Confirm &amp; submit</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    const m = { wrap, opener: null };
    m.close = (refocus) => {
      wrap.classList.add('hidden');
      if (refocus !== false && m.opener && document.body.contains(m.opener)) m.opener.focus();
    };
    wrap.querySelector('[data-confirm-back]').addEventListener('click', () => m.close());
    wrap.addEventListener('click', e => { if (e.target === wrap) m.close(); });
    wrap.querySelector('[data-confirm-ok]').addEventListener('click', () => { m.close(false); submit(); });
    document.addEventListener('keydown', e => {
      if (wrap.classList.contains('hidden')) return;
      if (e.key === 'Escape') { e.stopPropagation(); m.close(); return; }
      if (e.key !== 'Tab') return;                        // keep Tab inside the dialog
      const items = Array.from(wrap.querySelectorAll('button')).filter(x => !x.disabled);
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }, true);
    return m;
  }

  function openConfirm(opener) {
    if (!canSubmit()) return;
    if (!confirmModal) confirmModal = buildConfirmModal();
    const { wrap } = confirmModal, room = opts.getRoom(sel.roomId);
    confirmModal.opener = opener || null;
    const days = seriesState.days.length ? seriesState.days : [sel.date];
    const row = (k, v) => '<div><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>';
    wrap.querySelector('[data-confirm-body]').innerHTML =
      row('Room', '<b>' + esc(room ? room.name : 'Unknown room') + '</b>') +
      row('Capacity', esc(room ? room.capacity + ' seats' : '—')) +
      row(days.length > 1 ? 'Dates' : 'Date', days.length > 1
        ? '<b>' + days.length + ' days</b><span class="block text-xs text-gray-500">' + days.map(d => esc(fmtDate(d))).join('<br>') + '</span>'
        : esc(fmtDate(days[0]))) +
      row('Time', esc(S.fmt12(sel.start) + ' – ' + S.fmt12(sel.end)) + '<span class="block text-xs text-gray-500">' + esc(fmtDur(sel.start, sel.end)) + (days.length > 1 ? ' each day' : '') + '</span>') +
      row('Classification', esc(classification())) +
      row('Purpose', esc(f.purpose.trim())) +
      row('Equipment', esc(equipmentString()));
    const ap = wrap.querySelector('[data-confirm-approval]');
    ap.className = 'mc-sum-approval is-auto';
    ap.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">bolt</span>Confirmed instantly if the slot is still free when you confirm.';
    wrap.classList.remove('hidden');
    wrap.querySelector('[data-confirm-ok]').focus();
  }

  // ---------- painting ----------
  function paintEquip() { $('mcSumEquip').textContent = equipmentString(); }

  function canSubmit() {
    return !!(sel && opts.getRoom(sel.roomId) && f.category && classificationIsValid() && f.purpose.trim() && f.policy && !problem && seriesState.valid && !submitting && !done);
  }

  function refresh() {
    if (!body) return;
    const empty = $('mcSumEmpty'), form = $('mcSumForm');
    empty.classList.toggle('hidden', !!sel);
    form.classList.toggle('hidden', !sel);
    if (!sel) { emitSeries([]); paintQuick(); paintHeadSub(null); return; }

    const room = opts.getRoom(sel.roomId);
    $('mcSumRoom').innerHTML = room
      ? '<span class="block text-xs text-gray-500">' + esc(room.capacity) + ' seats · ' +
        esc(room.room_type || 'Unspecified') + ' · ' + (room.floor == null ? 'Floor —' : 'Floor ' + esc(room.floor)) + '</span>'
      : 'Unknown room';
    fillRooms($('mcSumRoomSel'), sel.roomId);
    { const di = $('mcSumDateIn'); di.value = sel.date; }
    paintTimes();
    paintEquip();
    paintRepeat();

    const ap = $('mcSumApproval');
    ap.className = 'mc-sum-approval is-auto';
    ap.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">bolt</span>Confirmed instantly if the slot is still free when you submit.';

    const prob = problem;
    const pe = $('mcSumProblem');
    pe.textContent = prob;
    pe.classList.toggle('hidden', !prob);

    $('mcSumFull').href = 'book-room.html?room_id=' + encodeURIComponent(sel.roomId);
    $('mcSumSubmit').disabled = !canSubmit() || !!prob;
    paintFooterHint(prob);
    paintHeadSub(room);
    paintScrollCue();
  }

  /** Says what is still missing instead of leaving the Submit button silently disabled. */
  function paintFooterHint(prob) {
    const el = $('mcSumNeeds');
    if (!el) return;
    if (submitting || done || prob) { el.textContent = ''; return; }
    const need = [];
    if (!f.category) need.push('classification');
    else if (!classificationIsValid()) need.push('valid custom classification');
    if (!f.purpose.trim()) need.push('purpose');
    if (!f.policy) need.push('policy acknowledgement');
    el.textContent = need.length ? 'Still needed: ' + need.join(', ') + '.' : '';
  }

  /** The pinned header keeps the pick visible while the cards scroll. */
  function paintHeadSub(room) {
    const el = document.getElementById('mcSumHeadSub');
    if (!el) return;
    el.textContent = sel ? [room ? room.name : 'Room', fmtDate(sel.date), S.fmt12(sel.start) + ' – ' + S.fmt12(sel.end)].join(' · ') : '';
    el.hidden = !sel;
  }

  function message(kind, html) {
    const m = $('mcSumMsg');
    if (!html) { m.classList.add('hidden'); m.innerHTML = ''; return; }
    m.className = 'mc-sum-msg is-' + kind;
    m.innerHTML = html;
  }

  // ---------- submit (existing endpoint) ----------
  async function submit() {
    if (!canSubmit()) return;
    const room = opts.getRoom(sel.roomId);
    const payload = {
      room_id: sel.roomId,
      purpose: f.purpose.trim(),
      category: f.category,
      classification: classification(),
      start_time: sel.date + 'T' + sel.start + ':00',
      end_time: (f.repeat.mode === 'single' ? sel.date : (f.repeat.through || sel.date)) + 'T' + sel.end + ':00',
      equipment_notes: equipmentString()
    };
    if (f.repeat.mode === 'specific') payload.active_dates = seriesState.days.slice();
    submitting = true; message('', ''); setBusy(true); refresh();
    let res, json = null;
    try {
      res = await fetch(opts.base + 'api/reservations', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
      });
      if (res.status === 401) { window.location.href = 'index.html'; return; }
      try { json = await res.json(); } catch (_) { /* HTML error page or empty body */ }
    } catch (_) {
      submitting = false; setBusy(false); refresh();
      return message('error', 'Could not reach the server. Check your connection and try again.');
    }

    if (res.ok && json && json.success !== false) {
      done = true; setBusy(true);
      const d = json.data || {};
      const ref = d.reservation_id ? 'REQ-' + String(d.reservation_id).substring(0, 8).toUpperCase() : 'Your booking';
      message('ok', '<b>Reservation confirmed:</b> ' + esc(ref) +
        ' is booked for ' + esc(room ? room.name : 'the room') + '. Redirecting to My Reservations…');
      if (opts.onBooked) opts.onBooked();
      setTimeout(() => { window.location.href = 'my-reservations.html'; }, 1500);
      return;
    }

    submitting = false; setBusy(false);
    const text = (json && (json.error || json.message)) || 'The server sent an unexpected response (HTTP ' + (res ? res.status : '?') + '). Please try again.';
    if (res.status === 409) {
      // Someone got there first (or a rule applies). Refresh the grid so the taken slot shows.
      // Direct booking: a taken slot is simply unavailable — there is no override path.
      if (opts.onConflict) opts.onConflict(json, text);
      message('error', '<b>Room unavailable.</b> ' + esc(text) + ' Pick another time on the calendar.');
    } else {
      message('error', '<b>Could not submit.</b> ' + esc(text));
    }
    refresh();
  }

  function setBusy(on) {
    const b = $('mcSumSubmit');
    b.textContent = on ? (done ? 'Submitted' : 'Submitting…') : 'Review & submit';
    body.querySelectorAll('input, textarea, button, select').forEach(x => { if (x !== b) x.disabled = on; });
  }

  // ---------- public ----------
  /** opts: { base, getRooms()→room[], onPickSlot({roomId,date,start,end}), getRoom(id)→room|undefined, getNow()→{ymd,min}, getUnits()→[[startMin,endMin]…], onTimesChanged(sel), onClear, onGoto(sel), onConflict(json, text), onBooked } */
  function init(o) {
    opts = o;
    body = $('mcSumBody');
    build();
    refresh();
  }

  /** The picked slot ({ roomId, date, start, end }) or null. Typed answers are kept. */
  function set(next) {
    if (done) return;
    sel = next ? { roomId: next.roomId, date: next.date, start: next.start, end: next.end } : null;
    f.repeat = { mode: 'single', through: sel ? sel.date : '', activeDates: null };
    seriesState = { days: sel ? [sel.date] : [], blocked: [], valid: !!sel };
    problem = '';
    message('', '');
    refresh();
  }

  /** Text shown above the form when the picked slot is no longer free (stale data). Empty clears it. */
  function setProblem(text) { problem = text || ''; refresh(); }

  /** Room details changed (fresh fetch): repaint with the new data. */
  const touch = () => refresh();

  window.MCSummary = Object.freeze({ init, set, setProblem, touch, get: () => (sel ? Object.assign({}, sel) : null) });
})();
