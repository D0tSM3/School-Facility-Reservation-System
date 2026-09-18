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

    this.hours = Array.from({length: 15}, (_, i) => i + 7); // 7 AM to 9 PM

    if (!this.container) {
      console.error('RoomCalendar: Container not found');
      return;
    }

    this.renderLayout();
    this.loadData();
  }

  getDatesForWeek() {
    const dates = [];
    for (let i = 0; i < 6; i++) { // Monday to Saturday
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
        
        <div class="flex-1 overflow-auto relative min-h-[400px]">
          <div class="grid grid-cols-7 border-b border-outline-variant sticky top-0 bg-surface-container-lowest z-30 header-grid">
            <div class="p-2 border-r border-outline-variant font-label-sm text-center text-on-surface-variant bg-surface-container-low">Time</div>
            <!-- Day headers injected here -->
          </div>
          
          <div class="grid grid-cols-7 relative body-grid">
            <!-- Time column -->
            <div class="border-r border-outline-variant bg-surface-container-lowest relative z-10 time-column">
               <!-- Time labels injected here -->
            </div>
            
            <!-- Day columns -->
            <!-- Columns injected here -->
          </div>
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
    // timeStr format: "HH:MM:SS" or "HH:MM"
    const parts = timeStr.split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    
    const startHour = this.hours[0];
    const totalHours = this.hours.length;
    
    if (h < startHour) return 0;
    if (h >= startHour + totalHours) return 100;
    
    const decimalHours = (h - startHour) + (m / 60);
    return (decimalHours / totalHours) * 100;
  }

  renderGrid(dates, data) {
    const headerGrid = this.container.querySelector('.header-grid');
    
    // Clear old headers (keep first col)
    while (headerGrid.children.length > 1) {
      headerGrid.removeChild(headerGrid.lastChild);
    }
    
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    // Build Headers
    dates.forEach((date, i) => {
      const isToday = this.formatDateYMD(date) === this.formatDateYMD(new Date());
      const div = document.createElement('div');
      div.className = `p-2 border-r border-outline-variant font-label-sm text-center ${isToday ? 'text-primary font-bold bg-primary-container/10' : 'text-on-surface'}`;
      div.innerHTML = `<div>${days[i].substring(0,3)}</div><div class="text-body-sm text-on-surface-variant font-normal">${date.getDate()}</div>`;
      headerGrid.appendChild(div);
    });

    const bodyGrid = this.container.querySelector('.body-grid');
    
    // Clear old body (keep first col)
    while (bodyGrid.children.length > 1) {
      bodyGrid.removeChild(bodyGrid.lastChild);
    }

    const timeCol = this.container.querySelector('.time-column');
    timeCol.innerHTML = '';
    // 60px per hour
    const hourHeight = 60;
    timeCol.style.height = `${this.hours.length * hourHeight}px`;

    this.hours.forEach((h, i) => {
      const div = document.createElement('div');
      div.className = 'absolute w-full border-b border-outline-variant/30 text-right pr-2 text-[10px] text-on-surface-variant';
      div.style.top = `${i * hourHeight}px`;
      div.style.height = `${hourHeight}px`;
      
      const ampm = h >= 12 ? 'PM' : 'AM';
      const dispH = h > 12 ? h - 12 : h;
      div.textContent = `${dispH} ${ampm}`;
      timeCol.appendChild(div);
    });

    // Generate day columns
    dates.forEach((date, i) => {
      const dateYMD = this.formatDateYMD(date);
      const dayName = days[i];
      const div = document.createElement('div');
      div.className = 'relative border-r border-outline-variant/30';
      div.style.height = `${this.hours.length * hourHeight}px`;

      // Check holidays
      const holiday = data.holidays.find(h => h.holiday_date === dateYMD);
      if (holiday) {
        const holDiv = document.createElement('div');
        holDiv.className = 'absolute inset-0 bg-gray-100 flex items-center justify-center text-center p-2 text-on-surface-variant font-label-sm flex-col opacity-80 z-20';
        holDiv.innerHTML = `<span class="material-symbols-outlined text-[24px] mb-1">celebration</span><span>${holiday.name}</span><span class="text-[10px]">${holiday.type} Holiday</span>`;
        div.appendChild(holDiv);
      } else {
        // Draw grid lines
        this.hours.forEach((h, j) => {
          const line = document.createElement('div');
          line.className = 'absolute w-full border-b border-outline-variant/30';
          line.style.top = `${j * hourHeight}px`;
          line.style.height = `${hourHeight}px`;
          div.appendChild(line);
        });

        // Add Classes
        const classes = data.class_schedules.filter(c => c.day_of_week === dayName);
        classes.forEach(c => {
          const topPct = this.timeToPercent(c.start_time);
          const bottomPct = this.timeToPercent(c.end_time);
          if (bottomPct <= 0 || topPct >= 100) return; // out of bounds
          
          const ev = document.createElement('div');
          ev.className = 'absolute left-0 right-0 mx-1 rounded border p-1 overflow-hidden text-[10px] leading-tight bg-blue-50 border-blue-200 text-blue-800 z-10 shadow-sm';
          ev.style.top = `${topPct}%`;
          ev.style.height = `${bottomPct - topPct}%`;
          ev.innerHTML = `<div class="font-bold">${c.course_code} ${c.section}</div>`;
          div.appendChild(ev);
        });

        // Add Reservations
        const resList = data.reservations.filter(r => r.start_time.startsWith(dateYMD));
        resList.forEach(r => {
          const tStart = r.start_time.split(' ')[1];
          const tEnd = r.end_time.split(' ')[1];
          
          const topPct = this.timeToPercent(tStart);
          const bottomPct = this.timeToPercent(tEnd);
          if (bottomPct <= 0 || topPct >= 100) return;
          
          const isPending = r.status === 'Pending';
          const bgClass = isPending ? 'bg-amber-50 border-amber-200 text-amber-800 border-dashed' : 'bg-[#DCFCE7] border-[#86EFAC] text-[#15803D]';
          
          const ev = document.createElement('div');
          ev.className = `absolute left-0 right-0 mx-1 rounded border p-1 overflow-hidden text-[10px] leading-tight z-20 shadow-sm ${bgClass}`;
          ev.style.top = `${topPct}%`;
          ev.style.height = `${bottomPct - topPct}%`;
          ev.innerHTML = `<div class="font-bold whitespace-nowrap truncate">${r.purpose}</div><div class="truncate">${r.customer_name}</div>`;
          ev.title = `${r.purpose} (${r.status})`;
          div.appendChild(ev);
        });
      }
      
      bodyGrid.appendChild(div);
    });
  }
}
