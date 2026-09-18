/**
 * RoomCalendar
 * A reusable weekly calendar component for CampusRoom.
 */
class RoomCalendar {
  constructor(config) {
    this.container = document.getElementById(config.containerId);
    this.roomId = config.roomId;
    this.baseUri = window.location.pathname.replace(/[^\/]*$/, '');
    
    // Set to current week's Monday
    this.currentDate = new Date();
    this.currentDate.setHours(0, 0, 0, 0);
    const day = this.currentDate.getDay();
    const diff = this.currentDate.getDate() - day + (day === 0 ? -6 : 1);
    this.currentDate.setDate(diff);

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

  renderLayout() {
    this.container.innerHTML = `
      <div class="bg-surface-container-lowest rounded-lg shadow-sm border border-outline-variant overflow-hidden flex flex-col h-full min-h-[500px]">
        <div class="px-space-md py-space-sm border-b border-outline-variant bg-surface-container-low flex justify-between items-center">
          <button type="button" class="btn-prev-week p-1 rounded hover:bg-surface-container-highest transition-colors">
            <span class="material-symbols-outlined text-[20px] text-on-surface-variant">chevron_left</span>
          </button>
          <h3 class="font-label-lg text-label-lg text-on-surface week-label"></h3>
          <button type="button" class="btn-next-week p-1 rounded hover:bg-surface-container-highest transition-colors">
            <span class="material-symbols-outlined text-[20px] text-on-surface-variant">chevron_right</span>
          </button>
        </div>
        
        <div class="flex-1 overflow-auto bg-surface-container-lowest p-4">
          <table class="w-full border-collapse border border-outline-variant text-center" id="calendarTable">
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
          <div class="flex items-center gap-1 font-label-sm text-on-surface-variant"><span class="w-3 h-3 rounded bg-blue-100 border border-blue-300 inline-block"></span> Classes</div>
          <div class="flex items-center gap-1 font-label-sm text-on-surface-variant"><span class="w-3 h-3 rounded bg-[#DCFCE7] border border-[#86EFAC] inline-block"></span> Approved</div>
          <div class="flex items-center gap-1 font-label-sm text-on-surface-variant"><span class="w-3 h-3 rounded bg-amber-50 border border-amber-200 inline-block"></span> Pending</div>
          <div class="flex items-center gap-1 font-label-sm text-on-surface-variant"><span class="w-3 h-3 rounded bg-gray-200 border border-gray-300 inline-block"></span> Holiday</div>
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

  loadData() {
    const dates = this.getDatesForWeek();
    const startStr = this.formatDateYMD(dates[0]);
    const endStr = this.formatDateYMD(dates[5]);
    
    const weekLabel = `${dates[0].toLocaleDateString('en-US', {month:'short', day:'numeric'})} - ${dates[5].toLocaleDateString('en-US', {month:'short', day:'numeric', year:'numeric'})}`;
    this.container.querySelector('.week-label').textContent = weekLabel;

    fetch(`${this.baseUri}api/rooms/${this.roomId}/calendar?start=${startStr}&end=${endStr}`, {
      credentials: 'include'
    })
      .then(res => res.json())
      .then(json => {
        if (json.success) {
          this.renderGrid(dates, json.data);
        } else {
          console.error("Calendar fetch error:", json.error);
        }
      })
      .catch(console.error);
  }

  timeToPercent(timeStr) {
    const parts = timeStr.split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    
    const startHour = 7.5; // 7:30 AM
    const totalHours = 13.5; // 7:30 AM to 9:00 PM
    
    const decimalHours = h + (m / 60);
    if (decimalHours <= startHour) return 0;
    if (decimalHours >= startHour + totalHours) return 100;
    
    return ((decimalHours - startHour) / totalHours) * 100;
  }

  renderGrid(dates, data) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    
    // Headers
    const headerRow = this.container.querySelector('#calendarHeaderRow');
    if (!headerRow) return;
    
    headerRow.innerHTML = '<th class="p-2 border border-outline-variant font-label-sm font-semibold w-24">Time</th>';
    
    dates.forEach((date, i) => {
      const isToday = this.formatDateYMD(date) === this.formatDateYMD(new Date());
      const th = document.createElement('th');
      th.className = `p-2 border border-outline-variant font-label-sm font-semibold ${isToday ? 'bg-primary/20' : ''}`;
      th.innerHTML = `<div>${days[i]}</div><div class="text-xs font-normal mt-0.5">${date.toLocaleDateString('en-US', {month: 'short', day: 'numeric'})}</div>`;
      headerRow.appendChild(th);
    });

    // Body
    const tbody = this.container.querySelector('#calendarBody');
    tbody.innerHTML = '';
    
    this.blocks.forEach((block, index) => {
      const tr = document.createElement('tr');
      
      const tdTime = document.createElement('td');
      tdTime.className = 'p-2 border border-outline-variant font-label-sm font-semibold text-on-surface-variant align-top';
      const nextBlock = this.blocks[index + 1];
      const endLabel = nextBlock ? nextBlock.label : '9:00 PM';
      tdTime.innerHTML = `<div>${block.label}</div><div class="text-xs font-normal mt-0.5">${endLabel}</div>`;
      tr.appendChild(tdTime);
      
      dates.forEach((date, i) => {
        const dateYMD = this.formatDateYMD(date);
        const dayName = days[i];
        
        const td = document.createElement('td');
        td.className = 'p-2 border border-outline-variant text-[11px] align-top min-w-[100px] h-20';
        
        // Sunday
        if (dayName === 'Sunday') {
          td.className += ' bg-surface-container-low';
          tr.appendChild(td);
          return;
        }

        const holiday = data.holidays.find(h => h.holiday_date === dateYMD);
        if (holiday) {
          td.innerHTML = `<div class="bg-gray-100 text-on-surface-variant p-1 text-center h-full flex flex-col justify-center rounded">
            <span class="material-symbols-outlined text-[16px] mb-1">celebration</span>
            <span class="font-bold">${holiday.name}</span>
          </div>`;
          tr.appendChild(td);
          return;
        }

        // Classes
        const classes = data.class_schedules.filter(c => c.day_of_week === dayName && c.start_time.startsWith(block.start));
        classes.forEach(c => {
          const div = document.createElement('div');
          div.className = 'bg-blue-50 border border-blue-200 text-blue-800 rounded p-1 mb-1 shadow-sm';
          div.innerHTML = `<div class="font-bold">${c.course_code}</div><div>${c.section}</div>`;
          td.appendChild(div);
        });

        // Reservations
        const resList = data.reservations.filter(r => r.start_time.startsWith(dateYMD) && r.start_time.split(' ')[1].startsWith(block.start));
        resList.forEach(r => {
          const isPending = r.status === 'Pending';
          const bgClass = isPending ? 'bg-amber-50 border-amber-200 text-amber-800 border-dashed' : 'bg-[#DCFCE7] border-[#86EFAC] text-[#15803D]';
          const div = document.createElement('div');
          div.className = `border rounded p-1 mb-1 shadow-sm ${bgClass}`;
          div.innerHTML = `<div class="font-bold truncate" title="${r.purpose}">${r.purpose}</div><div class="truncate">${r.customer_name}</div>`;
          td.appendChild(div);
        });
        
        tr.appendChild(td);
      });
      
      tbody.appendChild(tr);
    });
  }
}
