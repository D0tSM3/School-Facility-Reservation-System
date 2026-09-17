/**
 * CampusRoom — Customer Dashboard & Space Catalog
 * Handles room filtering, search, equipment lookup, and quick reservation redirection.
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const DB = window.CampusRoomDB;
  if (!DB) return;

  const searchInput = document.getElementById('roomSearchInput');
  const buildingFilter = document.getElementById('buildingFilter');
  const capacityFilter = document.getElementById('capacityFilter');
  const statusFilter = document.getElementById('statusFilter');
  const roomGrid = document.getElementById('roomGrid');
  const visibleCountEl = document.getElementById('visibleRoomsCount');
  const noResultsNotice = document.getElementById('noResultsNotice');
  const resetBtn = document.getElementById('resetFilters');
  const clearAllBtn = document.getElementById('clearAllFiltersBtn');
  const quickReserveBtn = document.getElementById('quickReserveBtn');
  const newRequestBtn = document.getElementById('newRequestBtn');

  function renderRooms() {
    if (!roomGrid) return;

    const query = (searchInput ? searchInput.value : '').trim().toLowerCase();
    const building = buildingFilter ? buildingFilter.value : 'all';
    const capacity = capacityFilter ? capacityFilter.value : 'any';
    const status = statusFilter ? statusFilter.value : 'all';

    let visibleCount = 0;
    const cards = document.querySelectorAll('.room-card');

    cards.forEach(card => {
      const cardBuilding = card.getAttribute('data-building') || '';
      const cardStatus = card.getAttribute('data-status') || '';
      const cardCap = parseInt(card.getAttribute('data-capacity') || '0', 10);
      const cardText = card.textContent.toLowerCase();

      const matchesQuery = !query || cardText.includes(query);
      const matchesBuilding = (building === 'all') || (cardBuilding === building);
      const matchesStatus = (status === 'all') || (cardStatus.toLowerCase() === status.toLowerCase());

      let matchesCapacity = true;
      if (capacity === 'small') matchesCapacity = (cardCap <= 30);
      else if (capacity === 'medium') matchesCapacity = (cardCap >= 31 && cardCap <= 60);
      else if (capacity === 'large') matchesCapacity = (cardCap > 60);

      if (matchesQuery && matchesBuilding && matchesStatus && matchesCapacity) {
        card.classList.remove('hidden');
        visibleCount++;
      } else {
        card.classList.add('hidden');
      }
    });

    if (visibleCountEl) {
      visibleCountEl.textContent = visibleCount.toString();
    }

    if (noResultsNotice) {
      if (visibleCount === 0) {
        noResultsNotice.classList.remove('hidden');
        noResultsNotice.classList.add('flex');
      } else {
        noResultsNotice.classList.add('hidden');
        noResultsNotice.classList.remove('flex');
      }
    }
  }

  function resetAll() {
    if (searchInput) searchInput.value = '';
    if (buildingFilter) buildingFilter.value = 'all';
    if (capacityFilter) capacityFilter.value = 'any';
    if (statusFilter) statusFilter.value = 'all';
    renderRooms();
  }

  // Event Listeners
  if (searchInput) searchInput.addEventListener('input', renderRooms);
  if (buildingFilter) buildingFilter.addEventListener('change', renderRooms);
  if (capacityFilter) capacityFilter.addEventListener('change', renderRooms);
  if (statusFilter) statusFilter.addEventListener('change', renderRooms);
  if (resetBtn) resetBtn.addEventListener('click', resetAll);
  if (clearAllBtn) clearAllBtn.addEventListener('click', resetAll);

  // Quick Reserve Button -> Redirect to book a room
  if (quickReserveBtn) {
    quickReserveBtn.addEventListener('click', () => {
      window.location.href = 'book-room.html';
    });
  }

  if (newRequestBtn) {
    newRequestBtn.addEventListener('click', () => {
      window.location.href = 'book-room.html';
    });
  }

  // Wire up all "Book Facility" buttons on individual room cards
  const bookCardButtons = document.querySelectorAll('.btn-book-room');
  bookCardButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const roomId = btn.getAttribute('data-room-id') || 'THN-204';
      window.location.href = `book-room.html?room=${encodeURIComponent(roomId)}`;
    });
  });

  renderRooms();
});
