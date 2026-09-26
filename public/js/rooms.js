document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const roomGrid = document.getElementById('roomGrid');
  const searchInput = document.getElementById('roomSearchInput');
  const floorFilter = document.getElementById('floorFilter');
  const roomTypeFilter = document.getElementById('roomTypeFilter');
  const statusFilter = document.getElementById('statusFilter');
  const visibleCount = document.getElementById('visibleRoomsCount');
  const totalCount = document.getElementById('totalRoomsCount');
  const noResults = document.getElementById('noResultsNotice');
  const clearBtn = document.getElementById('clearAllFiltersBtn');
  const resetBtn = document.getElementById('resetFilters');

  const listViewBtn = document.getElementById('listViewBtn');
  const gridViewBtn = document.getElementById('gridViewBtn');

  const paginationControls = document.getElementById('paginationControls');
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  const pageIndicator = document.getElementById('pageIndicator');

  if (!roomGrid) return;

  const BASE = window.location.pathname.replace(/[^\/]*$/, '');
  let allRooms = [];
  let currentRole = null;
  let currentView = 'list'; // Default list view matching reference image

  const ITEMS_PER_PAGE = 8;
  let currentPage = 1;

  function fetchCurrentRole() {
    return fetch(BASE + 'api/auth/me', { credentials: 'include' })
      .then(res => res.json())
      .then(json => {
        const currentUser = json.success ? json.data : null;
        currentRole = String(currentUser && currentUser.role || '').toLowerCase();
      })
      .catch(err => {
        console.error('Error fetching session role:', err);
        currentRole = null;
      });
  }

  function fetchRooms() {
    fetch(BASE + 'api/rooms')
      .then(res => res.json())
      .then(json => {
        if (json.success && json.data) {
          allRooms = json.data;
          populateFilters();
          renderRooms();
        }
      })
      .catch(err => console.error('Error fetching rooms:', err));
  }

  function populateFilters() {
    const floors = new Set();
    const types = new Set();

    allRooms.forEach(r => {
      if (r.floor !== null && r.floor !== undefined) floors.add(r.floor);
      if (r.room_type) types.add(r.room_type);
    });

    Array.from(floors).sort((a, b) => a - b).forEach(floor => {
      const opt = document.createElement('option');
      opt.value = floor;
      opt.textContent = `Floor ${floor}`;
      floorFilter.appendChild(opt);
    });

    Array.from(types).sort().forEach(type => {
      const opt = document.createElement('option');
      opt.value = type;
      opt.textContent = type;
      roomTypeFilter.appendChild(opt);
    });
  }

  function getRoomIcon(r) {
    const name = (r.name || '').toLowerCase();
    const type = (r.room_type || '').toLowerCase();
    if (name.includes('audio-visual') || type.includes('avr') || name.includes('avr')) return 'smart_display';
    if (name.includes('computer') || type.includes('computer') || name.includes('pc')) return 'desktop_windows';
    if (name.includes('lecture') || type.includes('lecture') || name.includes('hall')) return 'chair';
    if (name.includes('seminar') || type.includes('seminar') || name.includes('conference')) return 'groups';
    if (name.includes('science') || type.includes('science') || name.includes('chem') || name.includes('lab')) return 'science';
    if (name.includes('multimedia') || name.includes('hardware')) return 'build';
    return 'meeting_room';
  }

  function getRoomFeatures(r) {
    const name = (r.name || '').toLowerCase();
    const type = r.room_type || 'General Space';
    if (name.includes('105') || name.includes('audio-visual')) return `${type} • High-Definition Projector`;
    if (name.includes('204') || name.includes('computer')) return `${type} • Windows Workstations`;
    if (name.includes('301') || name.includes('lecture')) return `${type} • Tiered Seating`;
    if (name.includes('402') || name.includes('seminar')) return `${type} • Modular Tables`;
    if (name.includes('208') || name.includes('science')) return `${type} • Chemical Exhausts`;
    if (name.includes('207') || name.includes('multimedia')) return `${type} • Hardware Diagnostics`;
    return `${type} • Multimedia & AC`;
  }

  function getRoomLocation(r) {
    const name = (r.name || '').toLowerCase();
    const floor = (r.floor !== null && r.floor !== undefined) ? r.floor : 1;
    if (name.includes('computer') || name.includes('204')) return `Floor ${floor}, IT Wing`;
    if (name.includes('science') || name.includes('208')) return `Floor ${floor}, Science Wing`;
    if (name.includes('seminar') || name.includes('402')) return `Floor ${floor}, Annex`;
    return `Floor ${floor}, Main Bldg`;
  }

  function getStatusBadge(status, nextAvailable) {
    if (status === 'Available') {
      return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 whitespace-nowrap"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Available</span>`;
    }
    if (status === 'Occupied') {
      let untilText = '';
      if (nextAvailable && nextAvailable !== 'Available now') {
        const d = new Date(nextAvailable);
        if (!isNaN(d.getTime())) {
          untilText = ` (Until ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})`;
        }
      }
      return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 whitespace-nowrap"><span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>In Use${untilText}</span>`;
    }
    return `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 whitespace-nowrap"><span class="w-1.5 h-1.5 rounded-full bg-gray-400"></span>Maintenance</span>`;
  }

  function renderRooms() {
    const q = (searchInput.value || '').toLowerCase();
    const fFloor = floorFilter.value;
    const fType = roomTypeFilter.value;
    const fStatus = statusFilter.value.toLowerCase();

    // Filter array
    const filteredRooms = allRooms.filter(r => {
      let status = r.live_status || r.status;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (fFloor !== 'all' && String(r.floor) !== fFloor) return false;
      if (fType !== 'all' && r.room_type !== fType) return false;
      if (fStatus !== 'all') {
        if (fStatus === 'available' && status !== 'Available') return false;
        if (fStatus === 'occupied' && status !== 'Occupied') return false;
        if (fStatus === 'maintenance' && status !== 'Maintenance') return false;
      }
      return true;
    });

    const totalPages = Math.ceil(filteredRooms.length / ITEMS_PER_PAGE) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedRooms = filteredRooms.slice(startIndex, endIndex);

    roomGrid.innerHTML = '';

    if (currentView === 'list') {
      roomGrid.className = 'flex flex-col gap-3.5';
    } else {
      roomGrid.className = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5';
    }

    paginatedRooms.forEach(r => {
      let status = r.live_status || r.status;
      const isUnavailable = status === 'Maintenance' || status === 'Occupied';
      
      let actionBtn = '';
      if (isUnavailable) {
        actionBtn = `<button disabled class="w-full sm:w-auto inline-flex items-center justify-center px-6 py-2 rounded-lg bg-gray-100 text-gray-400 text-xs font-semibold cursor-not-allowed min-w-[100px]" type="button">Unavailable</button>`;
      } else if (currentRole === 'staff' || currentRole === 'admin') {
        actionBtn = `<div class="w-full sm:w-auto inline-flex items-center justify-center px-5 py-2 rounded-lg bg-gray-100 text-gray-600 text-xs font-semibold min-w-[100px]">View Only</div>`;
      } else {
        actionBtn = `<a href="book-room.html?room_id=${r.room_id}" class="w-full sm:w-auto inline-flex items-center justify-center px-6 py-2 rounded-lg bg-[#7A1F2B] hover:bg-[#5e1821] text-white text-xs font-semibold transition-colors shadow-xs min-w-[100px]">Reserve</a>`;
      }

      if (currentView === 'list') {
        const row = document.createElement('div');
        row.className = 'room-row bg-white rounded-2xl shadow-xs border border-gray-100/90 hover:shadow-sm transition-all p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4';
        row.innerHTML = `
          <!-- Left: Icon + Title + Features -->
          <div class="flex items-center gap-4 min-w-[280px]">
            <div class="w-12 h-12 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 text-gray-500">
              <span class="material-symbols-outlined text-[24px]">${getRoomIcon(r)}</span>
            </div>
            <div class="flex flex-col">
              <h3 class="text-base font-bold text-gray-900 leading-snug">${r.name}</h3>
              <p class="text-xs text-gray-500 mt-0.5">${getRoomFeatures(r)}</p>
            </div>
          </div>

          <!-- Middle: Capacity & Location -->
          <div class="flex flex-col gap-1 min-w-[160px]">
            <div class="flex items-center gap-1.5 text-xs text-gray-600 font-medium">
              <span class="material-symbols-outlined text-[16px] text-gray-400">group</span>
              <span>${r.capacity} Seats Capacity</span>
            </div>
            <div class="flex items-center gap-1.5 text-xs text-gray-500">
              <span class="material-symbols-outlined text-[16px] text-gray-400">location_on</span>
              <span>${getRoomLocation(r)}</span>
            </div>
          </div>

          <!-- Status -->
          <div class="flex items-center min-w-[140px]">
            ${getStatusBadge(status, r.next_available)}
          </div>

          <!-- Action -->
          <div class="flex items-center md:justify-end min-w-[120px]">
            ${actionBtn}
          </div>
        `;
        roomGrid.appendChild(row);
      } else {
        const card = document.createElement('div');
        card.className = 'room-card bg-white rounded-2xl shadow-xs border border-gray-100/90 hover:shadow-sm transition-all p-5 flex flex-col justify-between h-full gap-4';
        card.innerHTML = `
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-3">
              <div class="w-11 h-11 rounded-xl bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 text-gray-500">
                <span class="material-symbols-outlined text-[22px]">${getRoomIcon(r)}</span>
              </div>
              <div>
                <h3 class="text-base font-bold text-gray-900 leading-snug">${r.name}</h3>
                <p class="text-xs text-gray-500 mt-0.5">${getRoomFeatures(r)}</p>
              </div>
            </div>
            ${getStatusBadge(status, r.next_available)}
          </div>
          <div class="flex items-center justify-between text-xs text-gray-500 pt-2 border-t border-gray-50">
            <span class="flex items-center gap-1 text-gray-600 font-medium">
              <span class="material-symbols-outlined text-[16px] text-gray-400">group</span>
              ${r.capacity} Seats
            </span>
            <span class="flex items-center gap-1">
              <span class="material-symbols-outlined text-[16px] text-gray-400">location_on</span>
              ${getRoomLocation(r)}
            </span>
          </div>
          <div class="pt-1">
            ${actionBtn}
          </div>
        `;
        roomGrid.appendChild(card);
      }
    });

    if (visibleCount) visibleCount.textContent = filteredRooms.length;
    if (totalCount) totalCount.textContent = allRooms.length;

    if (filteredRooms.length === 0) {
      noResults.classList.remove('hidden');
      noResults.classList.add('flex');
    } else {
      noResults.classList.add('hidden');
      noResults.classList.remove('flex');
    }

    // Update Pagination UI
    if (paginationControls) {
      if (totalPages > 1) {
        paginationControls.classList.remove('hidden');
        paginationControls.classList.add('flex');
        pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;

        prevPageBtn.disabled = currentPage === 1;
        nextPageBtn.disabled = currentPage === totalPages;
      } else {
        paginationControls.classList.add('hidden');
        paginationControls.classList.remove('flex');
      }
    }
  }

  function handleFilterChange() {
    currentPage = 1;
    renderRooms();
  }

  searchInput.addEventListener('input', handleFilterChange);
  floorFilter.addEventListener('change', handleFilterChange);
  roomTypeFilter.addEventListener('change', handleFilterChange);
  statusFilter.addEventListener('change', handleFilterChange);

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      floorFilter.value = 'all';
      roomTypeFilter.value = 'all';
      statusFilter.value = 'all';
      handleFilterChange();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      searchInput.value = '';
      floorFilter.value = 'all';
      roomTypeFilter.value = 'all';
      statusFilter.value = 'all';
      handleFilterChange();
    });
  }

  if (listViewBtn && gridViewBtn) {
    listViewBtn.addEventListener('click', () => {
      currentView = 'list';
      listViewBtn.className = 'p-1.5 rounded-lg bg-white shadow-xs text-gray-800 flex items-center justify-center transition-all';
      gridViewBtn.className = 'p-1.5 rounded-lg text-gray-400 hover:text-gray-700 flex items-center justify-center transition-all';
      renderRooms();
    });
    gridViewBtn.addEventListener('click', () => {
      currentView = 'grid';
      gridViewBtn.className = 'p-1.5 rounded-lg bg-white shadow-xs text-gray-800 flex items-center justify-center transition-all';
      listViewBtn.className = 'p-1.5 rounded-lg text-gray-400 hover:text-gray-700 flex items-center justify-center transition-all';
      renderRooms();
    });
  }

  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        currentPage--;
        renderRooms();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
      currentPage++;
      renderRooms();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  fetchCurrentRole().then(fetchRooms);
});
