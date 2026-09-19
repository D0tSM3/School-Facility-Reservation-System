/**
 * RoomCalendar
 * A reusable weekly calendar component for CampusRoom.
 *
 * Config:
 *   containerId  id of the element to render into
 *   roomId       room whose schedule is shown
 *   initialDate  'YYYY-MM-DD' the student is booking; the calendar opens on
 *                that date's week and highlights its column
 *   minDate      'YYYY-MM-DD' earliest bookable day; earlier days are greyed
 */
class RoomCalendar {
  constructor(config) {
    this.container = document.getElementById(config.containerId);
    this.roomId = config.roomId;
    this.baseUri = window.location.pathname.replace(/[^\/]*$/, '');
    this.selectedDate = config.initialDate || '';
    this.minDate = config.minDate || '';
    this.requestSeq = 0;          // guards against out-of-order responses
    this.loadingTimer = null;     // delays the "Loading…" row so fast responses don't flash it
    this.lastDates = null;
    this.lastData = null;

    // Open on the week of the date being booked, not on "today's" week.
    const anchor = this.parseYMD(this.selectedDate) || this.parseYMD(this.minDate) || new Date();
    this.currentDate = this.mondayOf(anchor);

    this.blocks = [
      { start: "07:30", label: "7:30 AM" },
      { start: "09:00", label: "9:00 AM" },
      { start: "10:30", label: "10:30 AM" },
      { start: "12:00", label: "12:00 PM" },
      { start: "13:30", label: "1:30 PM" },
      { start: "15:00", label: "3:00 PM" },
      { start: "16:30", label: "4:30 PM" },
      { start: "18:00", label: "6:00 PM" },
      { start: "19:30", label: "7:30 PM" }
    ];

    if (!this.container) {
      console.error('RoomCalendar: Container not found');
      return;
    }

    this.renderLayout();
    this.loadData();
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

  getDatesForWeek() {
    const dates = [];
    for (let i = 0; i < 7; i++) { // Monday to Sunday
      const d = new Date(this.currentDate);
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
      <div class="bg-surface-container-lowest rounded-lg shadow-sm border border-outline-variant overflow-hidden flex flex-col h-full">
        <div class="px-space-md py-space-sm border-b border-outline-variant bg-surface-container-low flex justify-between items-center">
          <button type="button" class="btn-prev-week p-1 rounded hover:bg-surface-container-highest transition-colors" aria-label="Previous week">
            <span class="material-symbols-outlined text-[20px] text-on-surface-variant">chevron_left</span>
          </button>
          <h3 class="font-label-lg text-label-lg text-on-surface week-label"></h3>
          <button type="button" class="btn-next-week p-1 rounded hover:bg-surface-container-highest transition-colors" aria-label="Next week">
            <span class="material-symbols-outlined text-[20px] text-on-surface-variant">chevron_right</span>
          </button>
        </div>

        <div class="overflow-x-auto bg-surface-container-lowest p-2">
          <table class="w-full min-w-[560px] table-fixed border-collapse border border-outline-variant text-center" id="calendarTable">
            <thead>
              <tr id="calendarHeaderRow" class="bg-[#FDE68A]">
                <!-- Headers injected here -->
              </tr>
            </thead>
            <tbody id="calendarBody">
              <!-- Rows injected here -->
            </tbody>
          </table>
        </div>

        <div class="px-space-sm py-space-xs border-t border-outline-variant bg-surface-container-low flex gap-space-md flex-wrap">
          <div class="flex items-center gap-1 font-label-sm text-on-surface-variant"><span class="w-3 h-3 rounded bg-white border border-outline-variant inline-block"></span> Available</div>
          <div class="flex items-center gap-1 font-label-sm text-on-surface-variant"><span class="w-3 h-3 rounded bg-blue-100 border border-blue-300 inline-block"></span> Class</div>
          <div class="flex items-center gap-1 font-label-sm text-on-surface-variant"><span class="w-3 h-3 rounded bg-[#DCFCE7] border border-[#86EFAC] inline-block"></span> Reserved (approved)</div>
          <div class="flex items-center gap-1 font-label-sm text-on-surface-variant"><span class="w-3 h-3 rounded bg-amber-100 border border-dashed border-amber-400 inline-block"></span> Reserved (pending)</div>
          <div class="flex items-center gap-1 font-label-sm text-on-surface-variant"><span class="w-3 h-3 rounded bg-gray-200 border border-gray-300 inline-block"></span> Holiday / closed</div>
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
    const dates = this.getDatesForWeek();
    const startStr = this.formatDateYMD(dates[0]);
    const endStr = this.formatDateYMD(dates[5]);   // Saturday; Sunday is closed

    const opts = { month: 'short', day: 'numeric' };
    this.container.querySelector('.week-label').textContent =
      `${dates[0].toLocaleDateString('en-US', opts)} - ${dates[6].toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;

    const seq = ++this.requestSeq;
    // A local/fast response would otherwise flash "Loading…" for an instant,
    // which reads as a glitch rather than a loading state. Only show it if
    // the fetch is still in flight after a short delay.
    clearTimeout(this.loadingTimer);
    this.loadingTimer = setTimeout(() => {
      if (seq === this.requestSeq) this.showLoading();
    }, 200);

    fetch(`${this.baseUri}api/rooms/${encodeURIComponent(this.roomId)}/calendar?start=${startStr}&end=${endStr}`, {
      credentials: 'include'
    })
      .then(res => res.json())
      .then(json => {
        if (seq !== this.requestSeq) return;        // a newer request is in flight; drop this one
        clearTimeout(this.loadingTimer);
        if (json.success) {
          this.lastDates = dates;
          this.lastData = json.data;
          this.renderGrid(dates, json.data);
        } else {
          console.error("Calendar fetch error:", json.error);
          this.showLoadError();
        }
      })
      .catch(err => {
        if (seq !== this.requestSeq) return;
        clearTimeout(this.loadingTimer);
        console.error("Calendar fetch error:", err);
        this.showLoadError();
      });
  }

  showLoading() {
    const tbody = this.container.querySelector('#calendarBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8" class="p-6 text-on-surface-variant">Loading this room\u2019s schedule\u2026</td></tr>';
    }
  }

  // A failed/empty fetch must never look like "everything is free".
  showLoadError() {
    const tbody = this.container.querySelector('#calendarBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8" class="p-4 text-error">Couldn\u2019t load this room\u2019s schedule. Please try again.</td></tr>';
    }
  }

  // ---- grid --------------------------------------------------------------

  chip(cls, line1, line2, title) {
    const div = document.createElement('div');
    div.className = `border rounded px-1 py-0.5 mb-0.5 leading-tight overflow-hidden ${cls}`;
    div.title = title;
    const a = document.createElement('div');
    a.className = 'font-bold truncate';
    a.textContent = line1;
    div.appendChild(a);
    if (line2) {
      const b = document.createElement('div');
      b.className = 'truncate opacity-80';
      b.textContent = line2;
      div.appendChild(b);
    }
    return div;
  }

  renderGrid(dates, data) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const todayYMD = this.formatDateYMD(new Date());

    // Headers
    const headerRow = this.container.querySelector('#calendarHeaderRow');
    if (!headerRow) return;

    headerRow.innerHTML = '<th class="p-1 border border-outline-variant font-label-sm font-semibold w-[72px]">Time</th>';

    dates.forEach((date, i) => {
      const ymd = this.formatDateYMD(date);
      const isToday = ymd === todayYMD;
      const isSelected = ymd === this.selectedDate;
      const th = document.createElement('th');
      th.dataset.date = ymd;
      th.className = 'p-1 border border-outline-variant font-label-sm font-semibold ' +
        (isSelected ? 'bg-primary-container text-on-primary' : (isToday ? 'bg-primary/20' : ''));
      th.innerHTML = `<div>${days[i]}</div><div class="text-[11px] font-normal">${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>`;
      headerRow.appendChild(th);
    });

    // Body
    const tbody = this.container.querySelector('#calendarBody');
    tbody.innerHTML = '';

    this.blocks.forEach((block, index) => {
      const tr = document.createElement('tr');

      const nextBlock = this.blocks[index + 1];
      const blockEnd = nextBlock ? nextBlock.start : '21:00';
      const endLabel = nextBlock ? nextBlock.label : '9:00 PM';

      const tdTime = document.createElement('td');
      tdTime.className = 'p-1 border border-outline-variant font-label-sm font-semibold text-on-surface-variant align-top whitespace-nowrap text-[11px]';
      tdTime.innerHTML = `<div>${block.label}</div><div class="font-normal opacity-70">${endLabel}</div>`;
      tr.appendChild(tdTime);

      // A booking/class that spans more than one block shows in every block it
      // overlaps (same rule booking.js uses to grey out start times).
      const overlaps = (s, e) => s < blockEnd && e > block.start;

      dates.forEach((date, i) => {
        const dateYMD = this.formatDateYMD(date);
        const dayName = dayNames[i];
        const isSelected = dateYMD === this.selectedDate;
        const beforeOpen = this.minDate && dateYMD < this.minDate;

        // Sunday: one merged "Closed" cell instead of nine empty ones.
        if (dayName === 'Sunday') {
          if (index === 0) {
            const td = document.createElement('td');
            td.rowSpan = this.blocks.length;
            td.dataset.date = dateYMD;
            td.className = 'border border-outline-variant bg-surface-container-low text-on-surface-variant text-[11px] font-semibold align-middle' +
              (isSelected ? ' ring-2 ring-inset ring-primary-container' : '');
            td.innerHTML = '<span class="material-symbols-outlined text-[16px] block mx-auto mb-1">block</span>Closed<div class="font-normal">Sundays</div>';
            tr.appendChild(td);
          }
          return;
        }

        const td = document.createElement('td');
        td.dataset.date = dateYMD;
        td.className = 'p-0.5 border border-outline-variant text-[10px] align-top h-14 ' +
          (beforeOpen ? 'bg-surface-container-low' : (isSelected ? 'bg-primary/5' : 'bg-white'));

        const holiday = (data.holidays || []).find(h => h.holiday_date === dateYMD);
        if (holiday) {
          td.className = 'p-0.5 border border-outline-variant text-[10px] align-middle h-14 bg-gray-200 text-on-surface-variant';
          td.innerHTML = '<span class="material-symbols-outlined text-[14px] block mx-auto">celebration</span>';
          const name = document.createElement('div');
          name.className = 'font-bold leading-tight';
          name.textContent = holiday.name;
          td.appendChild(name);
          tr.appendChild(td);
          return;
        }

        // Classes (recurring weekly)
        (data.class_schedules || [])
          .filter(c => c.day_of_week === dayName &&
                       overlaps(c.start_time.slice(0, 5), c.end_time.slice(0, 5)))
          .forEach(c => {
            td.classList.remove('bg-white', 'bg-primary/5', 'bg-surface-container-low');
            td.classList.add('bg-blue-100');
            td.appendChild(this.chip(
              'bg-blue-50 border-blue-300 text-blue-800',
              c.course_code, c.section,
              `Class: ${c.course_code} ${c.section}, ${this.fmt12(c.start_time.slice(0, 5))} - ${this.fmt12(c.end_time.slice(0, 5))}`
            ));
          });

        // Reservations (Pending + Approved only; the API already filters)
        (data.reservations || [])
          .filter(r => r.start_time.startsWith(dateYMD) &&
                       overlaps(r.start_time.slice(11, 16), r.end_time.slice(11, 16)))
          .forEach(r => {
            const pending = r.status === 'Pending';
            td.classList.remove('bg-white', 'bg-primary/5', 'bg-surface-container-low');
            td.classList.add(pending ? 'bg-amber-100' : 'bg-[#DCFCE7]');
            td.appendChild(this.chip(
              pending ? 'bg-amber-50 border-amber-400 border-dashed text-amber-800'
                      : 'bg-[#DCFCE7] border-[#86EFAC] text-[#15803D]',
              r.purpose, r.customer_name || r.status,
              `${r.status}: ${r.purpose}, ${this.fmt12(r.start_time.slice(11, 16))} - ${this.fmt12(r.end_time.slice(11, 16))}`
            ));
          });

        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    });
  }
}
