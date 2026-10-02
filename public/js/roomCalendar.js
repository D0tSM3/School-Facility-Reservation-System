/**
 * RoomCalendar
 * A reusable weekly calendar component for CampusRoom.
 *
 * Config:
 *   containerId  id of the element to render into
 *   roomId       room whose schedule is shown
 *   initialDate  'YYYY-MM-DD' the student is booking; the calendar opens on
 *                that date's week and highlights its column
 *   initialEndDate 'YYYY-MM-DD' last day of a multi-day range (optional);
 *                every column from initialDate to it is highlighted
 *   minDate      'YYYY-MM-DD' earliest bookable day; earlier days are greyed
 *   rules        { open, close, closedDays } business hours / closed days
 *                (optional; otherwise read from GET api/config)
 *
 * Multi-day bookings arrive as one reservation per day sharing a series_id;
 * renderGrid() joins those days into one continuous bar.
 */
class RoomCalendar {
  constructor(config) {
    this.container = document.getElementById(config.containerId);
    this.roomId = config.roomId;
    this.baseUri = window.location.pathname.replace(/[^\/]*$/, '');
    this.selectedDate    = config.initialDate    || '';
    this.selectedEndDate = config.initialEndDate || this.selectedDate;
    this.minDate         = config.minDate        || '';
    this.requestSeq      = 0;
    this.loadingTimer    = null;
    this.lastDates       = null;
    this.lastData        = null;

    // activeDates: when set, ONLY these specific dates are highlighted.
    // When null, every date from selectedDate to selectedEndDate is highlighted.
    this.activeDates = Array.isArray(config.activeDates) ? config.activeDates : null;

    // Open on the first date of the selected range, not necessarily Monday.
    const anchor = this.parseYMD(this.selectedDate) || this.parseYMD(this.minDate) || new Date();
    this.currentDate = new Date(anchor);
    this.currentDate.setHours(0, 0, 0, 0);

    const S = window.CampusSchedule;
    this.buildBlocks(config.rules || (S ? S.DEFAULT_RULES : { open: '06:00', close: '21:00', closedDays: [] }));

    if (!this.container) {
      console.error('RoomCalendar: Container not found');
      return;
    }

    this.renderLayout();
    this.loadData();

    // No rules handed in: fetch the configured ones and redraw once they arrive.
    if (!config.rules && S) S.loadRules(this.baseUri).then(r => this.setRules(r));
  }

  /** Time-axis rows (half hours, opening to closing) and the closed weekdays. */
  buildBlocks(rules) {
    this.rules = rules;
    const marks = window.CampusSchedule
      ? window.CampusSchedule.halfHours(rules.open, rules.close)
      : [];
    this.dayEnd = marks[marks.length - 1] || rules.close;
    this.blocks = marks.slice(0, -1).map(t => ({ start: t, label: this.fmt12(t) }));
  }

  /** New business hours / closed days: rebuild the axis and redraw. */
  setRules(rules) {
    if (!rules) return;
    this.buildBlocks(rules);
    if (this.lastDates && this.lastData) this.renderGrid(this.lastDates, this.lastData);
  }

  // ---- date helpers ------------------------------------------------------

