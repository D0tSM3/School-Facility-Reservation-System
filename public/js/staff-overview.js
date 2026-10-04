document.addEventListener('DOMContentLoaded', async () => {
  'use strict';

  const base = window.location.pathname.replace(/[^\/]*$/, '');
  const byId = (id) => document.getElementById(id);
  const errorEl = byId('overview-error');

  async function getData(path) {
    const response = await fetch(base + path, { credentials: 'same-origin' });
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error(`The server returned an invalid response for ${path}.`);
    }

    if (response.status === 401) {
      window.location.replace(base + 'index.html');
      throw new Error('Your session has expired. Please sign in again.');
    }
    if (!response.ok || !payload || payload.success === false) {
      throw new Error(payload?.error || `Request failed (HTTP ${response.status}) for ${path}.`);
    }
    if (!Array.isArray(payload.data)) {
      throw new Error(`The server returned invalid data for ${path}.`);
    }
    return payload.data;
  }

  function setCount(id, count) {
    const element = byId(id);
    if (element) element.textContent = String(count);
  }

  function setBadge(id, count) {
    const element = byId(id);
    if (element) element.textContent = String(count);
  }

  function isToday(value) {
    if (!value) return false;
    const date = new Date(String(value).replace(' ', 'T'));
    const today = new Date();
    return !Number.isNaN(date.getTime())
      && date.getFullYear() === today.getFullYear()
      && date.getMonth() === today.getMonth()
      && date.getDate() === today.getDate();
  }

  try {
    const meResponse = await fetch(base + 'api/auth/me', { credentials: 'same-origin' });
    const mePayload = await meResponse.json();
    if (meResponse.status === 401 || !mePayload?.success || !mePayload.data) {
      window.location.replace(base + 'index.html');
      return;
    }

    const role = String(mePayload.data.role || '');
    if (role !== 'Staff' && role !== 'Admin') {
      window.location.replace(base + 'dashboard.html');
      return;
    }

    const [reservations, pendingApprovals, rooms, moves, cancellations, overrides] = await Promise.all([
      getData('api/reservations'),
      getData('api/reservations?status=Pending&limit=500'),
      getData('api/rooms'),
      getData('api/reservations/move-requests?status=Pending'),
      getData('api/reservations/cancel-requests?status=Pending'),
      getData('api/conflict-override-requests?status=Pending')
    ]);

    const pending = pendingApprovals.length;
    const maintenance = rooms.filter((item) => item.status === 'Maintenance' && Number(item.is_active) !== 0).length;
    const approvedToday = reservations.filter((item) => item.status === 'Approved' && isToday(item.processed_at)).length;

    setCount('kpi-pending-count', pending);
    setCount('kpi-moves-count', moves.length);
    setCount('kpi-cancels-count', cancellations.length);
    setCount('kpi-overrides-count', overrides.length);
    setCount('kpi-maintenance-count', maintenance);
    setCount('kpi-approved-today-count', approvedToday);

    setBadge('pending-badge-count', pending);
    setBadge('move-badge-count', moves.length);
    setBadge('cancel-badge-count', cancellations.length);
    setBadge('override-badge-count', overrides.length);
    setBadge('facility-badge-count', rooms.length);
  } catch (error) {
    console.error('[staff-overview] failed to load dashboard metrics:', error);
    if (errorEl) {
      errorEl.textContent = error.message;
      errorEl.classList.remove('hidden');
    }
  }
});
