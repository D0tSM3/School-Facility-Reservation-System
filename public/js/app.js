/**
 * CampusRoom — Shared Application Shell & Navigation
 * Handles session info, active links, header profiles, and logout with subfolder relative paths.
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const BASE = window.location.pathname.replace(/[^\/]*$/, '');

  // 1. Fetch real session info
  fetch(BASE + 'api/auth/me', { credentials: 'include' })
    .then(res => res.json())
    .then(json => {
      const currentUser = json.success ? json.data : null;
      if (!currentUser) {
        // Fix Guide 5.3: app.js isn't loaded by index.html/verify.html, so
        // landing here with no session means the student needs to log in
        // rather than sit on a form that will fail on submit.
        window.location.href = 'index.html';
        return;
      }

      // Fix Guide 5.4: let page scripts (e.g. booking.js) react to the
      // logged-in user's role without each one re-fetching /api/auth/me.
      window.currentUser = currentUser;
      document.dispatchEvent(new CustomEvent('campusroom:user', { detail: currentUser }));

      const role = String(currentUser.role || '').toLowerCase();
      
      const staffLink = document.querySelector('aside nav a[data-path="staff-queue"]');
      const adminLink = document.querySelector('aside nav a[data-path="admin-governance"]');
      const myReservationsLink = document.querySelector('aside nav a[data-path="my-reservations"]');

      if (staffLink) {
        const canViewStaffQueue = role === 'staff' || role === 'admin';
        staffLink.hidden = !canViewStaffQueue;
        staffLink.style.setProperty('display', canViewStaffQueue ? 'flex' : 'none', 'important');
      }
      if (adminLink) {
        const canViewAdminGovernance = role === 'admin';
        adminLink.hidden = !canViewAdminGovernance;
        adminLink.style.setProperty('display', canViewAdminGovernance ? 'flex' : 'none', 'important');
      }
      if (myReservationsLink) {
        const canViewMyReservations = role === 'customer';
        myReservationsLink.hidden = !canViewMyReservations;
        myReservationsLink.style.setProperty('display', canViewMyReservations ? 'flex' : 'none', 'important');
      }

      // 2. Update Profile Header if present
      const headerUserName = document.querySelector('header .font-label-md.text-on-surface');
      const headerUserRole = document.querySelector('header .font-label-sm.text-primary');

      if (headerUserName) {
        headerUserName.textContent = currentUser.name;
        if (headerUserRole) {
          headerUserRole.textContent = currentUser.role === 'Staff' || currentUser.role === 'Admin'
            ? `${currentUser.role} / Registrar`
            : 'Student';
        }
        
        // Update initials
        const headerInitials = document.querySelector('.header-initials');
        if (headerInitials) {
          const parts = currentUser.name.split(' ').filter(p => p.toLowerCase() !== 'dr.');
          const initial1 = parts[0] ? parts[0][0] : '';
          const initial2 = parts.length > 1 ? parts[parts.length - 1][0] : '';
          headerInitials.textContent = (initial1 + initial2).toUpperCase();
        }
      }
    })
    .catch(err => console.error('Failed to fetch user session', err));

  // 3. Highlight Active Navigation Link & Ensure Correct Relative URLs
  const currentPath = window.location.pathname.toLowerCase();
  const navLinks = document.querySelectorAll('aside nav a');

  // Fix Guide 5.2: the Rooms link points to rooms.html, but the booking page
  // is book-room.html, so a plain currentPath.includes(href) check never
  // highlights "Rooms" while a student is actually booking a room.
  const ACTIVE_ALIASES = { rooms: ['rooms.html', 'book-room.html'] };

  navLinks.forEach(link => {
    const dataPath = link.getAttribute('data-path') || '';

    // Fix relative links if not already set
    if (dataPath === 'customer-dashboard') {
      link.setAttribute('href', 'dashboard.html');
    } else if (dataPath === 'rooms') {
      link.setAttribute('href', 'rooms.html');
    }

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

  // 4. Logout Footer
  const aside = document.querySelector('aside');
  if (aside && !document.getElementById('logout-banner')) {
    const logoutDiv = document.createElement('div');
    logoutDiv.id = 'logout-banner';
    logoutDiv.className = 'p-4 border-t border-white/5 mt-auto';
    
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'flex items-center gap-2.5 text-sm text-gray-400 hover:text-white transition-colors w-full px-2 py-1.5 rounded-lg';
    logoutBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">logout</span><span>Sign Out</span>';
    logoutBtn.title = 'Sign Out';
    logoutBtn.addEventListener('click', () => {
      fetch(BASE + 'api/auth/logout', { method: 'POST', credentials: 'include' })
        .then(() => { window.location.href = 'index.html'; })
        .catch(err => {
          console.error(err);
          window.location.href = 'index.html';
        });
    });

    logoutDiv.appendChild(logoutBtn);
    aside.appendChild(logoutDiv);
  }
});
