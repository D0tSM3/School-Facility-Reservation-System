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
    this.selectedDate = config.initialDate || '';
    this.selectedEndDate = config.initialEndDate || this.selectedDate;
    this.minDate = config.minDate || '';
    this.requestSeq = 0;          // guards against out-of-order responses
    this.loadingTimer = null;     // delays the "Loading…" row so fast responses don't flash it
    this.lastDates = null;
    this.lastData = null;

    // Open on the week of the date being booked, not on "today's" week.
    const anchor = this.parseYMD(this.selectedDate) || this.parseYMD(this.minDate) || new Date();
    this.currentDate = this.mondayOf(anchor);

    const S = window.CampusSchedule;
    this.buildBlocks(config.rules || (S ? S.DEFAULT_RULES : { open: '06:00', close: '21:00', closedDays: ['Sunday'] }));

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

  mondayOf(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
    return d;
  }

  getDatesToRender() {
    const dates = [];
    let startD = new Date(this.currentDate);
    let count = 7;
    
    if (this.selectedDate && this.selectedEndDate) {
        const s = this.parseYMD(this.selectedDate);
        const e = this.parseYMD(this.selectedEndDate);
        if (s && e && s <= e) {
            const diff = Math.round((e - s) / 86400000) + 1;
            if (diff >= 1 && diff <= 7) {
                startD = s;
                count = diff;
            }
        }
    }
    
    for (let i = 0; i < count; i++) {
      const d = new Date(startD);
      d.setDate(d.getDate() + i);
      dates.push(d);
    }
    return dates;
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
   * Called by booking.js when the Reservation Date input changes.
   * Jumps to that date's week (if it is a different week) and highlights the column.
   */
  goToDate(ymd, force = false) {
    const d = this.parseYMD(ymd);
    if (!d) {
      if (force) this.loadData();      // nothing to jump to; just refresh
      return;
    }
    this.selectedDate = ymd;
    if (!this.selectedEndDate || this.selectedEndDate < ymd) this.selectedEndDate = ymd;
    const monday = this.mondayOf(d);
    if (!force && this.formatDateYMD(monday) === this.formatDateYMD(this.currentDate)) {
      if (this.lastData) this.renderGrid(this.lastDates, this.lastData);   // just move the highlight
      return;
    }
    this.currentDate = monday;
    this.loadData();
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
          <table class="w-full min-w-[640px] table-fixed border-collapse text-xs" id="calendarTable">
            <colgroup>
              <col style="width:68px" />
              <col /><col /><col /><col /><col /><col /><col />
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
      this.currentDate.setDate(this.currentDate.getDate() - 7);
      this.loadData();
    });

    this.container.querySelector('.btn-next-week').addEventListener('click', () => {
      this.currentDate.setDate(this.currentDate.getDate() + 7);
      this.loadData();
    });
  }

  // ---- data --------------------------------------------------------------

  loadData() {
    const dates = this.getDatesToRender();
    const lastDate = dates[dates.length - 1];
    const startStr = this.formatDateYMD(dates[0]);
    const endStr = this.formatDateYMD(lastDate);

    const opts = { month: 'short', day: 'numeric' };
    const weekLabel = this.container.querySelector('.week-label');
    if (weekLabel) {
      weekLabel.textContent =
        `${dates[0].toLocaleDateString('en-US', opts)} – ${lastDate.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
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
          this.lastData = json.data;
          this.renderGrid(dates, json.data);
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

  setSelectionTimes(startTime, endTime) {
    this.selectedStartTime = startTime;
    this.selectedEndTime = endTime;
    if (this.lastDates && this.lastData) {
      this.renderGrid(this.lastDates, this.lastData);
    }
  }

  /** Highlight every column from start to end ('YYYY-MM-DD', inclusive). */
  setSelectionRange(start, end) {
    this.activeDates = null;
    this.selectedDate = start || '';
    this.selectedEndDate = end && end >= this.selectedDate ? end : this.selectedDate;
    if (this.lastDates && this.lastData) {
      this.renderGrid(this.lastDates, this.lastData);
    }
  }

  setSelectionActiveDates(activeDatesArray) {
    this.activeDates = activeDatesArray;
    if (activeDatesArray && activeDatesArray.length > 0) {
        this.selectedDate = activeDatesArray[0];
        this.selectedEndDate = activeDatesArray[activeDatesArray.length - 1];
    }
    if (this.lastDates && this.lastData) {
      this.renderGrid(this.lastDates, this.lastData);
    }
  }

  isInSelection(ymd) {
    if (this.activeDates) {
        return this.activeDates.includes(ymd);
    }
    return !!this.selectedDate && ymd >= this.selectedDate && ymd <= (this.selectedEndDate || this.selectedDate);
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
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayYMD = this.formatDateYMD(new Date());

    // --- Colgroups ---
    const colgroup = this.container.querySelector('colgroup');
    if (colgroup) {
        colgroup.innerHTML = `<col class="w-16 sm:w-20">` + dates.map(() => `<col class="w-[${(100/dates.length).toFixed(2)}%]">`).join('');
    }

    // --- Headers ---
    const headerRow = this.container.querySelector('#calendarHeaderRow');
    if (!headerRow) return;

    headerRow.innerHTML = `<th class="py-2 pl-4 pr-2 text-left border-r border-gray-200 text-[11px] font-bold text-gray-400 uppercase tracking-wider">Time</th>`;

    dates.forEach((date) => {
      const dayIndex = date.getDay();
      const dayShort = days[dayIndex];
      const dayFull = dayNames[dayIndex];
      
      const ymd = this.formatDateYMD(date);
      const isToday = ymd === todayYMD;
      const isSelected = this.isInSelection(ymd);
      const th = document.createElement('th');
      th.dataset.date = ymd;
      const isClosed = this.rules.closedDays.includes(dayFull);
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

      const nextBlock = this.blocks[index + 1];
      const blockEnd = nextBlock ? nextBlock.start : this.dayEnd;
      const endLabel = nextBlock ? nextBlock.label : this.fmt12(this.dayEnd);

      // Time cell
      const tdTime = document.createElement('td');
      tdTime.className = 'py-2 pl-4 pr-2 border-r border-gray-200 align-top whitespace-nowrap text-right w-[68px] bg-gray-50/60';
      tdTime.innerHTML = `
        <div class="text-[11px] font-bold text-gray-600">${block.label}</div>
        <div class="text-[10px] text-gray-400 font-medium">${endLabel}</div>`;
      tr.appendChild(tdTime);

      const overlaps = (s, e) => s < blockEnd && e > block.start;

      dates.forEach((date) => {
        const dateYMD = this.formatDateYMD(date);
        const dayName = dayNames[date.getDay()];
        const isSelected = this.isInSelection(dateYMD);
        const beforeOpen = this.minDate && dateYMD < this.minDate;

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

            // One continuous bar across the series' days: square off and
            // stretch over the column border on each side the series
            // continues, and label only its first day in view.
            const span = pos.first === pos.last ? '' :
              ` (${this.parseYMD(pos.first).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ` +
              `${this.parseYMD(pos.last).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} this week)`;
            const shape = [
              'border-y',
              pos.hasPrev ? 'rounded-l-none border-l-0 -ml-[3px]' : 'border-l',
              pos.hasNext ? 'rounded-r-none border-r-0 -mr-[3px]' : 'border-r'
            ].join(' ');
            const chip = this.chip(`${colors} ${shape}`,
              pos.hasPrev ? ' ' : r.purpose,
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
