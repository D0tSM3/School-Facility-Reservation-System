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
  
  const paginationControls = document.getElementById('paginationControls');
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  const pageIndicator = document.getElementById('pageIndicator');

  if (!roomGrid) return;

  const BASE = window.location.pathname.replace(/[^\/]*$/, '');
  let allRooms = [];
  let currentRole = null;

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

  function getStatusColor(status) {
    if (status === 'Available') return 'bg-[#16A34A]';
    if (status === 'Occupied') return 'bg-[#D97706]';
    return 'bg-[#64748B]'; 
  }

  function getStatusBadge(status) {
    if (status === 'Available') {
      return `<span class="px-space-xs py-0.5 rounded bg-[#DCFCE7] text-[#15803D] font-label-sm text-label-sm font-semibold flex items-center gap-1 shrink-0"><span class="w-1.5 h-1.5 rounded-full bg-[#16A34A]"></span>Available</span>`;
    }
    if (status === 'Occupied') {
      return `<span class="px-space-xs py-0.5 rounded bg-[#FEF3C7] text-[#B45309] font-label-sm text-label-sm font-semibold flex items-center gap-1 shrink-0"><span class="w-1.5 h-1.5 rounded-full bg-[#D97706]"></span>Occupied</span>`;
    }
    return `<span class="px-space-xs py-0.5 rounded bg-[#F1F5F9] text-[#475569] font-label-sm text-label-sm font-semibold flex items-center gap-1 shrink-0"><span class="w-1.5 h-1.5 rounded-full bg-[#64748B]"></span>Maintenance</span>`;
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
      if (fStatus !== 'all' && status.toLowerCase() !== fStatus) return false;
      return true;
    });

    const totalPages = Math.ceil(filteredRooms.length / ITEMS_PER_PAGE) || 1;
    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const endIndex = startIndex + ITEMS_PER_PAGE;
    const paginatedRooms = filteredRooms.slice(startIndex, endIndex);

    roomGrid.innerHTML = '';

    paginatedRooms.forEach(r => {
      let status = r.live_status || r.status;
      const nextAvailText = (r.next_available && r.next_available !== 'Available now') 
        ? `<div class="p-2 rounded bg-surface-container font-body-sm text-body-sm text-on-surface"><div class="flex items-center gap-1 font-semibold text-secondary"><span class="material-symbols-outlined text-[16px]">schedule</span><span>Next available at: ${new Date(r.next_available).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span></div></div>`
        : '';

      const card = document.createElement('div');
      card.className = `room-card group bg-surface-container-lowest rounded shadow-sm hover:shadow-md transition-shadow relative overflow-hidden flex flex-col justify-between ${status === 'Maintenance' ? 'opacity-90' : ''}`;
      
      card.innerHTML = `
        <div class="absolute left-0 top-0 bottom-0 w-[4px] ${getStatusColor(status)}"></div>
        <div class="p-space-md pl-[calc(1rem+4px)] flex flex-col gap-space-sm h-full">
          <div class="flex items-start justify-between gap-space-xs">
            <div>
              <span class="font-label-sm text-label-sm uppercase tracking-wider text-secondary">${r.room_type || 'General Space'}</span>
              <p class="font-headline-sm text-headline-sm text-on-surface leading-tight">${r.name}</p>
            </div>
            ${getStatusBadge(status)}
          </div>
          ${nextAvailText}
          <div class="flex items-center gap-space-sm text-on-surface-variant font-body-sm text-body-sm pt-1 mt-auto">
            <span class="flex items-center gap-1 font-medium text-on-surface">
              <span class="material-symbols-outlined text-[16px] text-secondary">group</span>
              ${r.capacity} Seats
            </span>
            <span>•</span>
            <span class="truncate">Floor ${r.floor !== null ? r.floor : 'N/A'}</span>
          </div>
        </div>
        <div class="p-space-md pl-[calc(1rem+4px)] pt-0">
          ${status === 'Maintenance' 
            ? `<button class="w-full py-2 px-space-sm bg-surface-container-high text-on-tertiary-container cursor-not-allowed font-label-lg text-label-lg rounded flex items-center justify-center gap-1" disabled type="button"><span class="material-symbols-outlined text-[18px]">block</span><span>Unavailable</span></button>`
            : status === 'Occupied'
            ? `<button class="w-full py-2 px-space-sm bg-surface-container-high text-on-tertiary-container cursor-not-allowed font-label-lg text-label-lg rounded flex items-center justify-center gap-1" disabled type="button"><span class="material-symbols-outlined text-[18px]">event_busy</span><span>Currently Booked</span></button>`
            : (currentRole === 'staff' || currentRole === 'admin')
            ? `<div class="w-full py-2 px-space-sm bg-surface-container text-on-surface-variant font-label-lg text-label-lg rounded flex items-center justify-center gap-1"><span class="material-symbols-outlined text-[18px]">visibility</span><span>View Only</span></div>`
            : `<a href="book-room.html?room_id=${r.room_id}" class="w-full py-2 px-space-sm bg-primary-container hover:bg-primary text-on-primary font-label-lg text-label-lg rounded transition-colors flex items-center justify-center gap-1"><span class="material-symbols-outlined text-[18px]">calendar_today</span><span>Book This Room</span></a>`
          }
        </div>
      `;
      roomGrid.appendChild(card);
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
