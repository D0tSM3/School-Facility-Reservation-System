/**
 * CampusRoom — Shared Shell (loaded synchronously in <head>)
 *
 * Goal: the FIRST paint of every authenticated page is already the correct
 * page, so navigating between pages looks seamless with no waiting and no
 * hiding.
 *
 * How:
 *  - Tailwind is a prebuilt stylesheet (css/tailwind.css), not the runtime
 *    CDN, so styles exist from the first paint.
 *  - The sidebar role links, header profile and active nav item are painted
 *    synchronously (before the browser can paint) from a cosmetic hint of
 *    the last verified session kept in sessionStorage. Role links are
 *    driven by CSS off <html data-role>, which is set here in <head>.
 *  - /api/auth/me is fired immediately and verified in the background by
 *    js/app.js. The SERVER is the only authority: the hint is never used
 *    for authorization, and any mismatch is corrected as soon as the
 *    server answers (a 401 clears the hint and goes to the login page).
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var KEY = 'campusroom:shellUser';
  var BASE = window.location.pathname.replace(/[^\/]*$/, '');

  // ---- cosmetic session hint (name + role only) ---------------------------
  function readUser() {
    try {
      var u = JSON.parse(sessionStorage.getItem(KEY));
      return u && typeof u.role === 'string' ? u : null;
    } catch (e) { return null; }
  }
  function saveUser(u) {
    try { sessionStorage.setItem(KEY, JSON.stringify({ name: u.name, role: u.role })); } catch (e) { /* ignore */ }
  }
  function clearUser() {
    try { sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  function setRole(role) {
    role = String(role || '').toLowerCase();
    if (role) root.setAttribute('data-role', role); else root.removeAttribute('data-role');
  }

  // Customer-only page: Staff/Admin never see it, not even for a frame.
  function bounceIfStaff(role) {
    role = String(role || '').toLowerCase();
    if ((role === 'staff' || role === 'admin') &&
        /\/my-reservations\.html$/i.test(window.location.pathname)) {
      window.location.replace(BASE + 'staff-dashboard.html');
      return true;
    }
    return false;
  }

  var hint = readUser();
  if (hint) {
    setRole(hint.role);
    bounceIfStaff(hint.role);
  }

  // ---- CSS that must exist before first paint -----------------------------
  var style = document.createElement('style');
  style.textContent =
    'html{background:#f8f9fb}' +
    // Role-gated sidebar links, driven by <html data-role> (set above).
    'html[data-role="staff"] aside nav a[data-path="staff-queue"],' +
    'html[data-role="admin"] aside nav a[data-path="staff-queue"],' +
    'html[data-role="admin"] aside nav a[data-path="admin-governance"],' +
    'html[data-role="customer"] aside nav a[data-path="my-reservations"]{display:flex}' +
    // Empty role pill shouldn't show as a blank badge (keeps its space: no shift).
    'header .font-label-sm.text-primary:empty{visibility:hidden}' +
    // Until the icon font is in, clip ligature text ("meeting_room"...) to
    // the icon box and hide it, so words never flash in place of icons.
    '.material-symbols-outlined{display:inline-block;width:1em;height:1em;overflow:hidden;white-space:nowrap}' +
    'html:not(.icons-ready) .material-symbols-outlined{color:transparent!important}';
  (document.head || root).appendChild(style);

  // ---- start the authoritative session check right now --------------------
  var session = fetch(BASE + 'api/auth/me', { credentials: 'include' })
    .then(function (res) { return res.json(); });
  session.catch(function () { /* handled in app.js; avoids unhandled-rejection noise */ });

  // ---- shell painting (idempotent) ----------------------------------------
  function highlightNav() {
    var currentPath = window.location.pathname.toLowerCase();
    var navLinks = document.querySelectorAll('aside nav a');

    // The Rooms link points to rooms.html, but the booking page is
    // book-room.html, so both count as "Rooms".
    var ACTIVE_ALIASES = { rooms: ['rooms.html', 'book-room.html'] };

    Array.prototype.forEach.call(navLinks, function (link) {
      var dataPath = link.getAttribute('data-path') || '';

      if (dataPath === 'customer-dashboard') {
        link.setAttribute('href', 'dashboard.html');
      } else if (dataPath === 'rooms') {
        link.setAttribute('href', 'rooms.html');
      }

      var href = link.getAttribute('href');
      if (!href || href === '#') return;

      var isActive = false;
      var isDashboard = currentPath.endsWith('/') || currentPath.endsWith('/dashboard.html');

      if (dataPath === 'customer-dashboard' && isDashboard) {
        isActive = true;
      } else if (dataPath !== 'customer-dashboard' && href !== 'dashboard.html') {
        var targets = ACTIVE_ALIASES[dataPath] || [href.toLowerCase()];
        isActive = targets.some(function (t) { return currentPath.indexOf(t) !== -1; });
      }

      if (isActive) {
        link.setAttribute('aria-current', 'page');
        link.className = 'flex items-center gap-space-sm px-space-md py-space-sm rounded transition-colors bg-primary-container text-on-primary border-l-4 border-secondary-container font-label-lg';
      } else {
        link.removeAttribute('aria-current');
        link.className = 'flex items-center gap-space-sm px-space-md py-space-sm text-tertiary-fixed font-label-lg text-label-lg rounded hover:bg-tertiary-container hover:text-on-tertiary transition-colors';
      }
    });
  }

  function setLink(selector, allowed) {
    var el = document.querySelector(selector);
    if (!el) return;
    el.hidden = !allowed;
    el.style.setProperty('display', allowed ? 'flex' : 'none', 'important');
  }

  /** Applies role-based sidebar visibility + header profile. Returns false if redirecting. */
  function applyUser(user) {
    var role = String(user.role || '').toLowerCase();
    setRole(role);
    if (bounceIfStaff(role)) return false;

    setLink('aside nav a[data-path="staff-queue"]', role === 'staff' || role === 'admin');
    setLink('aside nav a[data-path="admin-governance"]', role === 'admin');
    setLink('aside nav a[data-path="my-reservations"]', role === 'customer');

    var nameEl = document.querySelector('header .font-label-md.text-on-surface');
    var roleEl = document.querySelector('header .font-label-sm.text-primary');
    if (nameEl) {
      nameEl.textContent = user.name || '';
      if (roleEl) {
        roleEl.textContent = user.role === 'Staff' || user.role === 'Admin'
          ? user.role + ' / Registrar'
          : 'Student';
      }
      var initialsEl = document.querySelector('.header-initials');
      if (initialsEl) {
        var parts = String(user.name || '').split(' ').filter(function (p) { return p && p.toLowerCase() !== 'dr.'; });
        var i1 = parts[0] ? parts[0][0] : '';
        var i2 = parts.length > 1 ? parts[parts.length - 1][0] : '';
        initialsEl.textContent = (i1 + i2).toUpperCase();
      }
    }
    return true;
  }

  function ensureLogout() {
    var aside = document.querySelector('aside');
    if (!aside || document.getElementById('logout-banner')) return;

    var logoutDiv = document.createElement('div');
    logoutDiv.id = 'logout-banner';
    logoutDiv.className = 'p-space-sm bg-tertiary border-t border-white/10 text-xs flex justify-end';

    var logoutBtn = document.createElement('button');
    logoutBtn.className = 'py-1 px-2 rounded text-[11px] bg-red-900/60 hover:bg-red-800 text-white transition-colors flex items-center justify-center gap-1';
    logoutBtn.innerHTML = '<span class="material-symbols-outlined text-[14px]">logout</span><span>Sign Out</span>';
    logoutBtn.title = 'Sign Out';
    logoutBtn.addEventListener('click', function () {
      clearUser();
      var done = function () { window.location.href = 'index.html'; };
      fetch(BASE + 'api/auth/logout', { method: 'POST', credentials: 'include' })
        .then(done)
        .catch(function (err) { console.error(err); done(); });
    });

    logoutDiv.appendChild(logoutBtn);
    aside.appendChild(logoutDiv);
  }

  /** Called by an inline script right after </header>, before first paint. Idempotent. */
  function paint() {
    highlightNav();
    ensureLogout();
    if (hint) applyUser(hint);
  }

  // ---- icon font readiness -------------------------------------------------
  // (Must wait for DOMContentLoaded: stylesheets, and so the @font-face
  // rules, only exist by then.)
  document.addEventListener('DOMContentLoaded', function () {
    var done = false;
    function ready() { if (done) return; done = true; root.classList.add('icons-ready'); }
    setTimeout(ready, 1500);
    if (document.fonts && document.fonts.load) {
      document.fonts.load('400 20px "Material Symbols Outlined"').then(ready, ready);
    } else {
      ready();
    }
  });

  window.CampusRoomShell = {
    session: session,
    paint: paint,
    applyUser: applyUser,
    saveUser: saveUser,
    clearUser: clearUser
  };
})();
