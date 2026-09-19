/**
 * CampusRoom — Log archive modal (shared component, Section 13)
 *
 * One component used by the customer page (my-reservations.html) and the
 * staff dispatch queue (staff-queue.html):
 *
 *   window.CampusRoomLogArchive.open(reservationId)   per-booking timeline
 *   window.CampusRoomLogArchive.openGlobal()          Staff/Admin audit search
 *   window.CampusRoomLogArchive.close()
 *
 * Load order on a page:
 *   <script src="js/util.js"></script>   (escapeHtml)
 *   <script src="js/logArchive.js"></script>
 *   <script src="js/<page>.js"></script>
 *
 * Design notes
 *   - open(id) always fetches GET api/reservations/{id}/logs. The ownership
 *     check lives server-side (Section 8) — a Customer only ever gets their
 *     own booking's rows back, a 403, or a 404. This component never decides
 *     that on its own.
 *   - openGlobal() is Staff/Admin only. Nothing on this page enforces that;
 *     it must only ever be wired up from a page already gated to those
 *     roles (staff-queue.html). GET api/logs itself also 403s a Customer,
 *     so a stray call here fails safely, but it should never be offered.
 *   - action_type is free text (Section 8) — icon/colour matching is a best
 *     effort by keyword, with a neutral fallback for anything unmatched.
 *   - Timestamps are zone-less DATETIME/TIMESTAMP strings that are already
 *     Asia/Manila wall-clock time (Section 9), same convention as slip.js.
 *     They are formatted literally, never through the viewer's device
 *     timezone.
 *   - Builds its own DOM and injects its own <style>, so both pages need
 *     nothing but the script tags.
 *   - The "Actor" filter in the global view has no directory endpoint to
 *     draw from — GET api/users is Admin-only and this view is also open to
 *     Staff. Instead it is populated from actors seen in loaded pages,
 *     growing as the operator pages or filters further. Documented in the
 *     Section 13 handoff notes as a known limitation, not a bug.
 */
