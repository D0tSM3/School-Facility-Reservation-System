/**
 * CampusRoom — Unified Admin Management Dashboard Logic
 * Buenavista Polytechnic University
 *
 * Full super-user operations over Facilities, Reservations, Users,
 * Conflict Override Requests, Class Schedules, Holidays, System Settings,
 * and Audit Trails. Zero external frameworks.
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // Base path resolution for relative subdirectory support
  const BASE = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);

  // Global State
  const state = {
    currentUser: null,
    activeView: 'overview',
    activeResSubtab: 'all',
    activeSysSubtab: 'classes',
    facilityViewMode: 'table', // 'table' | 'grid'
    rooms: [],
    reservations: [],
    moveRequests: [],
    cancelRequests: [],
    overrideRequests: [],
    settings: null,
    users: [],
    classes: [],
    holidays: [],
    archives: [],
    archiveStats: { total: 0, classschedules: 0, holidays: 0, reservations: 0 },
    logs: [],
    logsTotal: 0,
    logsLimit: 25,
    logsOffset: 0,
  };

  // =========================================================================
  // 1. SECURITY & UTILITY HELPERS
  // =========================================================================

  /**
   * HTML escape helper to prevent Cross-Site Scripting (XSS)
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getInitials(name) {
    if (!name) return 'AD';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function formatDateTime(str) {
    if (!str) return '—';
    const d = new Date(str);
    if (isNaN(d.getTime())) return escapeHtml(str);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  function formatDate(str) {
    if (!str) return '—';
    const d = new Date(str);
    if (isNaN(d.getTime())) return escapeHtml(str);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function formatTime(str) {
    if (!str) return '—';
    // If it's like "HH:MM:SS" or "HH:MM"
    if (str.length <= 8 && str.includes(':')) {
      const parts = str.split(':');
      let h = parseInt(parts[0], 10);
      const m = parts[1];
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${h}:${m} ${ampm}`;
    }
    const d = new Date(str);
    if (isNaN(d.getTime())) return escapeHtml(str);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  function formatRange(startStr, endStr) {
    if (!startStr || !endStr) return '—';
    const sDate = formatDate(startStr);
    const sTime = formatTime(startStr);
    const eTime = formatTime(endStr);
    return `${sDate}, ${sTime} – ${eTime}`;
  }

  /**
   * Non-blocking Toast notification system
   */
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-xl shadow-xl border text-xs font-semibold transform transition-all duration-300 translate-y-3 opacity-0';

    let icon = 'info';
    if (type === 'success') {
      icon = 'check_circle';
      toast.classList.add('bg-emerald-900', 'text-white', 'border-emerald-700');
    } else if (type === 'error') {
      icon = 'error';
      toast.classList.add('bg-red-900', 'text-white', 'border-red-700');
    } else {
      toast.classList.add('bg-gray-900', 'text-white', 'border-gray-700');
    }

    toast.innerHTML = `
      <span class="material-symbols-outlined text-[19px] shrink-0">${icon}</span>
      <span class="flex-1 leading-normal">${escapeHtml(message)}</span>
      <button type="button" class="text-white/60 hover:text-white p-0.5 rounded transition-colors" aria-label="Close">
        <span class="material-symbols-outlined text-[16px]">close</span>
      </button>
    `;

    toast.querySelector('button').addEventListener('click', () => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 250);
    });

    container.appendChild(toast);

    // Entrance animation
    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-3', 'opacity-0');
    });

    // Auto dismiss after 4 seconds
    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.add('opacity-0', 'translate-y-2');
        setTimeout(() => toast.remove(), 250);
      }
    }, 4200);
  }

  /**
   * Generic Modal Control
   */
  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove('opacity-0', 'pointer-events-none');
    modal.classList.add('opacity-100', 'pointer-events-auto');
    const inner = modal.querySelector('div[class*="rounded-2xl"]');
    if (inner) {
      inner.classList.remove('scale-95');
      inner.classList.add('scale-100');
    }
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add('opacity-0', 'pointer-events-none');
    modal.classList.remove('opacity-100', 'pointer-events-auto');
    const inner = modal.querySelector('div[class*="rounded-2xl"]');
    if (inner) {
      inner.classList.remove('scale-100');
      inner.classList.add('scale-95');
    }
  }

  // Setup modal dismiss buttons and backdrop clicks
  document.querySelectorAll('[data-modal-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-modal-close');
      closeModal(targetId);
    });
  });

  document.querySelectorAll('div[id$="Modal"]').forEach(modalOverlay => {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) {
        closeModal(modalOverlay.id);
      }
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('div[id$="Modal"].opacity-100').forEach(m => closeModal(m.id));
    }
  });

  /**
   * Generic Confirmation Promise Modal
   */
  function confirmAction({ title, message, proceedText = 'Proceed', icon = 'warning', isDestructive = true }) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirmModal');
      const titleEl = document.getElementById('confirmModalTitle');
      const msgEl = document.getElementById('confirmModalMessage');
      const proceedBtn = document.getElementById('confirmModalProceedBtn');
      const cancelBtn = document.getElementById('confirmModalCancelBtn');
      const iconEl = document.getElementById('confirmModalIcon');
      const iconContainer = document.getElementById('confirmModalIconContainer');

      titleEl.textContent = title;
      msgEl.textContent = message;
      proceedBtn.textContent = proceedText;
      iconEl.textContent = icon;

      if (isDestructive) {
        proceedBtn.className = 'flex-1 px-4 py-2.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-xl shadow-sm transition-all';
        iconContainer.className = 'w-12 h-12 rounded-full bg-red-50 text-red-600 mx-auto flex items-center justify-center mb-4';
      } else {
        proceedBtn.className = 'flex-1 px-4 py-2.5 text-xs font-bold text-white bg-[#7a1f2b] hover:bg-[#5b0617] rounded-xl shadow-sm transition-all';
        iconContainer.className = 'w-12 h-12 rounded-full bg-amber-50 text-amber-600 mx-auto flex items-center justify-center mb-4';
      }

      openModal('confirmModal');

      const onProceed = () => {
        cleanup();
        closeModal('confirmModal');
        resolve(true);
      };

      const onCancel = () => {
        cleanup();
        closeModal('confirmModal');
        resolve(false);
      };

      function cleanup() {
        proceedBtn.removeEventListener('click', onProceed);
        cancelBtn.removeEventListener('click', onCancel);
      }

      proceedBtn.addEventListener('click', onProceed);
      cancelBtn.addEventListener('click', onCancel);
    });
  }

  /**
   * Standardized REST API Request Wrapper
   */
  async function apiFetch(endpoint, options = {}) {
    const defaultHeaders = {
      'Accept': 'application/json',
    };
    if (options.body && typeof options.body === 'string') {
      defaultHeaders['Content-Type'] = 'application/json';
    }

    const config = {
      ...options,
      credentials: 'same-origin',
      headers: {
        ...defaultHeaders,
        ...(options.headers || {}),
      },
    };

    try {
      const response = await fetch(BASE + endpoint, config);
      if (response.status === 401) {
        // Unauthenticated session -> return to login
        window.location.href = 'index.html';
        return null;
      }

      const json = await response.json();
      if (!response.ok || (json && json.success === false)) {
        const errorMsg = (json && json.error) ? json.error : `Request failed with status ${response.status}`;
        throw new Error(errorMsg);
      }

      // Handle standard Response::json envelope { success: true, data: ... }
      if (json && typeof json === 'object' && 'data' in json && json.data !== undefined) {
        return json.data;
      }
      return json;
    } catch (err) {
      console.error(`[API Error] ${endpoint}:`, err);
      throw err;
    }
  }

  // =========================================================================
  // 2. AUTHENTICATION & SUPERUSER SESSION GUARD
  // =========================================================================

  async function checkAdminAuth() {
    try {
      const user = await apiFetch('api/auth/me');
      if (!user) return false;

      if (user.role !== 'Admin') {
        alert('Access Restricted: This dashboard requires institutional Administrator privileges.');
        window.location.href = user.role === 'Staff' ? 'staff-dashboard.html' : 'dashboard.html';
        return false;
      }

      state.currentUser = user;

      // Update sidebar & header profile pills
      const initials = getInitials(user.name);
      const avatarEl = document.getElementById('adminAvatarInitials');
      if (avatarEl) avatarEl.textContent = initials;

      const nameEl = document.getElementById('adminUserName');
      if (nameEl) nameEl.textContent = user.name;

      const emailEl = document.getElementById('adminUserEmail');
      if (emailEl) emailEl.textContent = user.email;

      const overviewNameEl = document.getElementById('overviewAdminName');
      if (overviewNameEl) overviewNameEl.textContent = user.name;

      // Set today's date in header
      const today = new Date();
      const dateEl = document.getElementById('headerDateDisplay');
      if (dateEl) {
        dateEl.textContent = today.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
      }

      return true;
    } catch (err) {
      console.error('Session authentication failed:', err);
      window.location.href = 'index.html';
      return false;
    }
  }

  // Logout Handler (support both #logoutBtn and #btn-logout)
  async function performLogout() {
    const ok = await confirmAction({
      title: 'Sign Out of CampusRoom',
      message: 'Are you sure you want to end your active administrator session?',
      proceedText: 'Sign Out',
      icon: 'logout',
      isDestructive: false,
    });
    if (!ok) return;

    try {
      await apiFetch('api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.warn('Logout error ignored:', err);
    } finally {
      localStorage.removeItem('campus_role');
      window.location.href = 'index.html';
    }
  }

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', performLogout);

  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) btnLogout.addEventListener('click', performLogout);

  // =========================================================================
  // 3. NAVIGATION & VIEWPORT ROUTING
  // =========================================================================

  const viewTitles = {
    overview: 'Overview & KPIs',
    facilities: 'Facilities & Rooms Directory',
    reservations: 'Reservations Master Management',
    'approval-queue': 'Pending Approvals Queue',
    moves: 'Reservation Move Requests',
    cancels: 'Reservation Cancellation Requests',
    overrides: 'Conflict Override Requests Queue',
    users: 'Institutional User Directory',
    classes: 'Recurring Academic Class Schedules',
    holidays: 'University Holidays & Campus Closures',
    archives: 'Data Archives & 30-Day Retention Repository',
    config: 'Operating Hours & Reservation Policy Settings',
    logs: 'System Audit Logs & Security History',
  };

  const hashToView = {
    '#overview': 'overview',
    '#dashboard': 'overview',
    '#reservations': 'reservations',
    '#staff-queue': 'approval-queue',
    '#approval-queue': 'approval-queue',
    '#move-requests': 'moves',
    '#moves': 'moves',
    '#cancellations': 'cancels',
    '#cancels': 'cancels',
    '#overrides': 'overrides',
    '#rooms': 'facilities',
    '#facilities': 'facilities',
    '#classes': 'classes',
    '#holidays': 'holidays',
    '#archives': 'archives',
    '#users': 'users',
    '#config': 'config',
    '#logs': 'logs',
  };

  const viewToHash = {
    overview: '#overview',
    facilities: '#rooms',
    reservations: '#reservations',
    'approval-queue': '#staff-queue',
    moves: '#move-requests',
    cancels: '#cancellations',
    overrides: '#overrides',
    users: '#users',
    classes: '#classes',
    holidays: '#holidays',
    archives: '#archives',
    config: '#config',
    logs: '#logs',
  };

  function switchView(viewName) {
    if (!viewTitles[viewName]) return;
    state.activeView = viewName;

    // Synchronize URL hash seamlessly without page reload
    if (viewToHash[viewName] && window.location.hash !== viewToHash[viewName]) {
      history.replaceState(null, '', viewToHash[viewName]);
    }

    // Update Sidebar Navigation buttons
    document.querySelectorAll('.nav-item').forEach(btn => {
      const navTarget = btn.getAttribute('data-nav');
      if (navTarget === viewName) {
        btn.classList.add('active-nav-link');
      } else {
        btn.classList.remove('active-nav-link');
      }
    });

    // Update Header title
    const headerTitle = document.getElementById('headerViewTitle');
    if (headerTitle) headerTitle.textContent = viewTitles[viewName];

    // Toggle Viewports
    document.querySelectorAll('.dashboard-view').forEach(view => {
      view.classList.add('hidden');
    });

    const targetSection = document.getElementById(`view-${viewName}`);
    if (targetSection) {
      targetSection.classList.remove('hidden');
    }

    // Trigger tab-specific refresh
    if (viewName === 'overview') renderOverview();
    if (viewName === 'facilities') renderFacilities();
    if (viewName === 'reservations') renderReservations();
    if (viewName === 'approval-queue') renderApprovalQueue();
    if (viewName === 'moves') renderMovesTable();
    if (viewName === 'cancels') renderCancelsTable();
    if (viewName === 'overrides') renderOverridesTable();
    if (viewName === 'users') renderUsers();
    if (viewName === 'classes') loadClasses();
    if (viewName === 'holidays') loadHolidays();
    if (viewName === 'archives') loadArchives();
    if (viewName === 'config') renderSystemSettings();
    if (viewName === 'logs') loadAuditLogs();
  }

  // Handle URL hash changes (back/forward navigation)
  window.addEventListener('hashchange', () => {
    const hash = window.location.hash;
    if (hash && hashToView[hash]) {
      switchView(hashToView[hash]);
    }
  });

  // Check initial hash on boot
  if (window.location.hash && hashToView[window.location.hash]) {
    state.activeView = hashToView[window.location.hash];
  }

  document.querySelectorAll('[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-nav');
      switchView(target);
    });
  });

  // Jump buttons on KPI cards
  document.querySelectorAll('[data-jump-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      const nav = btn.getAttribute('data-jump-nav');
      const filter = btn.getAttribute('data-jump-filter');
      const subtab = btn.getAttribute('data-jump-subtab');

      switchView(nav);

      if (nav === 'reservations') {
        if (subtab) {
          switchResSubtab(subtab);
        } else if (filter) {
          switchResSubtab(filter);
        }
      }
    });
  });

  // Quick Action Buttons on Overview banner
  const quickAddRoomBtn = document.getElementById('quickAddRoomBtn');
  if (quickAddRoomBtn) {
    quickAddRoomBtn.addEventListener('click', () => {
      openModal('addFacilityModal');
    });
  }

  const quickAddClassBtn = document.getElementById('quickAddClassBtn');
  if (quickAddClassBtn) {
    quickAddClassBtn.addEventListener('click', () => {
      openModal('addClassModal');
    });
  }

  // Global Sync / Refresh Button
  const btnRefresh = document.getElementById('btn-refresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      showToast('Refreshing system state...', 'info');
      await loadAllData();
      showToast('System data successfully synchronized.', 'success');
    });
  }

  function updateAllCounters() {
    const pendingCount = state.reservations.filter(r => r.status === 'Pending').length;
    const movesCount = state.moveRequests.filter(m => m.status === 'Pending').length;
    const cancelsCount = state.cancelRequests.filter(c => c.status === 'Pending').length;
    const overridesCount = state.overrideRequests.filter(o => o.status === 'Pending').length;

    // Sidebar badge counters
    const facBadge = document.getElementById('badge-facilities-count');
    if (facBadge) facBadge.textContent = state.rooms.length;

    const userBadge = document.getElementById('badge-users-count');
    if (userBadge) userBadge.textContent = state.users.length;

    const approvalQueueBadge = document.getElementById('badge-approval-queue-count');
    if (approvalQueueBadge) {
      if (pendingCount > 0) {
        approvalQueueBadge.textContent = pendingCount;
        approvalQueueBadge.classList.remove('hidden');
      } else {
        approvalQueueBadge.classList.add('hidden');
      }
    }

    const pendingBadge = document.getElementById('badge-pending-count');
    if (pendingBadge) {
      if (pendingCount > 0) {
        pendingBadge.textContent = pendingCount;
        pendingBadge.classList.remove('hidden');
      } else {
        pendingBadge.classList.add('hidden');
      }
    }

    const movesBadge = document.getElementById('badge-moves-count');
    if (movesBadge) {
      if (movesCount > 0) {
        movesBadge.textContent = movesCount;
        movesBadge.classList.remove('hidden');
      } else {
        movesBadge.classList.add('hidden');
      }
    }

    const cancelsBadge = document.getElementById('badge-cancels-count');
    if (cancelsBadge) {
      if (cancelsCount > 0) {
        cancelsBadge.textContent = cancelsCount;
        cancelsBadge.classList.remove('hidden');
      } else {
        cancelsBadge.classList.add('hidden');
      }
    }

    const overridesBadge = document.getElementById('badge-overrides-count');
    if (overridesBadge) {
      if (overridesCount > 0) {
        overridesBadge.textContent = overridesCount;
        overridesBadge.classList.remove('hidden');
      } else {
        overridesBadge.classList.add('hidden');
      }
    }

    const archivesBadge = document.getElementById('badge-archives-count');
    if (archivesBadge) {
      const archivesTotal = state.archiveStats?.total ?? state.archives.length ?? 0;
      archivesBadge.textContent = archivesTotal;
    }

    // View badges
    const headerQueueBadge = document.getElementById('approvalQueueHeaderBadge');
    if (headerQueueBadge) {
      headerQueueBadge.textContent = `${pendingCount} Pending`;
    }

    const kpiPending = document.getElementById('kpi-pending-total');
    if (kpiPending) kpiPending.textContent = pendingCount;
  }

  // =========================================================================
  // 4. DATA LOADER CONTROLLER
  // =========================================================================

  async function loadAllData() {
    try {
      const [rooms, reservations, moveReqs, cancelReqs, overrideReqs, users, settings, archivesRes] = await Promise.all([
        apiFetch('api/rooms').catch(() => []),
        apiFetch('api/reservations').catch(() => []),
        apiFetch('api/reservations/move-requests').catch(() => []),
        apiFetch('api/reservations/cancel-requests').catch(() => []),
        apiFetch('api/conflict-override-requests').catch(() => []),
        apiFetch('api/users').catch(() => []),
        apiFetch('api/settings').catch(() => null),
        apiFetch('api/archives').catch(() => null),
      ]);

      state.rooms = Array.isArray(rooms) ? rooms : [];
      state.reservations = Array.isArray(reservations) ? reservations : [];
      state.moveRequests = Array.isArray(moveReqs) ? moveReqs : [];
      state.cancelRequests = Array.isArray(cancelReqs) ? cancelReqs : [];
      state.overrideRequests = Array.isArray(overrideReqs) ? overrideReqs : [];
      state.users = Array.isArray(users) ? users : [];
      state.settings = settings;

      if (archivesRes && archivesRes.data) {
        state.archives = archivesRes.data.items || [];
        state.archiveStats = archivesRes.data.stats || { total: 0, classschedules: 0, holidays: 0, reservations: 0 };
      }

      updateAllCounters();

      // Render whichever view is currently active
      switchView(state.activeView);
    } catch (err) {
      console.error('Error synchronizing data:', err);
      showToast('Error synchronizing data from server.', 'error');
    }
  }

  // =========================================================================
  // 5. MODULE 1: OVERVIEW & ANALYTICS
  // =========================================================================

  function renderOverview() {
    // 1. Calculate KPI Metrics
    const pendingTotal = state.reservations.filter(r => r.status === 'Pending').length;
    const pendingMoves = state.moveRequests.filter(m => m.status === 'Pending').length;
    const pendingCancels = state.cancelRequests.filter(c => c.status === 'Pending').length;
    const pendingOverrides = state.overrideRequests.filter(o => o.status === 'Pending').length;
    const activeRooms = state.rooms.filter(r => r.is_active && r.status === 'Available').length;
    const maintenanceRooms = state.rooms.filter(r => r.status === 'Maintenance').length;

    const elKpiPending = document.getElementById('kpi-pending-total');
    if (elKpiPending) elKpiPending.textContent = pendingTotal;

    const elKpiMoves = document.getElementById('kpi-moves-total');
    if (elKpiMoves) elKpiMoves.textContent = pendingMoves;

    const elKpiCancels = document.getElementById('kpi-cancels-total');
    if (elKpiCancels) elKpiCancels.textContent = pendingCancels;

    const elKpiOverrides = document.getElementById('kpi-overrides-total');
    if (elKpiOverrides) elKpiOverrides.textContent = pendingOverrides;

    const elKpiRooms = document.getElementById('kpi-rooms-total');
    if (elKpiRooms) elKpiRooms.textContent = activeRooms;

    const elMaintNote = document.getElementById('kpi-rooms-maintenance-note');
    if (elMaintNote) elMaintNote.textContent = `${maintenanceRooms} in maintenance`;

    const elKpiUsers = document.getElementById('kpi-users-total');
    if (elKpiUsers) elKpiUsers.textContent = state.users.length;

    // 2. Reservation Category Breakdown
    const categories = ['Academic Lecture', 'Faculty Defense', 'Student Org Meeting', 'Dept Workshop', 'Exam/Quiz'];
    const catCounts = {};
    categories.forEach(c => catCounts[c] = 0);
    state.reservations.forEach(r => {
      if (catCounts[r.category] !== undefined) {
        catCounts[r.category]++;
      }
    });

    const totalReservations = Math.max(state.reservations.length, 1);
    const catContainer = document.getElementById('categoryStatsList');
    if (catContainer) {
      catContainer.innerHTML = categories.map(cat => {
        const count = catCounts[cat] || 0;
        const pct = Math.round((count / totalReservations) * 100);
        return `
          <div>
            <div class="flex justify-between items-center text-xs font-semibold mb-1">
              <span class="text-gray-700">${escapeHtml(cat)}</span>
              <span class="text-gray-900">${count} <span class="text-gray-400 font-normal">(${pct}%)</span></span>
            </div>
            <div class="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
              <div class="h-full bg-[#7a1f2b] rounded-full transition-all duration-500" style="width: ${pct}%"></div>
            </div>
          </div>
        `;
      }).join('');
    }

    // 3. Facility Status Breakdown
    const totalFacilities = Math.max(state.rooms.length, 1);
    const availableCount = state.rooms.filter(r => r.is_active && r.status === 'Available').length;
    const maintCount = state.rooms.filter(r => r.is_active && r.status === 'Maintenance').length;
    const inactiveCount = state.rooms.filter(r => !r.is_active).length;

    const availPct = Math.round((availableCount / totalFacilities) * 100);
    const maintPct = Math.round((maintCount / totalFacilities) * 100);
    const inactPct = Math.round((inactiveCount / totalFacilities) * 100);

    const facContainer = document.getElementById('facilityStatusStatsList');
    if (facContainer) {
      facContainer.innerHTML = `
        <div>
          <div class="flex justify-between items-center text-xs font-semibold mb-1">
            <span class="text-emerald-700 flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>Available / Operational</span>
            </span>
            <span class="text-gray-900">${availableCount} <span class="text-gray-400 font-normal">(${availPct}%)</span></span>
          </div>
          <div class="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full bg-emerald-500 rounded-full transition-all" style="width: ${availPct}%"></div>
          </div>
        </div>
        <div>
          <div class="flex justify-between items-center text-xs font-semibold mb-1">
            <span class="text-amber-700 flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-amber-500"></span>
              <span>Under Maintenance</span>
            </span>
            <span class="text-gray-900">${maintCount} <span class="text-gray-400 font-normal">(${maintPct}%)</span></span>
          </div>
          <div class="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full bg-amber-500 rounded-full transition-all" style="width: ${maintPct}%"></div>
          </div>
        </div>
        <div>
          <div class="flex justify-between items-center text-xs font-semibold mb-1">
            <span class="text-gray-600 flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full bg-gray-400"></span>
              <span>Decommissioned / Inactive</span>
            </span>
            <span class="text-gray-900">${inactiveCount} <span class="text-gray-400 font-normal">(${inactPct}%)</span></span>
          </div>
          <div class="h-2 w-full bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full bg-gray-400 rounded-full transition-all" style="width: ${inactPct}%"></div>
          </div>
        </div>
      `;
    }

    // 4. Load recent logs
    loadRecentLogs();
  }

  async function loadRecentLogs() {
    const tbody = document.getElementById('overviewRecentLogsTable');
    if (!tbody) return;
    try {
      const data = await apiFetch('api/logs?limit=6');
      const items = (data && data.items) || [];
      if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-gray-400 text-xs">No recent activity recorded.</td></tr>`;
        return;
      }

      tbody.innerHTML = items.map(l => `
        <tr class="hover:bg-gray-50/70 transition-colors">
          <td class="py-3 px-6 text-xs text-gray-500 whitespace-nowrap">${formatDateTime(l.timestamp)}</td>
          <td class="py-3 px-6 text-xs font-semibold text-gray-800">
            ${escapeHtml(l.user_name || (l.user_id ? l.user_id.substring(0, 8) : 'System'))}
          </td>
          <td class="py-3 px-6 text-xs text-gray-700">${escapeHtml(l.action_type)}</td>
          <td class="py-3 px-6 text-xs font-mono text-gray-400 text-right">
            ${l.reservation_id ? escapeHtml(l.reservation_id.substring(0, 8)) : '—'}
          </td>
        </tr>
      `).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-red-400 text-xs">Failed to load recent activity feed.</td></tr>`;
    }
  }

  // =========================================================================
  // 6. MODULE 2: FACILITIES MANAGEMENT
  // =========================================================================

  function renderFacilities() {
    const typeFilter = document.getElementById('facilityTypeFilter');
    if (typeFilter) {
      const existingTypes = new Set(state.rooms.map(r => r.room_type).filter(Boolean));
      const currentVal = typeFilter.value;
      typeFilter.innerHTML = '<option value="all">All Room Types</option>' +
        Array.from(existingTypes).sort().map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
      typeFilter.value = currentVal;
    }

    filterAndRenderFacilities();
  }

  function filterAndRenderFacilities() {
    const searchInput = document.getElementById('facilitySearchInput');
    const search = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const type = document.getElementById('facilityTypeFilter')?.value || 'all';
    const status = document.getElementById('facilityStatusFilter')?.value || 'all';

    const filtered = state.rooms.filter(room => {
      if (search && !room.name.toLowerCase().includes(search) && !(room.room_type || '').toLowerCase().includes(search)) {
        return false;
      }
      if (type !== 'all' && room.room_type !== type) {
        return false;
      }
      if (status === 'Available' && (room.status !== 'Available' || !room.is_active)) {
        return false;
      }
      if (status === 'Maintenance' && room.status !== 'Maintenance') {
        return false;
      }
      if (status === 'Inactive' && room.is_active) {
        return false;
      }
      return true;
    });

    renderFacilitiesTable(filtered);
    renderFacilitiesGrid(filtered);
  }

  const facilitySearchInput = document.getElementById('facilitySearchInput');
  if (facilitySearchInput) facilitySearchInput.addEventListener('input', filterAndRenderFacilities);

  const facilityTypeFilter = document.getElementById('facilityTypeFilter');
  if (facilityTypeFilter) facilityTypeFilter.addEventListener('change', filterAndRenderFacilities);

  const facilityStatusFilter = document.getElementById('facilityStatusFilter');
  if (facilityStatusFilter) facilityStatusFilter.addEventListener('change', filterAndRenderFacilities);

  // View switch: Table vs Grid
  const btnViewTable = document.getElementById('btn-view-table');
  const btnViewGrid = document.getElementById('btn-view-grid');
  if (btnViewTable && btnViewGrid) {
    btnViewTable.addEventListener('click', () => {
      state.facilityViewMode = 'table';
      document.getElementById('facilitiesTableView')?.classList.remove('hidden');
      document.getElementById('facilitiesGridView')?.classList.add('hidden');
      btnViewTable.className = 'px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white text-gray-900 shadow-sm flex items-center gap-1 transition-all';
      btnViewGrid.className = 'px-2.5 py-1.5 rounded-lg text-xs font-semibold text-gray-500 hover:text-gray-900 flex items-center gap-1 transition-all';
    });

    btnViewGrid.addEventListener('click', () => {
      state.facilityViewMode = 'grid';
      document.getElementById('facilitiesTableView')?.classList.add('hidden');
      document.getElementById('facilitiesGridView')?.classList.remove('hidden');
      btnViewGrid.className = 'px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white text-gray-900 shadow-sm flex items-center gap-1 transition-all';
      btnViewTable.className = 'px-2.5 py-1.5 rounded-lg text-xs font-semibold text-gray-500 hover:text-gray-900 flex items-center gap-1 transition-all';
    });
  }

  function renderFacilitiesTable(rooms) {
    const tbody = document.getElementById('facilitiesTableBody');
    if (!tbody) return;
    if (rooms.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-gray-400 text-xs">No facilities matching current filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = rooms.map(room => {
      const isMaint = room.status === 'Maintenance';
      const statusPill = isMaint
        ? `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">Maintenance</span>`
        : `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">Available</span>`;

      const lifecyclePill = room.is_active
        ? `<span class="text-xs font-semibold text-emerald-600 flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>Active</span>`
        : `<span class="text-xs font-semibold text-gray-400 flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-gray-400"></span>Decommissioned</span>`;

      return `
        <tr class="hover:bg-gray-50/80 transition-colors">
          <td class="py-4 px-6 font-bold text-gray-900 flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-700 shrink-0">
              <span class="material-symbols-outlined text-[18px]">meeting_room</span>
            </div>
            <div>
              <div class="text-sm">${escapeHtml(room.name)}</div>
              <div class="text-[11px] text-gray-400 font-normal">Next: ${escapeHtml(room.next_available || 'Open')}</div>
            </div>
          </td>
          <td class="py-4 px-6 text-xs text-gray-600">
            <span class="font-semibold text-gray-800">${escapeHtml(room.room_type || 'General')}</span>
            <span class="text-gray-400 font-normal"> &bull; Floor ${escapeHtml(room.floor || 1)}</span>
          </td>
          <td class="py-4 px-6 text-xs font-semibold text-gray-700">${escapeHtml(room.capacity)} Seats</td>
          <td class="py-4 px-6">${statusPill}</td>
          <td class="py-4 px-6">${lifecyclePill}</td>
          <td class="py-4 px-6 text-right">
            <div class="inline-flex items-center gap-1.5">
              <button type="button" class="btn-inspect-calendar p-1.5 text-gray-500 hover:text-[#7a1f2b] hover:bg-gray-100 rounded-lg transition-colors" data-id="${room.room_id}" title="Inspect Room Schedule">
                <span class="material-symbols-outlined text-[19px]">calendar_month</span>
              </button>
              <button type="button" class="btn-toggle-maint p-1.5 text-gray-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors" data-id="${room.room_id}" data-status="${room.status}" title="${isMaint ? 'Mark Available' : 'Put Under Maintenance'}">
                <span class="material-symbols-outlined text-[19px]">${isMaint ? 'check_circle' : 'build'}</span>
              </button>
              <button type="button" class="btn-edit-room p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" data-id="${room.room_id}" title="Edit Specifications">
                <span class="material-symbols-outlined text-[19px]">edit</span>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    attachFacilityRowEvents();
  }

  function renderFacilitiesGrid(rooms) {
    const grid = document.getElementById('facilitiesGridView');
    if (!grid) return;
    if (rooms.length === 0) {
      grid.innerHTML = `<div class="col-span-full p-8 text-center text-gray-400 text-xs bg-white rounded-2xl border border-gray-100">No facilities matching current filters.</div>`;
      return;
    }

    grid.innerHTML = rooms.map(room => {
      const isMaint = room.status === 'Maintenance';
      return `
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col justify-between hover:shadow-md transition-shadow">
          <div>
            <div class="flex items-center justify-between mb-3">
              <span class="px-2.5 py-1 rounded-lg text-xs font-bold ${isMaint ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}">
                ${isMaint ? 'Maintenance' : 'Available'}
              </span>
              <span class="text-[11px] font-semibold ${room.is_active ? 'text-gray-500' : 'text-red-500'}">
                ${room.is_active ? 'Active' : 'Decommissioned'}
              </span>
            </div>
            <h3 class="font-bold text-base text-gray-900 leading-snug">${escapeHtml(room.name)}</h3>
            <p class="text-xs text-gray-500 mt-1">${escapeHtml(room.room_type || 'General')} &bull; Floor ${escapeHtml(room.floor || 1)} &bull; ${escapeHtml(room.capacity)} Seats</p>
          </div>
          <div class="pt-4 border-t border-gray-100 mt-5 flex items-center justify-between">
            <button type="button" class="btn-inspect-calendar text-xs font-bold text-[#7a1f2b] hover:underline flex items-center gap-1" data-id="${room.room_id}">
              <span class="material-symbols-outlined text-[16px]">calendar_month</span>
              <span>Schedule</span>
            </button>
            <div class="flex items-center gap-1">
              <button type="button" class="btn-toggle-maint p-1.5 text-gray-500 hover:text-amber-600 rounded-lg hover:bg-gray-100" data-id="${room.room_id}" data-status="${room.status}" title="Toggle Maintenance">
                <span class="material-symbols-outlined text-[18px]">${isMaint ? 'check_circle' : 'build'}</span>
              </button>
              <button type="button" class="btn-edit-room p-1.5 text-gray-500 hover:text-blue-600 rounded-lg hover:bg-gray-100" data-id="${room.room_id}" title="Edit Room">
                <span class="material-symbols-outlined text-[18px]">edit</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    attachFacilityRowEvents();
  }

  function attachFacilityRowEvents() {
    // 1. Toggle Maintenance
    document.querySelectorAll('.btn-toggle-maint').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const currentStatus = btn.getAttribute('data-status');
        const newStatus = currentStatus === 'Maintenance' ? 'Available' : 'Maintenance';

        const room = state.rooms.find(r => r.room_id === id);
        const roomName = room ? room.name : 'this facility';

        const ok = await confirmAction({
          title: newStatus === 'Maintenance' ? 'Place Under Maintenance' : 'Mark Operational',
          message: `Are you sure you want to change ${roomName} status to ${newStatus}?`,
          proceedText: `Set to ${newStatus}`,
          icon: newStatus === 'Maintenance' ? 'build' : 'check_circle',
          isDestructive: newStatus === 'Maintenance',
        });
        if (!ok) return;

        try {
          await apiFetch(`api/rooms/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: newStatus }),
          });
          showToast(`Facility status updated to ${newStatus}.`, 'success');
          await loadAllData();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    // 2. Edit Room Modal
    document.querySelectorAll('.btn-edit-room').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const room = state.rooms.find(r => r.room_id === id);
        if (!room) return;

        document.getElementById('editRoomId').value = room.room_id;
        document.getElementById('editRoomName').value = room.name;
        document.getElementById('editRoomType').value = room.room_type || 'Lecture Hall';
        document.getElementById('editRoomFloor').value = room.floor || 1;
        document.getElementById('editRoomCapacity').value = room.capacity || 30;
        document.getElementById('editRoomStatus').value = room.status || 'Available';
        document.getElementById('editRoomIsActive').value = room.is_active ? 'true' : 'false';

        openModal('editFacilityModal');
      });
    });

    // 3. Inspect Calendar
    document.querySelectorAll('.btn-inspect-calendar').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const room = state.rooms.find(r => r.room_id === id);
        if (!room) return;

        const titleEl = document.getElementById('scheduleModalTitle');
        if (titleEl) titleEl.textContent = `${room.name} — Schedule Inspector`;
        openModal('roomScheduleModal');

        const classesList = document.getElementById('roomScheduleClassesList');
        const resList = document.getElementById('roomScheduleReservationsList');
        if (classesList) classesList.innerHTML = `<p class="text-xs text-gray-400">Loading schedules...</p>`;
        if (resList) resList.innerHTML = `<p class="text-xs text-gray-400">Loading bookings...</p>`;

        try {
          const cal = await apiFetch(`api/rooms/${id}/calendar`);
          const classes = (cal && cal.classes) || [];
          const bookings = (cal && cal.reservations) || [];

          if (classesList) {
            if (classes.length === 0) {
              classesList.innerHTML = `<p class="text-xs text-gray-400 italic">No recurring academic class blocks assigned to this room.</p>`;
            } else {
              classesList.innerHTML = classes.map(c => `
                <div class="p-3 bg-gray-50 rounded-xl border border-gray-100 flex items-center justify-between text-xs">
                  <div>
                    <span class="font-bold text-gray-900">${escapeHtml(c.course_code)}</span>
                    <span class="text-gray-500">(${escapeHtml(c.section)})</span>
                    <span class="ml-2 font-semibold text-gray-700">${escapeHtml(c.day_of_week)}</span>
                  </div>
                  <div class="text-gray-600 font-mono">${formatTime(c.start_time)} – ${formatTime(c.end_time)}</div>
                </div>
              `).join('');
            }
          }

          if (resList) {
            if (bookings.length === 0) {
              resList.innerHTML = `<p class="text-xs text-gray-400 italic">No approved reservations scheduled in the next 14 days.</p>`;
            } else {
              resList.innerHTML = bookings.map(b => `
                <div class="p-3 bg-amber-50/50 rounded-xl border border-amber-100 flex items-center justify-between text-xs">
                  <div>
                    <span class="font-bold text-gray-900">${escapeHtml(b.title || b.category)}</span>
                    <span class="text-gray-500">by ${escapeHtml(b.user_name || 'Requester')}</span>
                  </div>
                  <div class="text-amber-900 font-semibold">${formatRange(b.start_time, b.end_time)}</div>
                </div>
              `).join('');
            }
          }
        } catch (err) {
          if (classesList) classesList.innerHTML = `<p class="text-xs text-red-500">Failed to load schedule calendar.</p>`;
        }
      });
    });
  }

  // Create Facility Form Submit
  const addFacilityForm = document.getElementById('addFacilityForm');
  if (addFacilityForm) {
    addFacilityForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('newRoomName').value.trim();
      const room_type = document.getElementById('newRoomType').value;
      const floor = parseInt(document.getElementById('newRoomFloor').value, 10);
      const capacity = parseInt(document.getElementById('newRoomCapacity').value, 10);
      const status = document.getElementById('newRoomStatus').value;

      try {
        await apiFetch('api/rooms', {
          method: 'POST',
          body: JSON.stringify({ name, room_type, floor, capacity, status, is_active: true }),
        });
        showToast(`Facility "${name}" created successfully!`, 'success');
        closeModal('addFacilityModal');
        addFacilityForm.reset();
        await loadAllData();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Edit Facility Form Submit
  const editFacilityForm = document.getElementById('editFacilityForm');
  if (editFacilityForm) {
    editFacilityForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('editRoomId').value;
      const name = document.getElementById('editRoomName').value.trim();
      const room_type = document.getElementById('editRoomType').value;
      const floor = parseInt(document.getElementById('editRoomFloor').value, 10);
      const capacity = parseInt(document.getElementById('editRoomCapacity').value, 10);
      const status = document.getElementById('editRoomStatus').value;
      const is_active = document.getElementById('editRoomIsActive').value === 'true';

      try {
        await apiFetch(`api/rooms/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name, room_type, floor, capacity, status, is_active }),
        });
        showToast(`Facility specifications updated!`, 'success');
        closeModal('editFacilityModal');
        await loadAllData();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  const openAddFacilityModalBtn = document.getElementById('openAddFacilityModalBtn');
  if (openAddFacilityModalBtn) {
    openAddFacilityModalBtn.addEventListener('click', () => {
      openModal('addFacilityModal');
    });
  }

  // =========================================================================
  // 7. MODULE 3: RESERVATIONS MASTER MANAGEMENT
  // =========================================================================

  function renderReservations() {
    updateSubtabBadges();
    switchResSubtab(state.activeResSubtab);
  }

  function updateSubtabBadges() {
    const pendingCount = state.reservations.filter(r => r.status === 'Pending').length;
    const elSubPending = document.getElementById('subtab-pending-badge');
    if (elSubPending) elSubPending.textContent = pendingCount;
  }

  function switchResSubtab(subtabName) {
    state.activeResSubtab = subtabName;

    // Update active button state
    document.querySelectorAll('.res-subtab-btn').forEach(btn => {
      if (btn.getAttribute('data-res-subtab') === subtabName) {
        btn.className = 'res-subtab-btn px-4 py-2 rounded-xl text-xs font-bold transition-all bg-[#7a1f2b] text-white flex items-center gap-1.5';
      } else {
        btn.className = 'res-subtab-btn px-4 py-2 rounded-xl text-xs font-bold transition-all text-gray-600 hover:bg-gray-100 flex items-center gap-1.5';
      }
    });

    const standardTable = document.getElementById('resTableViewContainer');
    if (standardTable) standardTable.classList.remove('hidden');
    filterAndRenderReservations();
  }

  document.querySelectorAll('[data-res-subtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      switchResSubtab(btn.getAttribute('data-res-subtab'));
    });
  });

  const resSearchInput = document.getElementById('resSearchInput');
  if (resSearchInput) resSearchInput.addEventListener('input', filterAndRenderReservations);

  const resCategoryFilter = document.getElementById('resCategoryFilter');
  if (resCategoryFilter) resCategoryFilter.addEventListener('change', filterAndRenderReservations);

  function filterAndRenderReservations() {
    const searchInput = document.getElementById('resSearchInput');
    const search = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const cat = document.getElementById('resCategoryFilter')?.value || 'all';
    const subtab = state.activeResSubtab;

    const filtered = state.reservations.filter(res => {
      if (subtab !== 'all') {
        if (res.status !== subtab) return false;
      }
      if (cat !== 'all' && res.category !== cat) {
        return false;
      }
      if (search) {
        const matchesName = (res.user_name || '').toLowerCase().includes(search);
        const matchesEmail = (res.user_email || '').toLowerCase().includes(search);
        const matchesRoom = (res.room_name || '').toLowerCase().includes(search);
        const matchesPurpose = (res.purpose || '').toLowerCase().includes(search);
        const matchesId = (res.reservation_id || '').toLowerCase().includes(search);
        if (!matchesName && !matchesEmail && !matchesRoom && !matchesPurpose && !matchesId) {
          return false;
        }
      }
      return true;
    });

    renderReservationsTable(filtered);
  }

  function renderReservationsTable(list) {
    const tbody = document.getElementById('reservationsTableBody');
    if (!tbody) return;
    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-gray-400 text-xs">No reservations matching current view filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(r => {
      let statusBadge = '';
      if (r.status === 'Approved') statusBadge = `<span class="badge-approved">Approved</span>`;
      else if (r.status === 'Pending') statusBadge = `<span class="badge-pending">Pending</span>`;
      else if (r.status === 'Rejected') statusBadge = `<span class="badge-rejected">Rejected</span>`;
      else if (r.status === 'Cancelled') statusBadge = `<span class="badge-cancelled">Cancelled</span>`;
      else statusBadge = `<span class="badge-completed">${escapeHtml(r.status)}</span>`;

      const isPending = r.status === 'Pending';
      const isApproved = r.status === 'Approved';

      return `
        <tr class="hover:bg-gray-50/80 transition-colors">
          <td class="py-4 px-6 font-mono text-xs font-semibold text-gray-600">
            <span title="${escapeHtml(r.reservation_id)}">${escapeHtml(r.reservation_id.substring(0, 8))}</span>
          </td>
          <td class="py-4 px-6 text-xs">
            <div class="font-bold text-gray-900">${escapeHtml(r.user_name || 'Requester')}</div>
            <div class="text-[11px] text-gray-400">${escapeHtml(r.user_email || '—')}</div>
          </td>
          <td class="py-4 px-6 text-xs font-semibold text-gray-800">${escapeHtml(r.room_name || 'Facility')}</td>
          <td class="py-4 px-6 text-xs text-gray-600 whitespace-nowrap">${formatRange(r.start_time, r.end_time)}</td>
          <td class="py-4 px-6 text-xs text-gray-600">
            <span class="font-semibold text-gray-800">${escapeHtml(r.category || 'General')}</span>
            ${r.purpose ? `<div class="text-[11px] text-gray-400 truncate max-w-xs" title="${escapeHtml(r.purpose)}">${escapeHtml(r.purpose)}</div>` : ''}
          </td>
          <td class="py-4 px-6 text-xs">${statusPillBadge(r.status)}</td>
          <td class="py-4 px-6 text-right">
            <div class="inline-flex items-center gap-1.5">
              <button type="button" class="btn-res-details p-1.5 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors" data-id="${r.reservation_id}" title="View Details & Audit Trail">
                <span class="material-symbols-outlined text-[19px]">visibility</span>
              </button>
              ${isPending ? `
                <button type="button" class="btn-res-approve px-2.5 py-1 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm transition-all" data-id="${r.reservation_id}">
                  Approve
                </button>
                <button type="button" class="btn-res-reject px-2.5 py-1 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-all" data-id="${r.reservation_id}">
                  Reject
                </button>
              ` : ''}
              ${isApproved ? `
                <button type="button" class="btn-res-admin-cancel px-2.5 py-1 text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg transition-all" data-id="${r.reservation_id}" title="Administrative Override Cancellation">
                  Revoke
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    attachReservationActions();
  }

  function statusPillBadge(status) {
    if (status === 'Approved') return `<span class="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">Approved</span>`;
    if (status === 'Pending') return `<span class="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">Pending</span>`;
    if (status === 'Rejected') return `<span class="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">Rejected</span>`;
    if (status === 'Cancelled') return `<span class="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">Cancelled</span>`;
    return `<span class="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">${escapeHtml(status)}</span>`;
  }

  async function showReservationDetails(id) {
    const res = state.reservations.find(r => r.reservation_id === id);
    if (!res) return;

    const content = document.getElementById('resDetailsContent');
    const auditList = document.getElementById('resDetailsAuditList');
    if (content) {
      content.innerHTML = `
        <div class="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-xl text-xs">
          <div>
            <span class="text-gray-400 block">Requester</span>
            <span class="font-bold text-gray-900">${escapeHtml(res.customer_name || res.user_name || 'Requester')}</span>
            <span class="text-gray-500 block">${escapeHtml(res.customer_email || res.user_email || '—')}</span>
          </div>
          <div>
            <span class="text-gray-400 block">Facility Space</span>
            <span class="font-bold text-gray-900">${escapeHtml(res.room_name || 'Facility')}</span>
            <span class="text-gray-500 block">Ref: #${shortId(res.reservation_id)}</span>
          </div>
          <div>
            <span class="text-gray-400 block">Time Schedule</span>
            <span class="font-semibold text-gray-900">${formatRange(res.start_time, res.end_time)}</span>
          </div>
          <div>
            <span class="text-gray-400 block">Status / Classification</span>
            <span class="font-semibold text-gray-900">${escapeHtml(res.status)} (${escapeHtml(res.category || 'Standard')})</span>
            <span class="text-gray-500 block italic">"${escapeHtml(res.purpose || 'No purpose notes provided')}"</span>
          </div>
          ${res.equipment_notes ? `
            <div class="col-span-2 pt-2 border-t border-gray-200/60">
              <span class="text-gray-400 block">Equipment &amp; Setup Notes</span>
              <span class="font-medium text-gray-800">${escapeHtml(res.equipment_notes)}</span>
            </div>
          ` : ''}
        </div>
      `;
    }

    if (auditList) auditList.innerHTML = `<p class="text-xs text-gray-400">Loading audit trail...</p>`;
    openModal('resDetailsModal');

    try {
      const logs = await apiFetch(`api/reservations/${id}/logs`);
      if (auditList) {
        if (!Array.isArray(logs) || logs.length === 0) {
          auditList.innerHTML = `<p class="text-xs text-gray-400 italic">No specific audit history logged for this reservation.</p>`;
        } else {
          auditList.innerHTML = logs.map(l => `
            <div class="p-3 bg-white border border-gray-100 rounded-xl flex items-center justify-between text-xs">
              <div>
                <span class="font-bold text-gray-800">${escapeHtml(l.action_type)}</span>
                <span class="text-gray-400 ml-1">by ${escapeHtml(l.user_name || 'System')}</span>
              </div>
              <span class="text-gray-400">${formatDateTime(l.timestamp)}</span>
            </div>
          `).join('');
        }
      }
    } catch (err) {
      if (auditList) auditList.innerHTML = `<p class="text-xs text-red-500">Failed to load audit history.</p>`;
    }
  }

  function attachReservationActions() {
    // 1. Details & Audit Modal
    document.querySelectorAll('.btn-res-details').forEach(btn => {
      btn.addEventListener('click', () => {
        showReservationDetails(btn.getAttribute('data-id'));
      });
    });

    // 2. Quick Approve
    document.querySelectorAll('.btn-res-approve').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const ok = await confirmAction({
          title: 'Approve Reservation',
          message: 'Are you sure you want to approve this reservation? The facility will be reserved exclusively.',
          proceedText: 'Approve Permit',
          icon: 'check_circle',
          isDestructive: false,
        });
        if (!ok) return;

        try {
          await apiFetch(`api/reservations/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'Approved' }),
          });
          showToast('Reservation approved successfully!', 'success');
          await loadAllData();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    // 3. Quick Reject
    document.querySelectorAll('.btn-res-reject').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const ok = await confirmAction({
          title: 'Reject Reservation',
          message: 'Are you sure you want to decline this reservation request?',
          proceedText: 'Reject Permit',
          icon: 'cancel',
          isDestructive: true,
        });
        if (!ok) return;

        try {
          await apiFetch(`api/reservations/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'Rejected' }),
          });
          showToast('Reservation rejected.', 'info');
          await loadAllData();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    // 4. Admin Override Cancel
    document.querySelectorAll('.btn-res-admin-cancel').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        document.getElementById('cancelReservationId').value = id;
        document.getElementById('adminCancelReason').value = '';
        openModal('adminCancelModal');
      });
    });
  }

  // Admin Cancel Form Submit
  const adminCancelForm = document.getElementById('adminCancelForm');
  if (adminCancelForm) {
    adminCancelForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('cancelReservationId').value;
      const reason = document.getElementById('adminCancelReason').value.trim();

      if (!reason) {
        showToast('A revocation reason is required by institutional policy.', 'error');
        return;
      }

      try {
        await apiFetch(`api/reservations/${id}/cancel`, {
          method: 'PATCH',
          body: JSON.stringify({ reason }),
        });
        showToast('Reservation permit revoked and moved to archive (retained for 30 days before permanent deletion).', 'success');
        closeModal('adminCancelModal');
        await loadAllData();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // =========================================================================
  // 7b. MODULE: NATIVE APPROVAL QUEUE (Staff & Admin Approvals)
  // =========================================================================

  function renderApprovalQueue() {
    const tbody = document.getElementById('approvalQueueTableBody');
    if (!tbody) return;

    const searchInput = document.getElementById('approvalQueueSearchInput');
    const search = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const cat = document.getElementById('approvalQueueCategoryFilter')?.value || 'all';

    const pendingList = state.reservations.filter(res => {
      if (res.status !== 'Pending') return false;
      if (cat !== 'all' && res.category !== cat) return false;
      if (search) {
        const matchesName = (res.customer_name || res.user_name || '').toLowerCase().includes(search);
        const matchesEmail = (res.customer_email || res.user_email || '').toLowerCase().includes(search);
        const matchesRoom = (res.room_name || '').toLowerCase().includes(search);
        const matchesPurpose = (res.purpose || '').toLowerCase().includes(search);
        const matchesId = (res.reservation_id || '').toLowerCase().includes(search);
        if (!matchesName && !matchesEmail && !matchesRoom && !matchesPurpose && !matchesId) {
          return false;
        }
      }
      return true;
    });

    updateAllCounters();

    if (pendingList.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="p-12 text-center">
            <div class="flex flex-col items-center justify-center text-gray-400">
              <div class="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
                <span class="material-symbols-outlined text-[28px]">task_alt</span>
              </div>
              <p class="text-sm font-bold text-gray-800">The Approval Queue is completely clear</p>
              <p class="text-xs text-gray-500 mt-1">There are no pending booking applications requiring administrative review.</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = pendingList.map(r => {
      const requester = escapeHtml(r.customer_name || r.user_name || 'Requester');
      const email = escapeHtml(r.customer_email || r.user_email || '—');
      const room = escapeHtml(r.room_name || 'Facility');
      const purpose = escapeHtml(r.purpose || 'No purpose stated');
      const category = escapeHtml(r.category || 'Standard');
      const timeWindow = formatRange(r.start_time, r.end_time);
      const shortRef = shortId(r.reservation_id);
      const notes = r.equipment_notes ? `<div class="text-[11px] text-gray-500 mt-0.5"><span class="font-semibold text-gray-600">Notes:</span> ${escapeHtml(r.equipment_notes)}</div>` : '';

      return `
        <tr class="hover:bg-gray-50/80 transition-colors" data-res-id="${r.reservation_id}">
          <td class="py-4 px-6 align-middle">
            <span class="font-mono font-bold text-[#7a1f2b] text-xs">#${shortRef}</span>
            ${r.is_recurring ? `<span class="block text-[10px] text-blue-600 font-semibold mt-0.5">Recurring</span>` : ''}
          </td>
          <td class="py-4 px-6 align-middle">
            <div class="font-bold text-gray-900 text-xs">${requester}</div>
            <div class="text-[11px] text-gray-400 truncate max-w-[180px]">${email}</div>
          </td>
          <td class="py-4 px-6 align-middle">
            <div class="font-bold text-gray-800 text-xs">${room}</div>
          </td>
          <td class="py-4 px-6 align-middle whitespace-nowrap text-xs text-gray-700">
            <div class="font-medium">${timeWindow}</div>
          </td>
          <td class="py-4 px-6 align-middle">
            <span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-700 mb-1">${category}</span>
            <div class="text-xs text-gray-700 line-clamp-1 max-w-[220px]" title="${purpose}">${purpose}</div>
            ${notes}
          </td>
          <td class="py-4 px-6 align-middle text-right">
            <div class="flex items-center justify-end gap-2">
              <button type="button" class="btn-approval-details px-3 py-1.5 text-xs font-semibold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-xl transition-all shadow-sm" data-id="${r.reservation_id}">
                Details
              </button>
              <button type="button" class="btn-approval-reject px-3 py-1.5 text-xs font-semibold text-red-600 bg-white border border-red-200 hover:bg-red-50 rounded-xl transition-all shadow-sm flex items-center gap-1" data-id="${r.reservation_id}" data-name="${requester}">
                <span class="material-symbols-outlined text-[15px]">close</span>
                <span>Reject</span>
              </button>
              <button type="button" class="btn-approval-approve px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-all shadow-sm flex items-center gap-1" data-id="${r.reservation_id}" data-name="${requester}">
                <span class="material-symbols-outlined text-[15px]">check</span>
                <span>Approve</span>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Attach event listeners for Approval Queue table buttons
    tbody.querySelectorAll('.btn-approval-details').forEach(btn => {
      btn.addEventListener('click', () => {
        showReservationDetails(btn.getAttribute('data-id'));
      });
    });

    tbody.querySelectorAll('.btn-approval-approve').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        const ok = await confirmAction({
          title: 'Approve Reservation',
          message: `Are you sure you want to approve reservation #${shortId(id)} for ${name}? The facility will be reserved exclusively.`,
          proceedText: 'Approve Booking',
          icon: 'check_circle',
          isDestructive: false,
        });
        if (!ok) return;

        try {
          await apiFetch(`api/reservations/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'Approved' }),
          });
          showToast(`Reservation #${shortId(id)} approved successfully!`, 'success');
          const item = state.reservations.find(r => r.reservation_id === id);
          if (item) item.status = 'Approved';
          updateAllCounters();
          renderApprovalQueue();
          if (state.activeView === 'overview') renderOverview();
          if (state.activeView === 'reservations') renderReservations();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    tbody.querySelectorAll('.btn-approval-reject').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        const ok = await confirmAction({
          title: 'Reject Reservation',
          message: `Are you sure you want to decline reservation request #${shortId(id)} for ${name}?`,
          proceedText: 'Reject Booking',
          icon: 'cancel',
          isDestructive: true,
        });
        if (!ok) return;

        try {
          await apiFetch(`api/reservations/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: 'Rejected' }),
          });
          showToast(`Reservation #${shortId(id)} rejected.`, 'info');
          const item = state.reservations.find(r => r.reservation_id === id);
          if (item) item.status = 'Rejected';
          updateAllCounters();
          renderApprovalQueue();
          if (state.activeView === 'overview') renderOverview();
          if (state.activeView === 'reservations') renderReservations();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  // Bind Approval Queue search and filter controls
  const approvalQueueSearchInput = document.getElementById('approvalQueueSearchInput');
  if (approvalQueueSearchInput) {
    approvalQueueSearchInput.addEventListener('input', renderApprovalQueue);
  }

  const approvalQueueCategoryFilter = document.getElementById('approvalQueueCategoryFilter');
  if (approvalQueueCategoryFilter) {
    approvalQueueCategoryFilter.addEventListener('change', renderApprovalQueue);
  }

  const btnRefreshApprovalQueue = document.getElementById('btnRefreshApprovalQueue');
  if (btnRefreshApprovalQueue) {
    btnRefreshApprovalQueue.addEventListener('click', async () => {
      showToast('Refreshing approval queue...', 'info');
      await loadAllData();
      showToast('Approval queue synchronized.', 'success');
    });
  }

  // Render Move Requests Table
  function renderMovesTable() {
    const tbody = document.getElementById('movesTableBody');
    if (!tbody) return;
    if (state.moveRequests.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-gray-400 text-xs">No move requests awaiting review.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.moveRequests.map(m => {
      const isPending = m.status === 'Pending';
      return `
        <tr class="hover:bg-gray-50/80 transition-colors">
          <td class="py-4 px-6 text-xs">
            <div class="font-bold text-gray-900">${escapeHtml(m.customer_name || 'Requester')}</div>
            <div class="text-[11px] text-gray-400">${escapeHtml(m.customer_email || '—')}</div>
          </td>
          <td class="py-4 px-6 text-xs font-semibold text-gray-800">${escapeHtml(m.room_name || 'Facility')}</td>
          <td class="py-4 px-6 text-xs text-gray-500">${formatRange(m.current_start_time, m.current_end_time)}</td>
          <td class="py-4 px-6 text-xs font-semibold text-blue-700 bg-blue-50/40 rounded">${formatRange(m.requested_start_time, m.requested_end_time)}</td>
          <td class="py-4 px-6 text-xs">
            <span class="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${isPending ? 'bg-amber-100 text-amber-800' : (m.status === 'Approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800')}">
              ${m.status}
            </span>
          </td>
          <td class="py-4 px-6 text-right">
            ${isPending ? `
              <button type="button" class="btn-review-move px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg shadow-sm transition-all" data-id="${m.request_id}">
                Review Move
              </button>
            ` : `<span class="text-xs text-gray-400">—</span>`}
          </td>
        </tr>
      `;
    }).join('');

    document.querySelectorAll('.btn-review-move').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const req = state.moveRequests.find(m => m.request_id === id);
        if (!req) return;

        document.getElementById('moveRequestId').value = req.request_id;
        document.getElementById('moveStaffComment').value = '';
        const summary = document.getElementById('moveReviewSummary');
        if (summary) {
          summary.innerHTML = `
            <div class="p-3 bg-gray-50 rounded-xl space-y-1">
              <p><strong>Requester:</strong> ${escapeHtml(req.customer_name)} (${escapeHtml(req.customer_email)})</p>
              <p><strong>Facility:</strong> ${escapeHtml(req.room_name)}</p>
              <p><strong>Current:</strong> ${formatRange(req.current_start_time, req.current_end_time)}</p>
              <p class="text-blue-700 font-bold"><strong>Requested:</strong> ${formatRange(req.requested_start_time, req.requested_end_time)}</p>
            </div>
          `;
        }

        openModal('moveReviewModal');
      });
    });
  }

  // Resolve Move Request Buttons
  const btnApproveMove = document.getElementById('btn-approve-move');
  if (btnApproveMove) {
    btnApproveMove.addEventListener('click', async () => {
      const id = document.getElementById('moveRequestId').value;
      const comment = document.getElementById('moveStaffComment').value.trim();

      try {
        await apiFetch(`api/reservations/move-requests/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'Approved', staff_comment: comment }),
        });
        showToast('Move request approved! Booking schedule updated.', 'success');
        closeModal('moveReviewModal');
        await loadAllData();
        switchResSubtab('moves');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  const btnRejectMove = document.getElementById('btn-reject-move');
  if (btnRejectMove) {
    btnRejectMove.addEventListener('click', async () => {
      const id = document.getElementById('moveRequestId').value;
      const comment = document.getElementById('moveStaffComment').value.trim();

      if (!comment) {
        showToast('A comment is required when rejecting a move request.', 'error');
        return;
      }

      try {
        await apiFetch(`api/reservations/move-requests/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'Rejected', staff_comment: comment }),
        });
        showToast('Move request rejected.', 'info');
        closeModal('moveReviewModal');
        await loadAllData();
        switchResSubtab('moves');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Render Cancellation Requests Table
  function renderCancelsTable() {
    const tbody = document.getElementById('cancelsTableBody');
    if (!tbody) return;
    if (state.cancelRequests.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-gray-400 text-xs">No cancellation requests awaiting review.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.cancelRequests.map(c => {
      const isPending = c.status === 'Pending';
      return `
        <tr class="hover:bg-gray-50/80 transition-colors">
          <td class="py-4 px-6 text-xs">
            <div class="font-bold text-gray-900">${escapeHtml(c.customer_name || 'Requester')}</div>
            <div class="text-[11px] text-gray-400">${escapeHtml(c.customer_email || '—')}</div>
          </td>
          <td class="py-4 px-6 text-xs font-semibold text-gray-800">${escapeHtml(c.room_name || 'Facility')}</td>
          <td class="py-4 px-6 text-xs text-gray-500">${formatRange(c.start_time, c.end_time)}</td>
          <td class="py-4 px-6 text-xs text-gray-700 italic max-w-xs truncate" title="${escapeHtml(c.reason)}">
            "${escapeHtml(c.reason)}"
          </td>
          <td class="py-4 px-6 text-xs">
            <span class="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${isPending ? 'bg-amber-100 text-amber-800' : (c.status === 'Approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800')}">
              ${c.status}
            </span>
          </td>
          <td class="py-4 px-6 text-right">
            ${isPending ? `
              <button type="button" class="btn-review-cancel px-3 py-1 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-lg shadow-sm transition-all" data-id="${c.request_id}">
                Review Cancel
              </button>
            ` : `<span class="text-xs text-gray-400">—</span>`}
          </td>
        </tr>
      `;
    }).join('');

    document.querySelectorAll('.btn-review-cancel').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const req = state.cancelRequests.find(c => c.request_id === id);
        if (!req) return;

        document.getElementById('cancelRequestId').value = req.request_id;
        document.getElementById('cancelStaffComment').value = '';
        const summary = document.getElementById('cancelReviewSummary');
        if (summary) {
          summary.innerHTML = `
            <div class="p-3 bg-gray-50 rounded-xl space-y-1">
              <p><strong>Requester:</strong> ${escapeHtml(req.customer_name)} (${escapeHtml(req.customer_email)})</p>
              <p><strong>Facility:</strong> ${escapeHtml(req.room_name)}</p>
              <p><strong>Scheduled Slot:</strong> ${formatRange(req.start_time, req.end_time)}</p>
              <p class="text-red-700"><strong>Customer Reason:</strong> "${escapeHtml(req.reason)}"</p>
            </div>
          `;
        }

        openModal('cancelReviewModal');
      });
    });
  }

  // Resolve Cancellation Request Buttons
  const btnApproveCancelReq = document.getElementById('btn-approve-cancel-req');
  if (btnApproveCancelReq) {
    btnApproveCancelReq.addEventListener('click', async () => {
      const id = document.getElementById('cancelRequestId').value;
      const comment = document.getElementById('cancelStaffComment').value.trim();

      try {
        await apiFetch(`api/reservations/cancel-requests/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'Approved', staff_comment: comment }),
        });
        showToast('Cancellation approved. Room released for bookings.', 'success');
        closeModal('cancelReviewModal');
        await loadAllData();
        switchResSubtab('cancels');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  const btnRejectCancelReq = document.getElementById('btn-reject-cancel-req');
  if (btnRejectCancelReq) {
    btnRejectCancelReq.addEventListener('click', async () => {
      const id = document.getElementById('cancelRequestId').value;
      const comment = document.getElementById('cancelStaffComment').value.trim();

      if (!comment) {
        showToast('A comment is required when declining a cancellation request.', 'error');
        return;
      }

      try {
        await apiFetch(`api/reservations/cancel-requests/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'Rejected', staff_comment: comment }),
        });
        showToast('Cancellation request declined.', 'info');
        closeModal('cancelReviewModal');
        await loadAllData();
        switchResSubtab('cancels');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // ── Conflict Override Requests ──────────────────────────────────────────

  function renderOverridesTable() {
    const tbody = document.getElementById('overridesTableBody');
    if (!tbody) return;
    if (state.overrideRequests.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-gray-400 text-xs">No conflict override requests found.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.overrideRequests.map(ov => {
      const isPending = ov.status === 'Pending';
      return `
        <tr class="hover:bg-gray-50/80 transition-colors">
          <td class="py-4 px-6 text-xs">
            <div class="font-bold text-gray-900">${escapeHtml(ov.requester_name || 'Requester')}</div>
            <div class="text-[11px] text-gray-400">${escapeHtml(ov.requester_email || '—')}</div>
          </td>
          <td class="py-4 px-6 text-xs font-semibold text-gray-800">${escapeHtml(ov.room_name || 'Facility')}</td>
          <td class="py-4 px-6 text-xs font-semibold text-violet-700 bg-violet-50/40 rounded">${formatRange(ov.start_time, ov.end_time)}</td>
          <td class="py-4 px-6 text-xs text-gray-500">${formatRange(ov.conflict_start_time, ov.conflict_end_time)}</td>
          <td class="py-4 px-6 text-xs text-gray-700 italic max-w-xs truncate" title="${escapeHtml(ov.reason)}">
            "${escapeHtml(ov.reason || '—')}"
          </td>
          <td class="py-4 px-6 text-xs">
            <span class="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${isPending ? 'bg-amber-100 text-amber-800' : (ov.status === 'Approved' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800')}">
              ${ov.status}
            </span>
          </td>
          <td class="py-4 px-6 text-right">
            ${isPending ? `
              <button type="button" class="btn-review-override px-3 py-1 bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs rounded-lg shadow-sm transition-all" data-id="${ov.request_id}">
                Review Override
              </button>
            ` : `<span class="text-xs text-gray-400">—</span>`}
          </td>
        </tr>
      `;
    }).join('');

    document.querySelectorAll('.btn-review-override').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const req = state.overrideRequests.find(o => o.request_id === id);
        if (!req) return;

        document.getElementById('overrideRequestId').value = req.request_id;
        document.getElementById('overrideStaffComment').value = '';
        const errorEl = document.getElementById('overrideErrorMsg');
        if (errorEl) errorEl.classList.add('hidden');

        const dateEl = document.getElementById('overrideMoveDate');
        const startEl = document.getElementById('overrideMoveStart');
        const endEl = document.getElementById('overrideMoveEnd');
        const hintEl = document.getElementById('overrideMoveHint');
        if (dateEl) dateEl.value = '';
        if (startEl) startEl.value = '';
        if (endEl) endEl.value = '';

        const summary = document.getElementById('overrideReviewSummary');
        if (summary) {
          summary.innerHTML = `
            <div><span class="font-semibold text-gray-900">Requester:</span> ${escapeHtml(req.requester_name || 'Requester')} (${escapeHtml(req.requester_email || '—')})</div>
            <div><span class="font-semibold text-gray-900">Facility:</span> ${escapeHtml(req.room_name || 'Facility')}</div>
            <div><span class="font-semibold text-gray-900">Requested:</span> ${formatRange(req.start_time, req.end_time)}</div>
            <div><span class="font-semibold text-gray-900">Conflicting booking:</span> ${formatRange(req.conflict_start_time, req.conflict_end_time)}</div>
            <div><span class="font-semibold text-violet-700">Urgency reason:</span> "${escapeHtml(req.reason || 'None')}"</div>
          `;
        }

        openModal('conflictOverrideModal');

        // Suggest move slot
        if (hintEl) hintEl.textContent = 'Analyzing schedule for a recommended free slot...';
        suggestMoveSlot(req).then((slot) => {
          if (!slot) {
            if (hintEl) hintEl.textContent = 'No free slot found in next 14 days. Enter a custom date and time.';
            return;
          }
          if (dateEl) dateEl.value = slot.date;
          if (startEl) startEl.value = slot.start;
          if (endEl) endEl.value = slot.end;
          if (hintEl) hintEl.textContent = 'Suggested: the first free slot of the same length in this room.';
        });
      });
    });
  }

  async function suggestMoveSlot(request) {
    const S = window.CampusSchedule;
    if (!S) return null;
    try {
      const rules = await S.loadRules(BASE);
      const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
      const toHHMM = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');

      const firstDay = String(request.conflict_start_time).slice(0, 10);
      const length = toMin(S.hhmm(request.conflict_end_time)) - toMin(S.hhmm(request.conflict_start_time));
      const last = new Date(firstDay + 'T00:00:00');
      last.setDate(last.getDate() + 13);
      const lastDay = last.getFullYear() + '-' + String(last.getMonth() + 1).padStart(2, '0') + '-' + String(last.getDate()).padStart(2, '0');

      const data = await S.fetchRange(BASE, request.room_id, firstDay, lastDay);
      if (!data || length <= 0) return null;

      const requestedDays = S.datesBetween(String(request.start_time).slice(0, 10), String(request.end_time).slice(0, 10));
      const reqStart = S.hhmm(request.start_time), reqEnd = S.hhmm(request.end_time);
      const now = new Date();

      for (const date of S.datesBetween(firstDay, lastDay)) {
        if (S.isClosedDay(date, rules.closedDays)) continue;
        for (let m = Math.ceil(toMin(rules.open) / 30) * 30; m + length <= toMin(rules.close); m += 30) {
          const start = toHHMM(m), end = toHHMM(m + length);
          if (new Date(`${date}T${start}:00`) <= now) continue;
          if (requestedDays.includes(date) && start < reqEnd && end > reqStart) continue;
          if (S.findConflicts(data, date, start, end, { excludeReservationId: request.conflicting_reservation_id }).length) continue;
          return { date, start, end };
        }
      }
    } catch (e) {
      console.warn('Could not auto-suggest slot:', e);
    }
    return null;
  }

  const btnRejectOverride = document.getElementById('btn-reject-override');
  if (btnRejectOverride) {
    btnRejectOverride.addEventListener('click', async () => {
      const id = document.getElementById('overrideRequestId').value;
      const comment = document.getElementById('overrideStaffComment').value.trim();
      const errorEl = document.getElementById('overrideErrorMsg');

      if (!comment) {
        if (errorEl) {
          errorEl.textContent = 'A comment is required explaining why the override was rejected.';
          errorEl.classList.remove('hidden');
        }
        return;
      }

      try {
        await apiFetch(`api/conflict-override-requests/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'Rejected', staff_comment: comment }),
        });
        showToast('Conflict override request rejected.', 'info');
        closeModal('conflictOverrideModal');
        await loadAllData();
        switchResSubtab('overrides');
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = err.message;
          errorEl.classList.remove('hidden');
        }
      }
    });
  }

  const btnApproveOverride = document.getElementById('btn-approve-override');
  if (btnApproveOverride) {
    btnApproveOverride.addEventListener('click', async () => {
      const id = document.getElementById('overrideRequestId').value;
      const comment = document.getElementById('overrideStaffComment').value.trim();
      const date = document.getElementById('overrideMoveDate').value;
      const start = document.getElementById('overrideMoveStart').value;
      const end = document.getElementById('overrideMoveEnd').value;
      const errorEl = document.getElementById('overrideErrorMsg');

      if (!date || !start || !end) {
        if (errorEl) {
          errorEl.textContent = 'Please choose the date and times to move the conflicting booking to.';
          errorEl.classList.remove('hidden');
        }
        return;
      }

      if (end <= start) {
        if (errorEl) {
          errorEl.textContent = 'The end time must be after the start time.';
          errorEl.classList.remove('hidden');
        }
        return;
      }

      try {
        await apiFetch(`api/conflict-override-requests/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: 'Approved',
            staff_comment: comment,
            move_start_time: `${date} ${start}:00`,
            move_end_time: `${date} ${end}:00`,
          }),
        });
        showToast('Conflict override approved! Conflicting booking move request filed.', 'success');
        closeModal('conflictOverrideModal');
        await loadAllData();
        switchResSubtab('overrides');
      } catch (err) {
        if (errorEl) {
          errorEl.textContent = err.message;
          errorEl.classList.remove('hidden');
        }
      }
    });
  }

  // =========================================================================
  // 8. MODULE 4: USER DIRECTORY
  // =========================================================================

  function renderUsers() {
    const searchInput = document.getElementById('userSearchInput');
    const search = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const roleFilter = document.getElementById('userRoleFilter')?.value || 'all';
    const verFilter = document.getElementById('userVerifiedFilter')?.value || 'all';

    const filtered = state.users.filter(u => {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (verFilter === 'verified' && !u.is_verified) return false;
      if (verFilter === 'unverified' && u.is_verified) return false;

      if (search) {
        const matchesName = (u.name || '').toLowerCase().includes(search);
        const matchesEmail = (u.email || '').toLowerCase().includes(search);
        if (!matchesName && !matchesEmail) return false;
      }
      return true;
    });

    const tbody = document.getElementById('usersTableBody');
    if (!tbody) return;
    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-gray-400 text-xs">No users matching search criteria.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(u => {
      let rolePill = '';
      if (u.role === 'Admin') rolePill = `<span class="badge-admin">Admin</span>`;
      else if (u.role === 'Staff') rolePill = `<span class="badge-staff">Staff</span>`;
      else rolePill = `<span class="badge-customer">Customer</span>`;

      const isCurrentAdmin = state.currentUser && state.currentUser.user_id === u.user_id;

      return `
        <tr class="hover:bg-gray-50/80 transition-colors">
          <td class="py-4 px-6 text-xs font-bold text-gray-900 flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-full bg-gray-200 text-gray-700 flex items-center justify-center font-bold text-[11px] shrink-0">
              ${getInitials(u.name)}
            </div>
            <div>
              <div>${escapeHtml(u.name)}</div>
              ${isCurrentAdmin ? '<span class="text-[10px] text-emerald-600 font-semibold">(You)</span>' : ''}
            </div>
          </td>
          <td class="py-4 px-6 text-xs text-gray-600 font-mono">${escapeHtml(u.email)}</td>
          <td class="py-4 px-6 text-xs">${rolePill}</td>
          <td class="py-4 px-6 text-xs">
            ${u.is_verified
              ? `<span class="text-emerald-700 font-semibold flex items-center gap-1"><span class="material-symbols-outlined text-[15px]">verified</span>Verified</span>`
              : `<span class="text-amber-600 font-semibold flex items-center gap-1"><span class="material-symbols-outlined text-[15px]">hourglass_empty</span>Unverified</span>`
            }
          </td>
          <td class="py-4 px-6 text-xs text-gray-500 whitespace-nowrap">${formatDate(u.created_at)}</td>
          <td class="py-4 px-6 text-right">
            ${isCurrentAdmin ? `<span class="text-xs text-gray-400 italic">Self</span>` : `
              <button type="button" class="btn-change-role px-3 py-1.5 bg-gray-100 hover:bg-[#7a1f2b] hover:text-white text-gray-700 font-bold text-xs rounded-lg transition-colors flex items-center gap-1 ml-auto" data-id="${u.user_id}" data-name="${escapeHtml(u.name)}" data-email="${escapeHtml(u.email)}" data-role="${escapeHtml(u.role)}">
                <span class="material-symbols-outlined text-[16px]">manage_accounts</span>
                <span>Change Role</span>
              </button>
            `}
          </td>
        </tr>
      `;
    }).join('');

    document.querySelectorAll('.btn-change-role').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        const email = btn.getAttribute('data-email');
        const role = btn.getAttribute('data-role');

        document.getElementById('changeRoleUserId').value = id;
        document.getElementById('changeRoleUserName').textContent = name;
        document.getElementById('changeRoleUserEmail').textContent = email;
        const roleSelect = document.getElementById('newAssignedRole');
        if (roleSelect) roleSelect.value = role;

        updateRolePrivilegeNotice(role);
        openModal('changeRoleModal');
      });
    });
  }

  function updateRolePrivilegeNotice(role) {
    const textEl = document.getElementById('rolePrivilegeText');
    const noticeBox = document.getElementById('rolePrivilegeNotice');
    if (!textEl) return;

    if (role === 'Admin') {
      textEl.innerHTML = '<strong>Administrator:</strong> Institutional governance authority. Full access to facility configurations, academic schedules, user permissions, audit trails, and data archives.';
      if (noticeBox) {
        noticeBox.className = 'p-3 rounded-xl text-xs flex items-start gap-2.5 bg-red-50/80 border border-red-200 text-red-900 transition-all';
      }
    } else if (role === 'Staff') {
      textEl.innerHTML = '<strong>Staff:</strong> Operational facility custodian authority. Authorized to approve or reject reservations, process schedule moves, handle cancellations, and flag maintenance.';
      if (noticeBox) {
        noticeBox.className = 'p-3 rounded-xl text-xs flex items-start gap-2.5 bg-purple-50/80 border border-purple-200 text-purple-900 transition-all';
      }
    } else {
      textEl.innerHTML = '<strong>Customer:</strong> Standard user authority. Can browse campus facilities, submit reservations, request conflict overrides, and manage personal bookings.';
      if (noticeBox) {
        noticeBox.className = 'p-3 rounded-xl text-xs flex items-start gap-2.5 bg-blue-50/80 border border-blue-100 text-blue-900 transition-all';
      }
    }
  }

  const newAssignedRoleSelect = document.getElementById('newAssignedRole');
  if (newAssignedRoleSelect) {
    newAssignedRoleSelect.addEventListener('change', () => {
      updateRolePrivilegeNotice(newAssignedRoleSelect.value);
    });
  }

  const userSearchInput = document.getElementById('userSearchInput');
  if (userSearchInput) userSearchInput.addEventListener('input', renderUsers);

  const userRoleFilter = document.getElementById('userRoleFilter');
  if (userRoleFilter) userRoleFilter.addEventListener('change', renderUsers);

  const userVerifiedFilter = document.getElementById('userVerifiedFilter');
  if (userVerifiedFilter) userVerifiedFilter.addEventListener('change', renderUsers);

  // Change Role Form Submit
  const changeRoleForm = document.getElementById('changeRoleForm');
  if (changeRoleForm) {
    changeRoleForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('changeRoleUserId').value;
      const role = document.getElementById('newAssignedRole').value;
      const userName = document.getElementById('changeRoleUserName').textContent || 'User';
      const userEmail = document.getElementById('changeRoleUserEmail').textContent || '';

      const user = state.users.find(u => u.user_id === id);
      const currentRole = user ? user.role : 'Current Role';

      if (currentRole === role) {
        showToast(`User is already assigned the ${role} role.`, 'info');
        closeModal('changeRoleModal');
        return;
      }

      closeModal('changeRoleModal');

      const ok = await confirmAction({
        title: 'Confirm Account Role Change',
        message: `Are you sure you want to change permissions for <strong>${escapeHtml(userName)}</strong> (${escapeHtml(userEmail)}) from <strong>${escapeHtml(currentRole)}</strong> to <strong class="text-[#7a1f2b]">${escapeHtml(role)}</strong>?<br><br><span class="text-xs text-gray-500">This role update takes effect immediately and updates their system authorization level.</span>`,
        proceedText: 'Confirm Role Change',
        icon: 'manage_accounts',
        isDestructive: role === 'Customer',
      });
      if (!ok) return;

      try {
        const res = await apiFetch(`api/users/${id}/role`, {
          method: 'PATCH',
          body: JSON.stringify({ role }),
        });
        showToast(`Account role for ${userName} successfully updated from ${currentRole} to ${role}. Permissions are active immediately.`, 'success');

        if (user) user.role = role;
        renderUsers();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // =========================================================================
  // 9. MODULE 5: SYSTEM, SCHEDULES & CONFIGURATION
  // =========================================================================


  // ── Class Schedules ───────────────────────────────────────────────────────

  async function loadClasses() {
    const tbody = document.getElementById('classesTableBody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-gray-400 text-xs">Loading class schedules...</td></tr>`;

    try {
      const classes = await apiFetch('api/classes');
      state.classes = Array.isArray(classes) ? classes : [];

      if (state.classes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-gray-400 text-xs">No recurring academic class blocks registered.</td></tr>`;
        return;
      }

      tbody.innerHTML = state.classes.map(c => `
        <tr class="hover:bg-gray-50/80 transition-colors">
          <td class="py-4 px-6 font-bold text-gray-900 text-xs">${escapeHtml(c.room_name || 'Room')}</td>
          <td class="py-4 px-6 font-semibold text-gray-800 text-xs">${escapeHtml(c.course_code)}</td>
          <td class="py-4 px-6 text-xs text-gray-600">${escapeHtml(c.section)}</td>
          <td class="py-4 px-6 text-xs font-semibold text-gray-700">${escapeHtml(c.day_of_week)}</td>
          <td class="py-4 px-6 text-xs text-gray-600">${formatTime(c.start_time)} – ${formatTime(c.end_time)}</td>
          <td class="py-4 px-6 text-right">
            <button type="button" class="btn-delete-class p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" data-id="${c.schedule_id}" data-desc="${escapeHtml(c.course_code)} (${escapeHtml(c.day_of_week)})" title="Delete Schedule">
              <span class="material-symbols-outlined text-[19px]">delete</span>
            </button>
          </td>
        </tr>
      `).join('');

      document.querySelectorAll('.btn-delete-class').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-id');
          const desc = btn.getAttribute('data-desc');
          const ok = await confirmAction({
            title: 'Archive Class Schedule Block',
            message: `Are you sure you want to remove weekly class schedule <strong>${desc}</strong>?<br><br><span class="text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200 block text-xs mt-2 text-left"><span class="material-symbols-outlined text-[16px] align-middle mr-1 text-amber-600">inventory_2</span><strong>30-Day Archival Policy:</strong> This record will be moved to the archive and retained for <strong>30 days</strong> before permanent deletion.</span>`,
            proceedText: 'Archive Class Block',
            icon: 'inventory_2',
            isDestructive: true,
          });
          if (!ok) return;

          try {
            await apiFetch(`api/classes/${id}`, { method: 'DELETE' });
            showToast('Class schedule block moved to archive (retained for 30 days before permanent deletion).', 'success');
            loadClasses();
            if (state.activeView === 'archives') loadArchives();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-red-500 text-xs">Failed to load classes: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  const openAddClassModalBtn = document.getElementById('openAddClassModalBtn');
  if (openAddClassModalBtn) {
    openAddClassModalBtn.addEventListener('click', () => {
      const select = document.getElementById('classRoomSelect');
      if (select) {
        select.innerHTML = '<option value="">Select a room...</option>' +
          state.rooms.map(r => `<option value="${r.room_id}">${escapeHtml(r.name)} (${escapeHtml(r.room_type || 'Facility')})</option>`).join('');
      }

      const form = document.getElementById('addClassForm');
      if (form) form.reset();
      openModal('addClassModal');
    });
  }

  const addClassForm = document.getElementById('addClassForm');
  if (addClassForm) {
    addClassForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const room_id = document.getElementById('classRoomSelect').value;
      const course_code = document.getElementById('classCourseCode').value.trim();
      const section = document.getElementById('classSection').value.trim();
      const day_of_week = document.getElementById('classDayOfWeek').value;
      const start_time = document.getElementById('classStartTime').value;
      const end_time = document.getElementById('classEndTime').value;

      try {
        await apiFetch('api/classes', {
          method: 'POST',
          body: JSON.stringify({ room_id, course_code, section, day_of_week, start_time, end_time }),
        });
        showToast(`Class block ${course_code} added successfully!`, 'success');
        closeModal('addClassModal');
        loadClasses();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // ── Holidays ─────────────────────────────────────────────────────────────

  async function loadHolidays() {
    const tbody = document.getElementById('holidaysTableBody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-gray-400 text-xs">Loading holiday calendars...</td></tr>`;

    try {
      const holidays = await apiFetch('api/holidays');
      state.holidays = Array.isArray(holidays) ? holidays : [];

      if (state.holidays.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-gray-400 text-xs">No declared university holidays.</td></tr>`;
        return;
      }

      tbody.innerHTML = state.holidays.map(h => `
        <tr class="hover:bg-gray-50/80 transition-colors">
          <td class="py-4 px-6 font-bold text-gray-900 text-xs whitespace-nowrap">${formatDate(h.holiday_date)}</td>
          <td class="py-4 px-6 font-semibold text-gray-800 text-xs">${escapeHtml(h.name)}</td>
          <td class="py-4 px-6 text-xs text-gray-600">
            <span class="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${h.type === 'Regular' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}">
              ${escapeHtml(h.type)}
            </span>
          </td>
          <td class="py-4 px-6 text-right">
            <button type="button" class="btn-delete-holiday p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors" data-date="${h.holiday_date}" data-name="${escapeHtml(h.name)}" title="Delete Holiday">
              <span class="material-symbols-outlined text-[19px]">delete</span>
            </button>
          </td>
        </tr>
      `).join('');

      document.querySelectorAll('.btn-delete-holiday').forEach(btn => {
        btn.addEventListener('click', async () => {
          const date = btn.getAttribute('data-date');
          const name = btn.getAttribute('data-name');
          const ok = await confirmAction({
            title: 'Archive University Holiday Closure',
            message: `Are you sure you want to remove <strong>${escapeHtml(name)}</strong> on ${escapeHtml(date)}? Rooms will become reservable on this date.<br><br><span class="text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200 block text-xs mt-2 text-left"><span class="material-symbols-outlined text-[16px] align-middle mr-1 text-amber-600">inventory_2</span><strong>30-Day Archival Policy:</strong> This calendar closure will be moved to the archive and retained for <strong>30 days</strong> before permanent deletion.</span>`,
            proceedText: 'Archive Holiday',
            icon: 'inventory_2',
            isDestructive: true,
          });
          if (!ok) return;

          try {
            await apiFetch(`api/holidays/${date}`, { method: 'DELETE' });
            showToast('Holiday closure moved to archive (retained for 30 days before permanent deletion).', 'success');
            loadHolidays();
            if (state.activeView === 'archives') loadArchives();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-red-500 text-xs">Failed to load holidays: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  const openAddHolidayModalBtn = document.getElementById('openAddHolidayModalBtn');
  if (openAddHolidayModalBtn) {
    openAddHolidayModalBtn.addEventListener('click', () => {
      const form = document.getElementById('addHolidayForm');
      if (form) form.reset();
      openModal('addHolidayModal');
    });
  }

  const addHolidayForm = document.getElementById('addHolidayForm');
  if (addHolidayForm) {
    addHolidayForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const holiday_date = document.getElementById('newHolidayDate').value;
      const name = document.getElementById('newHolidayName').value.trim();
      const type = document.getElementById('newHolidayType').value;

      try {
        await apiFetch('api/holidays', {
          method: 'POST',
          body: JSON.stringify({ holiday_date, name, type }),
        });
        showToast(`Holiday "${name}" declared for ${holiday_date}.`, 'success');
        closeModal('addHolidayModal');
        loadHolidays();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // ── System Configuration (Operating Hours & Closed Days) ──────────────────

  async function renderSystemSettings() {
    try {
      if (!state.settings) {
        state.settings = await apiFetch('api/settings');
      }
      const s = state.settings || {};

      const startEl = document.getElementById('configHoursStart');
      const endEl = document.getElementById('configHoursEnd');
      if (startEl && s.business_hours_start) startEl.value = s.business_hours_start;
      if (endEl && s.business_hours_end) endEl.value = s.business_hours_end;

      const closedDays = Array.isArray(s.closed_days) ? s.closed_days : [];
      const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      days.forEach(day => {
        const cb = document.getElementById(`closedDay${day}`);
        if (cb) cb.checked = closedDays.includes(day);
      });
    } catch (err) {
      console.error('Failed to load system settings:', err);
      showToast('Could not load current system configuration.', 'error');
    }
  }

  const systemSettingsForm = document.getElementById('systemSettingsForm');
  if (systemSettingsForm) {
    systemSettingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const start = document.getElementById('configHoursStart').value;
      const end = document.getElementById('configHoursEnd').value;

      if (!start || !end) {
        showToast('Both opening and closing operational times are required.', 'error');
        return;
      }
      if (end <= start) {
        showToast('Closing time must be later than opening time.', 'error');
        return;
      }

      const closedDays = [];
      document.querySelectorAll('input[name="configClosedDays"]:checked').forEach(cb => {
        closedDays.push(cb.value);
      });

      try {
        const payload = {
          business_hours_start: start,
          business_hours_end: end,
          closed_days: closedDays,
        };
        const updated = await apiFetch('api/settings', {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        state.settings = updated || payload;
        showToast('Institution operational hours & closure policy updated.', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  const btnReloadSettings = document.getElementById('btn-reload-settings');
  if (btnReloadSettings) {
    btnReloadSettings.addEventListener('click', async () => {
      state.settings = null;
      await renderSystemSettings();
      showToast('Configuration reset to current server state.', 'info');
    });
  }

  // ── Audit Logs ────────────────────────────────────────────────────────────

  async function loadAuditLogs() {
    const tbody = document.getElementById('logsTableBody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="3" class="p-8 text-center text-gray-400 text-xs">Loading audit logs...</td></tr>`;

    const searchEl = document.getElementById('logSearchInput');
    const q = searchEl ? searchEl.value.trim() : '';
    const query = new URLSearchParams({
      limit: String(state.logsLimit),
      offset: String(state.logsOffset),
    });
    if (q) query.set('q', q);

    try {
      const data = await apiFetch(`api/logs?${query.toString()}`);
      state.logs = (data && data.items) || [];
      state.logsTotal = (data && data.total) || 0;

      // Update Pagination UI
      const currentPage = Math.floor(state.logsOffset / state.logsLimit) + 1;
      const totalPages = Math.max(1, Math.ceil(state.logsTotal / state.logsLimit));
      const pageInd = document.getElementById('logPageIndicator');
      if (pageInd) {
        pageInd.textContent = `Page ${currentPage} of ${totalPages} (${state.logsTotal} total events)`;
      }

      const btnPrev = document.getElementById('btn-log-prev');
      const btnNext = document.getElementById('btn-log-next');
      if (btnPrev) btnPrev.disabled = state.logsOffset <= 0;
      if (btnNext) btnNext.disabled = state.logsOffset + state.logsLimit >= state.logsTotal;

      if (state.logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="p-8 text-center text-gray-400 text-xs">No audit events match your search query.</td></tr>`;
        return;
      }

      tbody.innerHTML = state.logs.map(l => `
        <tr class="hover:bg-gray-50/80 transition-colors">
          <td class="py-3 px-6 text-xs text-gray-500 whitespace-nowrap">${formatDateTime(l.timestamp)}</td>
          <td class="py-3 px-6 text-xs font-mono font-semibold text-gray-700" title="${escapeHtml(l.user_id || '')}">
            ${escapeHtml(l.user_name || (l.user_id ? l.user_id.substring(0, 8) : 'System'))}
          </td>
          <td class="py-3 px-6 text-xs text-gray-800 leading-normal">
            ${escapeHtml(l.action_type)}
            ${l.reservation_id ? `<span class="ml-2 text-[10px] font-mono text-gray-400">(Ref: ${escapeHtml(l.reservation_id.substring(0,8))})</span>` : ''}
          </td>
        </tr>
      `).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="3" class="p-8 text-center text-red-500 text-xs">Failed to load audit logs: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  const btnSearchLogs = document.getElementById('btn-search-logs');
  if (btnSearchLogs) {
    btnSearchLogs.addEventListener('click', () => {
      state.logsOffset = 0;
      loadAuditLogs();
    });
  }

  const logSearchInput = document.getElementById('logSearchInput');
  if (logSearchInput) {
    logSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        state.logsOffset = 0;
        loadAuditLogs();
      }
    });
  }

  const btnLogPrev = document.getElementById('btn-log-prev');
  if (btnLogPrev) {
    btnLogPrev.addEventListener('click', () => {
      if (state.logsOffset > 0) {
        state.logsOffset = Math.max(0, state.logsOffset - state.logsLimit);
        loadAuditLogs();
      }
    });
  }

  const btnLogNext = document.getElementById('btn-log-next');
  if (btnLogNext) {
    btnLogNext.addEventListener('click', () => {
      if (state.logsOffset + state.logsLimit < state.logsTotal) {
        state.logsOffset += state.logsLimit;
        loadAuditLogs();
      }
    });
  }

  // =========================================================================
  // 9c. MODULE: DATA ARCHIVES (30-Day Retention Governance)
  // =========================================================================

  async function loadArchives() {
    const tbody = document.getElementById('archivesTableBody');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-gray-400 text-xs">Loading archived records repository...</td></tr>`;

    try {
      const type = document.getElementById('archiveTypeFilter')?.value || 'all';
      const search = document.getElementById('archiveSearchInput')?.value || '';
      const params = new URLSearchParams();
      if (type !== 'all') params.append('table_name', type);
      if (search.trim()) params.append('q', search.trim());

      const res = await apiFetch(`api/archives?${params.toString()}`);
      if (res && res.data) {
        state.archives = res.data.items || [];
        state.archiveStats = res.data.stats || { total: 0, classschedules: 0, holidays: 0, reservations: 0 };
        updateArchiveBadgesAndStats();
        renderArchives();
      }
    } catch (err) {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-red-500 text-xs">Failed to load archived records: ${escapeHtml(err.message)}</td></tr>`;
      }
    }
  }

  function updateArchiveBadgesAndStats() {
    const totalEl = document.getElementById('statArchiveTotal');
    const classesEl = document.getElementById('statArchiveClasses');
    const holidaysEl = document.getElementById('statArchiveHolidays');
    const reservationsEl = document.getElementById('statArchiveReservations');
    const badgeSidebar = document.getElementById('badge-archives-count');

    const stats = state.archiveStats || {};
    if (totalEl) totalEl.textContent = stats.total ?? state.archives.length ?? 0;
    if (classesEl) classesEl.textContent = stats.classschedules ?? 0;
    if (holidaysEl) holidaysEl.textContent = stats.holidays ?? 0;
    if (reservationsEl) reservationsEl.textContent = stats.reservations ?? 0;
    if (badgeSidebar) badgeSidebar.textContent = stats.total ?? state.archives.length ?? 0;
  }

  function renderArchives() {
    const tbody = document.getElementById('archivesTableBody');
    if (!tbody) return;

    if (!state.archives || state.archives.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="p-8 text-center text-gray-400 text-xs">
            <span class="material-symbols-outlined text-[28px] text-gray-300 block mb-1">inventory_2</span>
            No records currently in archive. All active data is current.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = state.archives.map(a => {
      let typePill = '';
      if (a.table_name === 'classschedules') {
        typePill = `<span class="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">Class Schedule</span>`;
      } else if (a.table_name === 'holidays') {
        typePill = `<span class="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">Holiday Closure</span>`;
      } else if (a.table_name === 'reservations') {
        typePill = `<span class="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">Reservation</span>`;
      } else {
        typePill = `<span class="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-50 text-gray-700 border border-gray-200">${escapeHtml(a.table_name)}</span>`;
      }

      const daysLeft = parseInt(a.days_remaining, 10);
      const retentionBadge = daysLeft > 5
        ? `<span class="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>${daysLeft} days left</span>`
        : `<span class="inline-flex items-center gap-1 text-xs font-semibold text-red-700 bg-red-50 px-2.5 py-0.5 rounded-full border border-red-200"><span class="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>${daysLeft} days left</span>`;

      return `
        <tr class="hover:bg-gray-50/80 transition-colors">
          <td class="py-4 px-6 font-semibold text-gray-900 text-xs">
            <div>${escapeHtml(a.record_summary || a.record_id)}</div>
            ${a.reason ? `<div class="text-[11px] text-gray-400 font-normal mt-0.5">${escapeHtml(a.reason)}</div>` : ''}
          </td>
          <td class="py-4 px-6 text-xs whitespace-nowrap">${typePill}</td>
          <td class="py-4 px-6 text-xs text-gray-600 font-mono whitespace-nowrap">${formatDate(a.archived_at)}</td>
          <td class="py-4 px-6 text-xs text-gray-700 font-medium whitespace-nowrap">${escapeHtml(a.archived_by_name || 'System / Admin')}</td>
          <td class="py-4 px-6 text-xs whitespace-nowrap">${retentionBadge}</td>
          <td class="py-4 px-6 text-right whitespace-nowrap">
            <button
              type="button"
              class="btn-view-archive px-3 py-1.5 bg-gray-100 hover:bg-[#7a1f2b] hover:text-white text-gray-700 font-bold text-xs rounded-lg transition-colors inline-flex items-center gap-1 ml-auto"
              data-id="${a.archive_id}"
            >
              <span class="material-symbols-outlined text-[15px]">visibility</span>
              <span>View Data</span>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    document.querySelectorAll('.btn-view-archive').forEach(btn => {
      btn.addEventListener('click', () => {
        showArchiveDetails(btn.getAttribute('data-id'));
      });
    });
  }

  function showArchiveDetails(archiveId) {
    const item = state.archives.find(a => a.archive_id === archiveId);
    if (!item) return;

    const typeEl = document.getElementById('archiveDetailType');
    const summaryEl = document.getElementById('archiveDetailSummary');
    const archivedAtEl = document.getElementById('archiveDetailArchivedAt');
    const purgeAtEl = document.getElementById('archiveDetailPurgeAt');
    const actorEl = document.getElementById('archiveDetailActor');
    const retentionEl = document.getElementById('archiveDetailRetention');
    const jsonEl = document.getElementById('archiveDetailJson');

    if (typeEl) typeEl.textContent = item.table_name;
    if (summaryEl) summaryEl.textContent = item.record_summary;
    if (archivedAtEl) archivedAtEl.textContent = item.archived_at;
    if (purgeAtEl) purgeAtEl.textContent = item.purge_at;
    if (actorEl) actorEl.textContent = item.archived_by_name || 'System / Admin';
    if (retentionEl) retentionEl.textContent = `${item.days_remaining} calendar days remaining before permanent purge`;
    if (jsonEl) {
      jsonEl.textContent = JSON.stringify(item.record_data, null, 2);
    }

    openModal('archiveDetailModal');
  }

  const btnRefreshArchives = document.getElementById('btnRefreshArchives');
  if (btnRefreshArchives) {
    btnRefreshArchives.addEventListener('click', loadArchives);
  }

  const archiveTypeFilter = document.getElementById('archiveTypeFilter');
  if (archiveTypeFilter) {
    archiveTypeFilter.addEventListener('change', loadArchives);
  }

  const archiveSearchInput = document.getElementById('archiveSearchInput');
  if (archiveSearchInput) {
    let debounceTimer;
    archiveSearchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(loadArchives, 300);
    });
  }

  // =========================================================================
  // 10. INITIALIZATION
  // =========================================================================

  async function init() {
    const isAuth = await checkAdminAuth();
    if (!isAuth) return;

    await loadAllData();

    // Check URL Hash for deep linking
    const hash = window.location.hash.replace('#', '');
    if (hash && viewTitles[hash]) {
      switchView(hash);
    }
  }

  init();
});