  /** 'YYYY-MM-DD' -> local Date, or null (also null for half-typed years like 0002). */
  parseYMD(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || ''));
    if (!m || Number(m[1]) < 2000) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }

  formatDateYMD(date) {
    return date.getFullYear() + '-' +
           String(date.getMonth() + 1).padStart(2, '0') + '-' +
           String(date.getDate()).padStart(2, '0');
  }

  /** '13:30' -> '1:30 PM' */
  fmt12(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  }

  /**
   * Compute the list of Date objects to show in the grid.
   * Always starts at this.currentDate.
   * If selectedDate..selectedEndDate is a valid 1-7 day range, it shows exactly
   * those columns (snapping currentDate to selectedDate automatically).
   * Otherwise it shows 7 columns from currentDate.
   */
  getDatesToRender() {
    let startD = new Date(this.currentDate);
    startD.setHours(0, 0, 0, 0);
    let count = 7;

    // When the user is browsing (prev/next arrows), show 7 days from currentDate.
    // When viewing their selected range, snap to exactly that range.
    if (!this.browsing && this.selectedDate && this.selectedEndDate) {
      const s = this.parseYMD(this.selectedDate);
      const e = this.parseYMD(this.selectedEndDate);
      if (s && e && s <= e) {
        const diff = Math.round((e - s) / 86400000) + 1; // inclusive
        if (diff >= 1 && diff <= 7) {
          startD = s;
          count  = diff;
        }
      }
    }

    const dates = [];
    for (let i = 0; i < count; i++) {
      const d = new Date(startD);
      d.setDate(d.getDate() + i);
      dates.push(d);
    }
    return dates;
  }

  /**
   * Called by booking.js when the Reservation Date input changes.
   * Jumps to that date and highlights the column.
   */
  goToDate(ymd, force = false) {
    const d = this.parseYMD(ymd);
    if (!d) {
      if (force) this.loadData();
      return;
    }
    this.selectedDate = ymd;
    if (!this.selectedEndDate || this.selectedEndDate < ymd) this.selectedEndDate = ymd;
    // activeDates reset: if we only call goToDate the range highlight takes over
    this.activeDates = null;

    // Snap currentDate to the start of the selected range
    this.currentDate = new Date(d);
    this.currentDate.setHours(0, 0, 0, 0);

    this.loadData();
  }

  /**
   * Set the calendar to show exactly the selected date range.
   * activeDates (if provided) defines which specific dates are highlighted.
   * When activeDates is null/empty, every date in start..end is highlighted.
   */
  setRange(start, end, activeDates) {
    const sDate = this.parseYMD(start);
    if (!sDate) return;

    this.selectedDate    = start || '';
    this.selectedEndDate = (end && end >= start) ? end : start;
    this.activeDates     = Array.isArray(activeDates) ? activeDates : null;
    this.browsing        = false;   // return to selection-snap mode

    // Snap view to the start date
    this.currentDate = new Date(sDate);
    this.currentDate.setHours(0, 0, 0, 0);

    const newDates = this.getDatesToRender();
    const newStart = this.formatDateYMD(newDates[0]);
    const newEnd   = this.formatDateYMD(newDates[newDates.length - 1]);
    const oldStart = this.lastDates && this.lastDates.length ? this.formatDateYMD(this.lastDates[0]) : '';
    const oldEnd   = this.lastDates && this.lastDates.length ? this.formatDateYMD(this.lastDates[this.lastDates.length - 1]) : '';

    if (newStart === oldStart && newEnd === oldEnd) {
      // Same window — just re-paint highlights with the cached data, no fetch
      this.renderGrid(this.lastDates, this.lastData);
      return;
    }

    // Window changed: update the header label now so it doesn't lag, then
    // show a loading placeholder. booking.js's markTakenSlots will call
    // ingestData() with the real data; if for some reason it doesn't (e.g.
    // user navigated using the prev/next week buttons directly), loadData()
    // kicks in as a fallback via the prev/next click handlers.
    const opts = { month: 'short', day: 'numeric' };
    const weekLabel = this.container.querySelector('.week-label');
    if (weekLabel) {
      weekLabel.textContent =
        `${newDates[0].toLocaleDateString('en-US', opts)} – ${newDates[newDates.length - 1].toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
    }
    const colgroup = this.container.querySelector('colgroup');
    if (colgroup) {
      colgroup.innerHTML = `<col style="width:68px">` +
        newDates.map(() => `<col>`).join('');
    }
    // Clear stale cache so we don't briefly flash old data
    this.lastDates = null;
    this.lastData  = null;
    // Cancel any old in-flight fetch
    const seq = ++this.requestSeq;
    clearTimeout(this.loadingTimer);
    this.loadingTimer = setTimeout(() => {
      if (seq === this.requestSeq) this.showLoading();
    }, 200);
  }

  /**
   * Update ONLY the active-date highlights without refetching.
   * Used when the user ticks/unticks a specific-day checkbox.
   */
  setActiveDates(activeDatesArray) {
    this.activeDates = Array.isArray(activeDatesArray) ? activeDatesArray : null;
    if (this.lastDates && this.lastData) {
      this.renderGrid(this.lastDates, this.lastData);
    }
  }

  // ---- layout ------------------------------------------------------------

  renderLayout() {
    this.container.innerHTML = `
      <div class="flex flex-col">
        <!-- Header bar -->
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/80">
          <div class="flex items-center gap-2">
            <span class="material-symbols-outlined text-[18px] text-[#7a1f2b]">calendar_view_week</span>
            <h3 class="text-sm font-bold text-gray-800 tracking-tight">Facility Availability</h3>
          </div>
          <div class="flex items-center gap-1">
            <button type="button" class="btn-prev-week w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-200 text-gray-500 transition-colors" aria-label="Previous week">
              <span class="material-symbols-outlined text-[18px]">chevron_left</span>
            </button>
            <span class="week-label text-xs font-semibold text-gray-700 min-w-[160px] text-center px-1"></span>
            <button type="button" class="btn-next-week w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-200 text-gray-500 transition-colors" aria-label="Next week">
              <span class="material-symbols-outlined text-[18px]">chevron_right</span>
            </button>
          </div>
        </div>

        <!-- Scrollable grid -->
        <div class="overflow-x-auto">
          <table class="w-full min-w-[480px] table-fixed border-collapse text-xs" id="calendarTable">
            <colgroup>
              <col style="width:68px" />
            </colgroup>
            <thead>
              <tr id="calendarHeaderRow" class="bg-gray-50 border-b border-gray-200">
                <!-- Headers injected by renderGrid -->
              </tr>
            </thead>
            <tbody id="calendarBody">
              <!-- Rows injected by renderGrid -->
            </tbody>
          </table>
        </div>

        <!-- Legend -->
        <div class="flex flex-wrap gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50/80">
          <span class="text-[10px] font-bold text-gray-400 uppercase tracking-wider self-center mr-1">Legend:</span>
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-gray-200 bg-white text-[11px] font-semibold text-gray-600">
            <span class="w-2 h-2 rounded-full bg-white border border-gray-300 inline-block"></span>Available
          </span>
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[#7a1f2b]/40 bg-[#fdf5f6] text-[11px] font-semibold text-[#7a1f2b]">
            <span class="w-2 h-2 rounded-full bg-[#7a1f2b] inline-block"></span>Your Selection
          </span>
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-blue-200 bg-blue-50 text-[11px] font-semibold text-blue-700">
            <span class="w-2 h-2 rounded-full bg-blue-400 inline-block"></span>Class
          </span>
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-emerald-200 bg-emerald-50 text-[11px] font-semibold text-emerald-700">
            <span class="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>Reserved
          </span>
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-amber-200 bg-amber-50 text-[11px] font-semibold text-amber-700">
            <span class="w-2 h-2 rounded-full bg-amber-400 inline-block"></span>Pending
          </span>
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-gray-200 bg-gray-100 text-[11px] font-semibold text-gray-500">
            <span class="w-2 h-2 rounded-full bg-gray-400 inline-block"></span>Closed
          </span>
        </div>
      </div>
    `;

    this.container.querySelector('.btn-prev-week').addEventListener('click', () => {
      this.browsing = true;
      this.currentDate.setDate(this.currentDate.getDate() - 7);
      this.loadData();
    });

    this.container.querySelector('.btn-next-week').addEventListener('click', () => {
      this.browsing = true;
      this.currentDate.setDate(this.currentDate.getDate() + 7);
      this.loadData();
    });
  }

  // ---- data --------------------------------------------------------------

  loadData() {
    const dates    = this.getDatesToRender();
    const startStr = this.formatDateYMD(dates[0]);
    const endStr   = this.formatDateYMD(dates[dates.length - 1]);

    const opts = { month: 'short', day: 'numeric' };
    const weekLabel = this.container.querySelector('.week-label');
    if (weekLabel) {
      weekLabel.textContent =
        `${dates[0].toLocaleDateString('en-US', opts)} – ${dates[dates.length - 1].toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
    }

    // Update colgroup to match the actual number of date columns
    const colgroup = this.container.querySelector('colgroup');
    if (colgroup) {
      colgroup.innerHTML = `<col style="width:68px">` +
        dates.map(() => `<col>`).join('');
    }

    const seq = ++this.requestSeq;
    clearTimeout(this.loadingTimer);
    this.loadingTimer = setTimeout(() => {
      if (seq === this.requestSeq) this.showLoading();
    }, 200);

    fetch(`${this.baseUri}api/rooms/${encodeURIComponent(this.roomId)}/calendar?start=${startStr}&end=${endStr}`, {
      credentials: 'include'
    })
      .then(res => res.json())
      .then(json => {
        if (seq !== this.requestSeq) return;
        clearTimeout(this.loadingTimer);
        if (json.success) {
          this.lastDates = dates;
          this.lastData  = json.data;
          this.renderGrid(dates, json.data);
          // Notify booking.js that fresh data is available (for time-slot greying)
          if (typeof this.onDataLoaded === 'function') this.onDataLoaded(dates, json.data);
        } else {
          console.error('Calendar fetch error:', json.error);
          this.showLoadError();
        }
      })
      .catch(err => {
        if (seq !== this.requestSeq) return;
        clearTimeout(this.loadingTimer);
        console.error('Calendar fetch error:', err);
        this.showLoadError();
      });
  }

  /**
   * Accept already-fetched data from an external source (booking.js) and
   * render it directly — skipping an otherwise duplicate network request.
   * `dates` must be an array of Date objects matching the current view window.
   */
  ingestData(dates, data) {
    // Update the label and colgroup for this window
    const opts = { month: 'short', day: 'numeric' };
    const weekLabel = this.container.querySelector('.week-label');
    if (weekLabel) {
      weekLabel.textContent =
        `${dates[0].toLocaleDateString('en-US', opts)} – ${dates[dates.length - 1].toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
    }
    const colgroup = this.container.querySelector('colgroup');
    if (colgroup) {
      colgroup.innerHTML = `<col style="width:68px">` +
        dates.map(() => `<col>`).join('');
    }

    // Cancel any in-flight fetch — we already have the data
    clearTimeout(this.loadingTimer);
    this.requestSeq++;           // any pending fetch callback sees an old seq and discards itself

    // Return to selection-snap mode (browsing mode was set by prev/next, not by ingestData)
    this.browsing  = false;
    this.lastDates = dates;
    this.lastData  = data;
    this.renderGrid(dates, data);
  }

  showLoading() {
    const tbody = this.container.querySelector('#calendarBody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-sm text-gray-400 font-medium">
        <span class="material-symbols-outlined text-[20px] align-middle mr-1 animate-spin">refresh</span>
        Loading schedule…
      </td></tr>`;
    }
  }

  showLoadError() {
    const tbody = this.container.querySelector('#calendarBody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-sm text-red-500 font-semibold">
        <span class="material-symbols-outlined text-[20px] align-middle mr-1">error</span>
        Couldn't load schedule. Please try again.
      </td></tr>`;
    }
  }

  // ---- highlight logic ---------------------------------------------------

  /**
   * Returns true if a given date (YYYY-MM-DD) should be highlighted.
   *
   * When activeDates is set (Specific Days mode): only dates in that array.
   * When activeDates is null: all dates in the selectedDate..selectedEndDate range.
   */
  isInSelection(ymd) {
    if (this.activeDates !== null) {
      return this.activeDates.includes(ymd);
    }
    return !!this.selectedDate &&
      ymd >= this.selectedDate &&
      ymd <= (this.selectedEndDate || this.selectedDate);
  }

  setSelectionTimes(startTime, endTime) {
    this.selectedStartTime = startTime;
    this.selectedEndTime   = endTime;
    if (this.lastDates && this.lastData) {
      this.renderGrid(this.lastDates, this.lastData);
    }
  }

  // ---- grid --------------------------------------------------------------

  chip(cls, line1, line2, title) {
    const div = document.createElement('div');
    div.className = `rounded-md px-1.5 py-0.5 mb-0.5 leading-tight overflow-hidden text-[10px] ${cls}`;
    div.title = title;
    const a = document.createElement('div');
    a.className = 'font-bold truncate';
    a.textContent = line1;
    div.appendChild(a);
    if (line2) {
      const b = document.createElement('div');
      b.className = 'truncate opacity-70 font-medium';
      b.textContent = line2;
      div.appendChild(b);
    }
    return div;
  }

  /** 'YYYY-MM-DD' shifted by n days. */
  addDays(ymd, n) {
    const d = this.parseYMD(ymd);
    d.setDate(d.getDate() + n);
    return this.formatDateYMD(d);
  }

  /**
   * Where a reservation sits in its multi-day series, from the rows loaded
   * for this week: whether the same series continues on the day before /
   * after, and the series' first and last loaded dates.
   */
  seriesPosition(r, reservations) {
    if (!r.series_id) return null;
    const dates = reservations
      .filter(o => o.series_id === r.series_id)
      .map(o => o.start_time.slice(0, 10))
      .sort();
    const day = r.start_time.slice(0, 10);
    return {
      hasPrev: dates.includes(this.addDays(day, -1)),
      hasNext: dates.includes(this.addDays(day, 1)),
      first: dates[0],
      last: dates[dates.length - 1]
    };
  }

  renderGrid(dates, data) {
    const days     = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayYMD = this.formatDateYMD(new Date());

    // --- Update colgroup to reflect the actual number of date columns ---
    const colgroup = this.container.querySelector('colgroup');
    if (colgroup) {
      colgroup.innerHTML = `<col style="width:68px">` +
        dates.map(() => `<col style="width:${(100 / dates.length).toFixed(2)}%">`).join('');
    }

    // --- Headers ---
    const headerRow = this.container.querySelector('#calendarHeaderRow');
    if (!headerRow) return;

    headerRow.innerHTML = `<th class="py-2 pl-4 pr-2 text-left border-r border-gray-200 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Time</th>`;

    dates.forEach((date) => {
      const dayIndex = date.getDay();
      const dayShort = days[dayIndex];
      const dayFull  = dayNames[dayIndex];
      const ymd      = this.formatDateYMD(date);
      const isToday  = ymd === todayYMD;
      const isSelected = this.isInSelection(ymd);
      const isClosed = this.rules.closedDays.includes(dayFull);

      const th = document.createElement('th');
      th.dataset.date = ymd;
      th.className = 'py-2 px-1 text-center border-r border-gray-200 last:border-r-0 ' +
        (isSelected
          ? 'bg-[#7a1f2b] text-white'
          : isClosed
            ? 'bg-gray-100 text-gray-400'
            : isToday
              ? 'bg-[#f8f0f1] text-[#7a1f2b]'
              : 'text-gray-700');
      th.innerHTML = `
        <div class="text-[11px] font-bold uppercase tracking-wider">${dayShort}</div>
        <div class="text-[13px] font-semibold mt-0.5">${date.getDate()}</div>
        <div class="text-[10px] font-medium opacity-70">${date.toLocaleDateString('en-US', { month: 'short' })}</div>`;
      headerRow.appendChild(th);
    });

    // --- Body ---
    const tbody = this.container.querySelector('#calendarBody');
    tbody.innerHTML = '';

    this.blocks.forEach((block, index) => {
      const tr = document.createElement('tr');
      tr.className = 'border-b border-gray-100 last:border-b-0 hover:bg-gray-50/50 transition-colors';

      const nextBlock  = this.blocks[index + 1];
      const blockEnd   = nextBlock ? nextBlock.start : this.dayEnd;
      const endLabel   = nextBlock ? nextBlock.label : this.fmt12(this.dayEnd);

      // Time cell
      const tdTime = document.createElement('td');
      tdTime.className = 'py-2 pl-4 pr-2 border-r border-gray-200 align-top whitespace-nowrap text-right w-[68px] bg-gray-50/60';
      tdTime.innerHTML = `
        <div class="text-[11px] font-bold text-gray-600">${block.label}</div>
        <div class="text-[10px] text-gray-400 font-medium">${endLabel}</div>`;
      tr.appendChild(tdTime);

      const overlaps = (s, e) => s < blockEnd && e > block.start;

      dates.forEach((date) => {
        const dateYMD  = this.formatDateYMD(date);
        const dayName  = dayNames[date.getDay()];
        const isSelected  = this.isInSelection(dateYMD);
        const beforeOpen  = this.minDate && dateYMD < this.minDate;

        // Closed day (System Configuration) — single merged "Closed" cell
        if (this.rules.closedDays.includes(dayName)) {
          if (index === 0) {
            const td = document.createElement('td');
            td.rowSpan = this.blocks.length;
            td.dataset.date = dateYMD;
            td.className = 'border-r border-gray-200 last:border-r-0 bg-gray-100/80 text-gray-400 text-center align-middle text-[11px] font-semibold';
            td.innerHTML = `
              <span class="material-symbols-outlined text-[18px] block mx-auto mb-1 opacity-40">do_not_disturb</span>
              <div>Closed</div>`;
            tr.appendChild(td);
          }
          return;
        }

        const td = document.createElement('td');
        td.dataset.date = dateYMD;

        const overlapsSelected = isSelected && this.selectedStartTime && this.selectedEndTime &&
                                 overlaps(this.selectedStartTime, this.selectedEndTime);

        let baseBg = isSelected
          ? (overlapsSelected ? 'bg-rose-100 shadow-[inset_0_0_0_2px_#7a1f2b] relative z-10' : 'bg-[#fdf5f6]')
          : beforeOpen ? 'bg-gray-50' : 'bg-white';

        td.className = `p-0.5 border-r border-gray-200 last:border-r-0 align-top h-[42px] transition-all ${baseBg}`;

        // Holiday
        const holiday = (data.holidays || []).find(h => h.holiday_date === dateYMD);
        if (holiday) {
          td.className = `p-1 border-r border-gray-200 last:border-r-0 align-middle h-[42px] bg-gray-100 text-center`;
          td.innerHTML = `
            <span class="material-symbols-outlined text-[14px] text-gray-400 block mx-auto">celebration</span>
            <div class="text-[9px] font-bold text-gray-500 leading-tight mt-0.5 truncate px-0.5">${holiday.name}</div>`;
          tr.appendChild(td);
          return;
        }

        // Classes
        (data.class_schedules || [])
          .filter(c => c.day_of_week === dayName &&
                       overlaps(c.start_time.slice(0, 5), c.end_time.slice(0, 5)))
          .forEach(c => {
            td.className = td.className.replace(/bg-\S+/g, '') + ' bg-blue-50 p-0.5';
            td.appendChild(this.chip(
              'bg-blue-100 text-blue-800 border border-blue-200',
              c.course_code, c.section,
              `Class: ${c.course_code} ${c.section}, ${this.fmt12(c.start_time.slice(0, 5))} – ${this.fmt12(c.end_time.slice(0, 5))}`
            ));
          });

        // Reservations
        const reservations = data.reservations || [];
        reservations
          .filter(r => r.start_time.startsWith(dateYMD) &&
                       overlaps(r.start_time.slice(11, 16), r.end_time.slice(11, 16)))
          .forEach(r => {
            const pending = r.status === 'Pending';
            td.className = td.className.replace(/bg-\S+/g, '') + (pending ? ' bg-amber-50 p-0.5' : ' bg-emerald-50 p-0.5');

            const colors = pending
              ? 'bg-amber-100 text-amber-800 border-amber-200'
              : 'bg-emerald-100 text-emerald-800 border-emerald-200';
            const times = `${this.fmt12(r.start_time.slice(11, 16))} – ${this.fmt12(r.end_time.slice(11, 16))}`;
            const pos = this.seriesPosition(r, reservations);

            if (!pos) {
              td.appendChild(this.chip(`${colors} border`, r.purpose, r.customer_name || r.status,
                `${r.status}: ${r.purpose}, ${times}`));
              return;
            }

            const span = pos.first === pos.last ? '' :
              ` (${this.parseYMD(pos.first).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ` +
              `${this.parseYMD(pos.last).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} this week)`;
            const shape = [
              'border-y',
              pos.hasPrev ? 'rounded-l-none border-l-0 -ml-[3px]' : 'border-l',
              pos.hasNext ? 'rounded-r-none border-r-0 -mr-[3px]' : 'border-r'
            ].join(' ');
            const chip = this.chip(`${colors} ${shape}`,
              pos.hasPrev ? ' ' : r.purpose,
              pos.hasPrev ? '' : (r.customer_name || r.status) + ' · multi-day',
              `${r.status}: ${r.purpose}, ${times} daily — multi-day booking${span}`);
            chip.dataset.seriesId = r.series_id;
            td.appendChild(chip);
          });

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });
  }
}