(function () {
  'use strict';

  if (!window.CampusRoomUtil) {
    console.error('[logArchive] js/util.js must be loaded before js/logArchive.js');
    return;
  }

  const { escapeHtml } = window.CampusRoomUtil;
  const BASE = window.location.pathname.replace(/[^\/]*$/, '');

  // ---------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------

  const STYLE_ID = 'crLogStyles';
  const ROOT_ID = 'crLogRoot';
  const OPEN_CLASS = 'cr-log-open';

  const GLOBAL_PAGE_SIZE = 25;
  const EXPORT_PAGE_SIZE = 500; // server caps at 500 (see Section 8's UserController::logs)
  const EXPORT_PAGE_CAP = 40;   // 40 * 500 = 20,000 rows; a defensive ceiling, not an expected case
  const SEARCH_DEBOUNCE_MS = 400;

  const state = {
    mode: null,              // 'reservation' | 'global'
    ticket: 0,               // bumped per load so a slow, stale response can't overwrite a newer one
    returnFocusTo: null,
    // reservation mode
    reservationId: null,
    reservationHeader: null, // { room_name, purpose } lifted from the first row, once loaded
    // global mode
    filters: { from: '', to: '', q: '', user_id: '' },
    page: { limit: GLOBAL_PAGE_SIZE, offset: 0, total: 0 },
    items: [],
    actors: new Map(),       // user_id -> "Name (Role)", accumulated across loads
    exporting: false
  };

  let root = null;
  let bodyEl = null;
  let titleEl = null;
  let searchDebounceTimer = null;

  // ---------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------

  function has(value) {
    return value !== null && value !== undefined && String(value).trim() !== '';
  }

  const DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

  /** Same wall-clock parsing slip.js uses: the DB's Asia/Manila string, taken literally. */
  function wallClock(value) {
    const m = DATETIME_PATTERN.exec(String(value ?? ''));
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)));
  }

  function fmt(value, options) {
    const date = wallClock(value);
    return date ? date.toLocaleString('en-US', { ...options, timeZone: 'UTC' }) : '—';
  }

  const formatTimestamp = (value) => fmt(value, {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });

  function permitRef(reservationId) {
    return has(reservationId) ? 'REQ-' + String(reservationId).substring(0, 8).toUpperCase() : '—';
  }

  /** Same quote-escaping approach as staff-queue.js's and reservations.js's csvCell(). */
  function csvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  function downloadCsv(filename, rows) {
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * action_type is free text (Section 8's insertLog() call sites), so this is
   * a best-effort keyword match, not an exhaustive enum. Checked most-specific
   * first: an outcome word (approved/rejected) wins over the broader event
   * category (e.g. "Move request Approved" reads as an approval, not just a
   * move event) — everything else falls back to a neutral dot.
   */
  function classify(actionType) {
    const s = String(actionType || '').toLowerCase();
    if (s.includes('rejected')) return { icon: 'cancel', fg: '#B91C1C', bg: '#FEE2E2' };
    if (s.includes('approved')) return { icon: 'check_circle', fg: '#15803D', bg: '#DCFCE7' };
    if (s.includes('cancelled') || s.includes('canceled')) return { icon: 'block', fg: '#B91C1C', bg: '#FEE2E2' };
    if (s.includes('re-booked') || s.includes('rebooked')) return { icon: 'replay', fg: '#1D4ED8', bg: '#DBEAFE' };
    if (s.includes('move request')) return { icon: 'edit_calendar', fg: '#B45309', bg: '#FEF3C7' };
    if (s.includes('submitted')) return { icon: 'add_circle', fg: '#1D4ED8', bg: '#DBEAFE' };
    return { icon: 'fiber_manual_record', fg: '#6B7280', bg: '#F1F5F9' };
  }

  function actorLabel(log) {
    return has(log.actor_name)
      ? `${escapeHtml(log.actor_name)} <span class="cr-log-actor-role">(${escapeHtml(log.actor_role || '—')})</span>`
      : '<span class="cr-log-actor-role">System / deleted user</span>';
  }

  // ---------------------------------------------------------------
  // Reservation (per-booking) timeline
  // ---------------------------------------------------------------

  function timelineItemHtml(log) {
    const style = classify(log.action_type);
    return `
      <li class="cr-log-item">
        <span class="cr-log-dot" style="color:${style.fg};background:${style.bg}">
          <span class="material-symbols-outlined" aria-hidden="true">${style.icon}</span>
        </span>
        <div class="cr-log-item-body">
          <div class="cr-log-item-top">
            <span class="cr-log-timestamp">${escapeHtml(formatTimestamp(log.timestamp))}</span>
            <span class="cr-log-actor">${actorLabel(log)}</span>
          </div>
          <div class="cr-log-action">${escapeHtml(log.action_type)}</div>
        </div>
      </li>`;
  }

  function reservationEmptyHtml() {
    return `
      <div class="cr-log-state">
        <span class="material-symbols-outlined cr-log-empty-icon" aria-hidden="true">history_toggle_off</span>
        <p>No audit entries recorded for this reservation.</p>
      </div>`;
  }

  function reservationBodyHtml(items) {
    if (!items.length) return reservationEmptyHtml();
    return `<ul class="cr-log-timeline">${items.map(timelineItemHtml).join('')}</ul>`;
  }

  async function loadReservation(reservationId) {
    const ticket = ++state.ticket;
    state.reservationId = reservationId;
    state.reservationHeader = null;
    bodyEl.innerHTML = loadingHtml('Loading log archive…');
    setTitle('Log Archive', permitRef(reservationId));

    try {
      const response = await fetch(
        BASE + 'api/reservations/' + encodeURIComponent(reservationId) + '/logs?limit=200',
        { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } }
      );

      let json = null;
      try { json = await response.json(); } catch (_) { json = null; }

      if (ticket !== state.ticket) return; // a newer open() superseded this one

      if (response.status === 401) {
        bodyEl.innerHTML = errorHtml('Your session has expired. Please sign in again.', { retry: false, signIn: true });
        return;
      }
      if (response.status === 403) {
        bodyEl.innerHTML = errorHtml('You do not have permission to view this booking\u2019s log.', { retry: false });
        return;
      }
      if (response.status === 404) {
        bodyEl.innerHTML = errorHtml('This reservation could not be found.', { retry: false });
        return;
      }
      if (!response.ok || !json || json.success === false || !json.data) {
        bodyEl.innerHTML = errorHtml((json && json.error) || `Could not load the log archive (HTTP ${response.status}).`);
        return;
      }

      const items = Array.isArray(json.data.items) ? json.data.items : [];
      const total = Number(json.data.total) || items.length;

      if (items[0]) {
        state.reservationHeader = { room_name: items[0].room_name, purpose: items[0].purpose };
        const sub = [permitRef(reservationId), items[0].room_name].filter(has).join(' · ');
        setTitle('Log Archive', sub);
      }

      let html = reservationBodyHtml(items);
      if (total > items.length) {
        html += `<p class="cr-log-note">Showing the ${items.length} most recent of ${total} entries.</p>`;
      }
      bodyEl.innerHTML = html;
    } catch (error) {
      console.error('[logArchive] failed to load reservation logs', reservationId, error);
      if (ticket !== state.ticket) return;
      bodyEl.innerHTML = errorHtml('Network error. Check that the server is reachable.');
    }
  }

  // ---------------------------------------------------------------
  // Global (Staff/Admin) audit search
  // ---------------------------------------------------------------

  function rememberActors(items) {
    items.forEach((log) => {
      if (has(log.user_id) && has(log.actor_name) && !state.actors.has(log.user_id)) {
        state.actors.set(log.user_id, `${log.actor_name} (${log.actor_role || '—'})`);
      }
    });
  }

  function actorOptionsHtml() {
    const options = ['<option value="">All actors</option>'];
    Array.from(state.actors.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .forEach(([id, label]) => {
        const selected = id === state.filters.user_id ? ' selected' : '';
        options.push(`<option value="${escapeHtml(id)}"${selected}>${escapeHtml(label)}</option>`);
      });
    return options.join('');
  }

  function globalFiltersHtml() {
    return `
      <div class="cr-log-filters">
        <label class="cr-log-field">
          <span>From</span>
          <input type="date" id="crLogFrom" value="${escapeHtml(state.filters.from)}" max="${escapeHtml(state.filters.to || '')}">
        </label>
        <label class="cr-log-field">
          <span>To</span>
          <input type="date" id="crLogTo" value="${escapeHtml(state.filters.to)}" min="${escapeHtml(state.filters.from || '')}">
        </label>
        <label class="cr-log-field">
          <span>Actor</span>
          <select id="crLogActor">${actorOptionsHtml()}</select>
        </label>
        <label class="cr-log-field cr-log-field-grow">
          <span>Search action</span>
          <input type="text" id="crLogSearch" placeholder="e.g. approved, cancelled…" maxlength="100" value="${escapeHtml(state.filters.q)}">
        </label>
        <button type="button" class="cr-log-btn" id="crLogClearFilters">Clear filters</button>
      </div>`;
  }

  function globalRowHtml(log) {
    const style = classify(log.action_type);
    return `
      <tr>
        <td class="cr-log-td-nowrap">${escapeHtml(formatTimestamp(log.timestamp))}</td>
        <td>${actorLabel(log)}</td>
        <td class="cr-log-td-nowrap">${escapeHtml(permitRef(log.reservation_id))}</td>
        <td>${escapeHtml(log.room_name || '—')}</td>
        <td>
          <span class="cr-log-badge" style="color:${style.fg};background:${style.bg}">
            <span class="material-symbols-outlined" aria-hidden="true">${style.icon}</span>
          </span>
          ${escapeHtml(log.action_type)}
        </td>
      </tr>`;
  }

  function globalTableHtml(items) {
    if (!items.length) {
      return `
        <div class="cr-log-state cr-log-state-compact">
          <span class="material-symbols-outlined cr-log-empty-icon" aria-hidden="true">search_off</span>
          <p>No log entries match these filters.</p>
        </div>`;
    }
    return `
      <div class="cr-log-table-wrap">
        <table class="cr-log-table">
          <thead>
            <tr><th>Timestamp</th><th>Actor</th><th>Booking</th><th>Room</th><th>Action</th></tr>
          </thead>
          <tbody>${items.map(globalRowHtml).join('')}</tbody>
        </table>
      </div>`;
  }

  function globalPagerHtml() {
    const { limit, offset, total } = state.page;
    const shown = state.items.length;
    const from = total === 0 ? 0 : offset + 1;
    const to = offset + shown;
    return `
      <div class="cr-log-pager">
        <span class="cr-log-pager-count">${from}\u2013${to} of ${total}</span>
        <div class="cr-log-pager-btns">
          <button type="button" class="cr-log-btn" id="crLogPrev" ${offset <= 0 ? 'disabled' : ''}>Previous</button>
          <button type="button" class="cr-log-btn" id="crLogNext" ${offset + limit >= total ? 'disabled' : ''}>Next</button>
        </div>
      </div>`;
  }

  function globalExportBarHtml() {
    return `
      <div class="cr-log-export-bar">
        <button type="button" class="cr-log-btn" id="crLogExportPage" ${state.items.length ? '' : 'disabled'}>
          <span class="material-symbols-outlined" aria-hidden="true">file_download</span><span>Download this page (CSV)</span>
        </button>
        <button type="button" class="cr-log-btn cr-log-btn-primary" id="crLogExportAll" ${state.page.total ? '' : 'disabled'}>
          <span class="material-symbols-outlined" aria-hidden="true">cloud_download</span>
          <span>${state.exporting ? 'Exporting…' : 'Export all matching (CSV)'}</span>
        </button>
      </div>`;
  }

  function renderGlobalBody() {
    bodyEl.innerHTML = `
      ${globalFiltersHtml()}
      ${globalExportBarHtml()}
      ${globalTableHtml(state.items)}
      ${globalPagerHtml()}`;
    bindGlobalControls();
  }

  function bindGlobalControls() {
    const fromInput = bodyEl.querySelector('#crLogFrom');
    const toInput = bodyEl.querySelector('#crLogTo');
    const actorSelect = bodyEl.querySelector('#crLogActor');
    const searchInput = bodyEl.querySelector('#crLogSearch');
    const clearBtn = bodyEl.querySelector('#crLogClearFilters');
    const prevBtn = bodyEl.querySelector('#crLogPrev');
    const nextBtn = bodyEl.querySelector('#crLogNext');
    const exportPageBtn = bodyEl.querySelector('#crLogExportPage');
    const exportAllBtn = bodyEl.querySelector('#crLogExportAll');

    if (fromInput) fromInput.addEventListener('change', () => {
      state.filters.from = fromInput.value;
      loadGlobal({ resetPage: true });
    });
    if (toInput) toInput.addEventListener('change', () => {
      state.filters.to = toInput.value;
      loadGlobal({ resetPage: true });
    });
    if (actorSelect) actorSelect.addEventListener('change', () => {
      state.filters.user_id = actorSelect.value;
      loadGlobal({ resetPage: true });
    });
    if (searchInput) searchInput.addEventListener('input', () => {
      window.clearTimeout(searchDebounceTimer);
      searchDebounceTimer = window.setTimeout(() => {
        state.filters.q = searchInput.value.trim();
        loadGlobal({ resetPage: true });
      }, SEARCH_DEBOUNCE_MS);
    });
    if (clearBtn) clearBtn.addEventListener('click', () => {
      state.filters = { from: '', to: '', q: '', user_id: '' };
      loadGlobal({ resetPage: true });
    });
    if (prevBtn) prevBtn.addEventListener('click', () => {
      state.page.offset = Math.max(0, state.page.offset - state.page.limit);
      loadGlobal({});
    });
    if (nextBtn) nextBtn.addEventListener('click', () => {
      state.page.offset = state.page.offset + state.page.limit;
      loadGlobal({});
    });
    if (exportPageBtn) exportPageBtn.addEventListener('click', exportCurrentPage);
    if (exportAllBtn) exportAllBtn.addEventListener('click', exportAllMatching);
  }

  function buildQuery(extra) {
    const params = new URLSearchParams();
    if (state.filters.from) params.set('from', state.filters.from);
    if (state.filters.to) params.set('to', state.filters.to);
    if (state.filters.q) params.set('q', state.filters.q);
    if (state.filters.user_id) params.set('user_id', state.filters.user_id);
    Object.entries(extra || {}).forEach(([k, v]) => params.set(k, String(v)));
    return params.toString();
  }

  async function fetchLogsPage(limit, offset) {
    const response = await fetch(BASE + 'api/logs?' + buildQuery({ limit, offset }), {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    let json = null;
    try { json = await response.json(); } catch (_) { json = null; }
    return { response, json };
  }

  async function loadGlobal(options) {
    if (options && options.resetPage) state.page.offset = 0;

    const ticket = ++state.ticket;
    bodyEl.innerHTML = globalFiltersHtml() + loadingHtml('Loading audit log…');
    bindGlobalControls();

    try {
      const { response, json } = await fetchLogsPage(state.page.limit, state.page.offset);
      if (ticket !== state.ticket) return;

      if (response.status === 401) {
        bodyEl.innerHTML = errorHtml('Your session has expired. Please sign in again.', { retry: false, signIn: true });
        return;
      }
      if (response.status === 403) {
        bodyEl.innerHTML = errorHtml('Only Staff and Admin accounts can view the audit log.', { retry: false });
        return;
      }
      if (!response.ok || !json || json.success === false || !json.data) {
        bodyEl.innerHTML = errorHtml((json && json.error) || `Could not load the audit log (HTTP ${response.status}).`);
        return;
      }

      state.items = Array.isArray(json.data.items) ? json.data.items : [];
      state.page.total = Number(json.data.total) || 0;
      state.page.limit = Number(json.data.limit) || state.page.limit;
      state.page.offset = Number(json.data.offset) || 0;
      rememberActors(state.items);

      renderGlobalBody();
    } catch (error) {
      console.error('[logArchive] failed to load audit log', error);
      if (ticket !== state.ticket) return;
      bodyEl.innerHTML = globalFiltersHtml() + errorHtml('Network error. Check that the server is reachable.');
      bindGlobalControls();
    }
  }

  function exportRowsFor(items) {
    const rows = ['Log ID,Timestamp,Actor Name,Actor Role,Actor Email,Booking,Room,Action'];
    items.forEach((log) => {
      rows.push([
        csvCell(log.log_id),
        csvCell(log.timestamp),
        csvCell(log.actor_name || 'System'),
        csvCell(log.actor_role || ''),
        csvCell(log.actor_email || ''),
        csvCell(permitRef(log.reservation_id)),
        csvCell(log.room_name || ''),
        csvCell(log.action_type)
      ].join(','));
    });
    return rows;
  }

  function exportCurrentPage() {
    if (!state.items.length) return;
    downloadCsv(`CampusRoom_AuditLog_page_${new Date().toISOString().slice(0, 10)}.csv`, exportRowsFor(state.items));
  }

  async function exportAllMatching() {
    if (state.exporting || !state.page.total) return;
    state.exporting = true;
    renderGlobalBody();

    const collected = [];
    let offset = 0;
    let total = state.page.total;

    try {
      for (let page = 0; page < EXPORT_PAGE_CAP; page++) {
        const { response, json } = await fetchLogsPage(EXPORT_PAGE_SIZE, offset);
        if (!response.ok || !json || json.success === false || !json.data) {
          showTransientNote('Export stopped early — could not load a page of results.');
          break;
        }
        const items = Array.isArray(json.data.items) ? json.data.items : [];
        collected.push(...items);
        total = Number(json.data.total) || total;
        offset += EXPORT_PAGE_SIZE;
        if (offset >= total || items.length === 0) break;
      }

      if (collected.length) {
        downloadCsv(`CampusRoom_AuditLog_all_${new Date().toISOString().slice(0, 10)}.csv`, exportRowsFor(collected));
      }
    } catch (error) {
      console.error('[logArchive] export-all failed', error);
      showTransientNote('Export failed. Check that the server is reachable.');
    } finally {
      state.exporting = false;
      renderGlobalBody();
    }
  }

  function showTransientNote(message) {
    const note = document.createElement('div');
    note.className = 'cr-log-toast';
    note.textContent = message;
    root.querySelector('.cr-log-shell').appendChild(note);
    window.setTimeout(() => note.remove(), 5000);
  }

  // ---------------------------------------------------------------
  // Shared chrome: loading / error states, styles, DOM shell
  // ---------------------------------------------------------------

  function loadingHtml(message) {
    return `
      <div class="cr-log-state" role="status" aria-live="polite">
        <div class="cr-log-spinner" aria-hidden="true"></div>
        <p>${escapeHtml(message)}</p>
      </div>`;
  }

  function errorHtml(message, options) {
    const { retry = true, signIn = false } = options || {};
    return `
      <div class="cr-log-state" role="alert">
        <span class="material-symbols-outlined cr-log-error-icon" aria-hidden="true">error</span>
        <p>${escapeHtml(message)}</p>
        <div class="cr-log-actions">
          ${retry ? '<button type="button" class="cr-log-btn cr-log-btn-primary" data-cr-log="retry">Retry</button>' : ''}
          ${signIn ? `<a class="cr-log-btn cr-log-btn-primary" href="${escapeHtml(BASE)}index.html">Sign in</a>` : ''}
          <button type="button" class="cr-log-btn" data-cr-log="close">Close</button>
        </div>
      </div>`;
  }

  function setTitle(main, sub) {
    if (!titleEl) return;
    titleEl.innerHTML = sub
      ? `<span>${escapeHtml(main)}</span><span class="cr-log-title-sub">${escapeHtml(sub)}</span>`
      : `<span>${escapeHtml(main)}</span>`;
  }

  const CSS = `
    .cr-log-root { display: none; position: fixed; inset: 0; z-index: 85; overflow-y: auto;
      overscroll-behavior: contain; background: rgba(0,0,0,.45); padding: 24px 12px;
      font-family: Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #1a1c1e; }
    .cr-log-root.is-open { display: block; }
    .cr-log-root *, .cr-log-root *::before, .cr-log-root *::after { box-sizing: border-box; }
    .cr-log-shell { position: relative; max-width: 880px; margin: 0 auto; background: #fff; border-radius: 12px;
      box-shadow: 0 20px 50px rgba(0,0,0,.3); overflow: hidden; }
    .cr-log-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
      padding: 10px 16px; background: #f3f4f6; border-bottom: 1px solid #e1e2e4; }
    .cr-log-toolbar-title { display: flex; flex-direction: column; gap: 1px; font-size: 15px; font-weight: 700; margin: 0; }
    .cr-log-toolbar-title-row { display: flex; align-items: center; gap: 8px; }
    .cr-log-title-sub { font-size: 12px; font-weight: 500; color: #6b7280; }
    .cr-log-close { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px;
      border: 0; border-radius: 6px; background: transparent; cursor: pointer; color: #374151; flex-shrink: 0; }
    .cr-log-close:hover { background: #e5e7eb; }
    .cr-log-close:focus-visible { outline: 2px solid #7A1F2B; outline-offset: 2px; }

    .cr-log-body { padding: 20px; font-size: 14px; line-height: 1.45; max-height: 74vh; overflow-y: auto; }

    .cr-log-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 12px;
      font: 600 13px/1 Inter, system-ui, sans-serif; color: #1a1c1e; background: #e5e7eb; border: 0; border-radius: 6px;
      cursor: pointer; text-decoration: none; white-space: nowrap; }
    .cr-log-btn:hover { background: #d1d5db; }
    .cr-log-btn:focus-visible { outline: 2px solid #7A1F2B; outline-offset: 2px; }
    .cr-log-btn:disabled { opacity: .5; cursor: not-allowed; }
    .cr-log-btn-primary { background: #7A1F2B; color: #fff; }
    .cr-log-btn-primary:hover { background: #52131C; }
    .cr-log-btn .material-symbols-outlined { font-size: 16px; }

    /* Timeline (per-reservation) */
    .cr-log-timeline { list-style: none; margin: 0; padding: 0; }
    .cr-log-item { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px dashed #e5e7eb; }
    .cr-log-item:last-child { border-bottom: 0; }
    .cr-log-dot { flex-shrink: 0; width: 30px; height: 30px; border-radius: 50%; display: flex;
      align-items: center; justify-content: center; }
    .cr-log-dot .material-symbols-outlined { font-size: 18px; }
    .cr-log-item-body { flex: 1; min-width: 0; }
    .cr-log-item-top { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
    .cr-log-timestamp { font-weight: 700; font-size: 13px; }
    .cr-log-actor { font-size: 13px; color: #374151; }
    .cr-log-actor-role { color: #6b7280; font-weight: 500; }
    .cr-log-action { margin-top: 2px; font-size: 13px; color: #1a1c1e; overflow-wrap: anywhere; white-space: pre-wrap; }
    .cr-log-note { margin: 10px 2px 0; font-size: 12px; color: #6b7280; }

    /* Global filters */
    .cr-log-filters { display: flex; flex-wrap: wrap; align-items: end; gap: 10px 12px; margin-bottom: 14px;
      padding-bottom: 14px; border-bottom: 1px solid #e5e7eb; }
    .cr-log-field { display: flex; flex-direction: column; gap: 3px; font-size: 11px; font-weight: 700;
      letter-spacing: .04em; text-transform: uppercase; color: #6b7280; }
    .cr-log-field-grow { flex: 1 1 200px; }
    .cr-log-field input, .cr-log-field select { font: 500 13px/1.2 Inter, system-ui, sans-serif; color: #1a1c1e;
      padding: 7px 8px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; min-width: 0; }
    .cr-log-field input:focus, .cr-log-field select:focus { outline: 2px solid #7A1F2B; outline-offset: 1px; }

    /* Global table */
    .cr-log-export-bar { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
    .cr-log-table-wrap { overflow-x: auto; border: 1px solid #e5e7eb; border-radius: 8px; }
    .cr-log-table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 640px; }
    .cr-log-table th { text-align: left; font-size: 11px; letter-spacing: .04em; text-transform: uppercase;
      color: #6b7280; font-weight: 700; padding: 8px 10px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; }
    .cr-log-table td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
    .cr-log-table tr:last-child td { border-bottom: 0; }
    .cr-log-td-nowrap { white-space: nowrap; }
    .cr-log-badge { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px;
      border-radius: 50%; margin-right: 6px; vertical-align: middle; }
    .cr-log-badge .material-symbols-outlined { font-size: 13px; }

    .cr-log-pager { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; }
    .cr-log-pager-count { font-size: 12px; color: #6b7280; }
    .cr-log-pager-btns { display: flex; gap: 8px; }

    .cr-log-state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 48px 16px; text-align: center; color: #374151; }
    .cr-log-state-compact { padding: 28px 16px; }
    .cr-log-state p { margin: 0; }
    .cr-log-actions { display: flex; gap: 8px; }
    .cr-log-error-icon { font-size: 40px; color: #DC2626; }
    .cr-log-empty-icon { font-size: 36px; color: #9ca3af; }
    .cr-log-spinner { width: 32px; height: 32px; border: 3px solid #e5e7eb; border-top-color: #7A1F2B;
      border-radius: 50%; animation: cr-log-spin .8s linear infinite; }
    @keyframes cr-log-spin { to { transform: rotate(360deg); } }

    .cr-log-toast { position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 1;
      background: #1a1c1e; color: #fff; font: 600 13px/1.3 Inter, system-ui, sans-serif; padding: 10px 16px;
      border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.25); max-width: 90%; text-align: center; }

    @media (max-width: 640px) {
      .cr-log-body { padding: 14px; }
      .cr-log-field { flex: 1 1 45%; }
      .cr-log-item-top { flex-direction: column; gap: 2px; }
    }
  `;

  function ensureDom() {
    if (root) return;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    root = document.createElement('div');
    root.id = ROOT_ID;
    root.className = 'cr-log-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'crLogToolbarTitle');
    root.innerHTML = `
      <div class="cr-log-shell">
        <div class="cr-log-toolbar">
          <h2 class="cr-log-toolbar-title" id="crLogToolbarTitle">
            <span class="cr-log-toolbar-title-row">
              <span class="material-symbols-outlined" aria-hidden="true">folder_open</span>
              <span id="crLogTitleText">Log Archive</span>
            </span>
          </h2>
          <button type="button" class="cr-log-close" data-cr-log="close" aria-label="Close log archive">
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>
        <div class="cr-log-body" id="crLogBody" aria-live="polite"></div>
      </div>`;
    document.body.appendChild(root);

    bodyEl = root.querySelector('#crLogBody');
    titleEl = root.querySelector('#crLogTitleText');

    root.addEventListener('click', (event) => {
      const control = event.target.closest('[data-cr-log]');
      if (!control || control.disabled) return;
      switch (control.dataset.crLog) {
        case 'close': close(); break;
        case 'retry':
          if (state.mode === 'reservation' && state.reservationId) loadReservation(state.reservationId);
          else if (state.mode === 'global') loadGlobal({});
          break;
        default: break;
      }
    });

    let pressStartedOnBackdrop = false;
    root.addEventListener('mousedown', (event) => { pressStartedOnBackdrop = event.target === root; });
    root.addEventListener('click', (event) => {
      if (event.target === root && pressStartedOnBackdrop) close();
    });
  }

  // ---------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------

  function isOpen() {
    return !!root && root.classList.contains('is-open');
  }

  function openShell() {
    ensureDom();
    if (!isOpen()) {
      state.returnFocusTo = document.activeElement;
      root.classList.add('is-open');
      document.body.classList.add(OPEN_CLASS);
      root.scrollTop = 0;
      root.querySelector('[data-cr-log="close"]').focus();
    }
  }

  function open(reservationId) {
    const id = String(reservationId ?? '').trim();
    if (!id) return;
    state.mode = 'reservation';
    openShell();
    loadReservation(id);
  }

  function openGlobal() {
    state.mode = 'global';
    setTitle('Audit Log Archive', null);
    openShell();
    loadGlobal({ resetPage: true });
  }

  function close() {
    if (!isOpen()) return;
    state.ticket++; // discard any in-flight response
    root.classList.remove('is-open');
    document.body.classList.remove(OPEN_CLASS);
    bodyEl.innerHTML = '';
    if (state.returnFocusTo && typeof state.returnFocusTo.focus === 'function') {
      state.returnFocusTo.focus();
    }
    state.returnFocusTo = null;
    state.mode = null;
  }

  const FOCUSABLE_SELECTOR = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled])';

  document.addEventListener('keydown', (event) => {
    if (!isOpen()) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }

    if (event.key === 'Tab') {
      const focusable = Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!root.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  window.CampusRoomLogArchive = Object.freeze({ open, openGlobal, close });
})();
