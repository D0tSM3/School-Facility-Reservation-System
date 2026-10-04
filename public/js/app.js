/**
 * CampusRoom — Shared Application Shell & Navigation
 * Handles session info, active links, header profiles, and logout with subfolder relative paths.
 */

// -----------------------------------------------------------------------
// 0. Guard against the back-forward cache (bfcache).
//    After Sign Out redirects to index.html, hitting the browser's Back
//    button can restore this page straight from bfcache without re-running
//    any of the checks below — showing a "logged in" page even though the
//    session was destroyed server-side. Forcing a reload on restore makes
//    the DOMContentLoaded session check below run for real again.
// -----------------------------------------------------------------------
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    window.location.reload();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const BASE = window.location.pathname.replace(/[^\/]*$/, '');

  // -----------------------------------------------------------------------
  // 1. Fetch real session info
  // -----------------------------------------------------------------------
  const shell = window.CampusRoomShell;
  if (!shell) {
    console.error('The shared shell guard failed to load.');
    window.location.replace('index.html');
    return;
  }

  shell.session
    .then(json => {
      const currentUser = json.success ? json.data : null;
      if (!currentUser) {
        localStorage.removeItem('campus_role');
        shell.clearUser();
        // No active session — send to login page.
        window.location.href = 'index.html';
        return;
      }

      // Expose user globally so other scripts can read it without re-fetching.
      window.currentUser = currentUser;
      document.dispatchEvent(new CustomEvent('campusroom:user', { detail: currentUser }));

      shell.saveUser(currentUser);
      if (!shell.applyUser(currentUser)) return;

      // -----------------------------------------------------------------------
      // 3. Update profile header
      //    Supports both old class-based selectors and new header-* classes.
      // -----------------------------------------------------------------------
      const roleLabel = (currentUser.role === 'Staff' || currentUser.role === 'Admin')
        ? `${currentUser.role} / Registrar`
        : 'Student';

      const parts   = currentUser.name.split(' ').filter(p => p.toLowerCase() !== 'dr.');
      const i1      = parts[0] ? parts[0][0] : '';
      const i2      = parts.length > 1 ? parts[parts.length - 1][0] : '';
      const initials = (i1 + i2).toUpperCase();

      // New-style (header-name / header-role / header-initials classes)
      document.querySelectorAll('.header-name').forEach(el => { el.textContent = currentUser.name; });
      document.querySelectorAll('.header-role').forEach(el => { el.textContent = roleLabel; });
      document.querySelectorAll('.header-initials').forEach(el => { el.textContent = initials; });

      // Legacy-style (specific typography class selectors)
      const legacyName = document.querySelector('header .font-label-md.text-on-surface');
      const legacyRole = document.querySelector('header .font-label-sm.text-primary');
      if (legacyName) legacyName.textContent = currentUser.name;
      if (legacyRole) legacyRole.textContent = roleLabel;
    })
    .catch(err => console.error('Failed to fetch user session', err));

  // -----------------------------------------------------------------------
  // 4. Highlight active navigation link & ensure correct relative URLs
  // -----------------------------------------------------------------------
  const currentPath = window.location.pathname.toLowerCase();
  const navLinks    = document.querySelectorAll('aside nav a');

  // The Rooms link covers both the directory and the booking page.
  const ACTIVE_ALIASES = { rooms: ['rooms.html', 'book-room.html'] };

  navLinks.forEach(link => {
    const dataPath = link.getAttribute('data-path') || '';

    // Normalise relative hrefs
    if (dataPath === 'customer-dashboard') link.setAttribute('href', 'dashboard.html');
    else if (dataPath === 'rooms')         link.setAttribute('href', 'rooms.html');

    const href = link.getAttribute('href');
    if (!href || href === '#') return;

    let isActive = false;
    const isDashboard = currentPath.endsWith('/') || currentPath.endsWith('/dashboard.html');

    if (dataPath === 'customer-dashboard' && isDashboard) {
      isActive = true;
    } else if (dataPath !== 'customer-dashboard' && href !== 'dashboard.html') {
      const targets = ACTIVE_ALIASES[dataPath] || [href.toLowerCase()];
      isActive = targets.some(t => currentPath.includes(t));
    }

    if (isActive) {
      link.setAttribute('aria-current', 'page');
      link.className = 'flex items-center gap-3 px-4 py-2.5 rounded-xl transition-colors bg-[#7a1f2b] text-white font-medium text-sm';
    } else {
      link.removeAttribute('aria-current');
      link.className = 'flex items-center gap-3 px-4 py-2.5 text-gray-400 font-medium text-sm rounded-xl hover:bg-white/5 hover:text-white transition-colors';
    }
  });

  // -----------------------------------------------------------------------
  // 5. Sign Out — wire the handler to any #logoutBtn already in the HTML,
  //    or inject the button+banner into the sidebar if neither is present.
  // -----------------------------------------------------------------------
  function attachLogout(btn) {
    btn.addEventListener('click', () => {
      window.CampusRoomShell.clearUser();
      fetch(BASE + 'api/auth/logout', { method: 'POST', credentials: 'include' })
        .then(() => { localStorage.removeItem('campus_role'); window.location.href = 'index.html'; })
        .catch(err => {
          console.error(err);
          localStorage.removeItem('campus_role');
          window.location.href = 'index.html';
        });
    });
  }

  const existingLogoutBtn = document.getElementById('logoutBtn');
  if (existingLogoutBtn) {
    // Button is already in the HTML (dashboard, rooms, my-reservations, handbook)
    attachLogout(existingLogoutBtn);
  } else {
    // Older pages without the button — inject the full banner into the sidebar
    const aside = document.querySelector('aside');
    if (aside && !document.getElementById('logout-banner')) {
      const logoutDiv = document.createElement('div');
      logoutDiv.id = 'logout-banner';
      logoutDiv.className = 'mt-auto p-4 border-t border-white/5';

      const logoutBtn = document.createElement('button');
      logoutBtn.id = 'logoutBtn';
      logoutBtn.type = 'button';
      logoutBtn.className = 'flex items-center gap-2.5 text-sm text-gray-400 hover:text-white transition-colors w-full px-2 py-1.5 rounded-lg';
      logoutBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">logout</span><span class="font-medium">Sign Out</span>';
      logoutBtn.title = 'Sign Out';
      attachLogout(logoutBtn);

      logoutDiv.appendChild(logoutBtn);
      aside.appendChild(logoutDiv);
    }
  }
});
