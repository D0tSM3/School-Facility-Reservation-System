/**
 * CampusRoom — Shared Application Shell & Navigation
 * Handles session info, active links, header profiles, and logout with subfolder relative paths.
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const BASE = window.location.pathname.replace(/[^\/]*$/, '');
  const pageName = window.location.pathname.split('/').pop().toLowerCase() || 'dashboard.html';
  const accessRules = {
    'dashboard.html': ['customer'],
    'rooms.html': ['customer', 'staff', 'admin'],
    'book-room.html': ['customer'],
    'my-reservations.html': ['customer', 'staff', 'admin'],
    'staff-queue.html': ['staff', 'admin'],
    'admin-governance.html': ['admin']
  };
  const landingPages = {
    customer: 'dashboard.html',
    staff: 'staff-queue.html',
    admin: 'admin-governance.html'
  };

  function redirectForRole(role) {
    const normalizedRole = String(role || '').toLowerCase();
    const allowedRoles = accessRules[pageName];

    if (!allowedRoles || allowedRoles.includes(normalizedRole)) return true;

    window.location.replace(landingPages[normalizedRole] || 'index.html');
    return false;
  }

  // 1. Fetch real session info
  fetch(BASE + 'api/auth/me', { credentials: 'include' })
    .then(res => res.json())
    .then(json => {
      const currentUser = json.success ? json.data : null;
      if (!currentUser) {
        window.location.replace('index.html');
        return;
      }

      const role = String(currentUser.role || '').toLowerCase();
      if (!redirectForRole(role)) return;
      
      const staffLink = document.querySelector('aside nav a[data-path="staff-queue"]');
      const adminLink = document.querySelector('aside nav a[data-path="admin-governance"]');
      const dashboardLink = document.querySelector('aside nav a[data-path="customer-dashboard"]');
      const roomsLink = document.querySelector('aside nav a[data-path="rooms"]');

      if (roomsLink) {
        const canViewRooms = role === 'customer';
        roomsLink.hidden = !canViewRooms;
        roomsLink.style.setProperty('display', canViewRooms ? 'flex' : 'none', 'important');
      }

      if (dashboardLink) {
        const canViewCustomerDashboard = role === 'customer';
        dashboardLink.hidden = !canViewCustomerDashboard;
        dashboardLink.style.setProperty('display', canViewCustomerDashboard ? 'flex' : 'none', 'important');
      }

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

      const roleLinks = {
        'customer-dashboard': 'dashboard.html',
        rooms: 'rooms.html',
        'my-reservations': 'my-reservations.html',
        'staff-queue': 'staff-queue.html',
        'admin-governance': 'admin-governance.html'
      };
      document.querySelectorAll('aside nav a[data-path]').forEach(link => {
        const destination = roleLinks[link.dataset.path];
        if (destination) link.href = destination;
      });

      // 2. Update Profile Header if present
      const headerUserName = document.querySelector('header .font-label-md.text-on-surface');
      const headerUserRole = document.querySelector('header .font-label-sm.text-primary');

      if (headerUserName) {
        headerUserName.textContent = currentUser.name;
        if (headerUserRole) {
          headerUserRole.textContent = currentUser.role === 'Staff' || currentUser.role === 'Admin'
            ? `${currentUser.role} / Registrar`
            : 'Faculty / Academic';
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

  // 3. Highlight Active Navigation Link
  const currentPath = window.location.pathname.toLowerCase();
  const navLinks = document.querySelectorAll('aside nav a');

  navLinks.forEach(link => {
    const dataPath = link.getAttribute('data-path') || '';

    const href = link.getAttribute('href');
    if (!href || href === '#') return;

    let isActive = false;
    const isDashboard = currentPath.endsWith('/') || currentPath.endsWith('/dashboard.html');

    if (dataPath === 'customer-dashboard' && isDashboard) {
      isActive = true;
    } else if (dataPath !== 'customer-dashboard' && href !== 'dashboard.html' && currentPath.includes(href.toLowerCase())) {
      isActive = true;
    }

    if (isActive) {
      link.setAttribute('aria-current', 'page');
      link.className = 'flex items-center gap-space-sm px-space-md py-space-sm rounded transition-colors bg-primary-container text-on-primary border-l-4 border-secondary-container font-label-lg';
    } else {
      link.removeAttribute('aria-current');
      link.className = 'flex items-center gap-space-sm px-space-md py-space-sm text-tertiary-fixed font-label-lg text-label-lg rounded hover:bg-tertiary-container hover:text-on-tertiary transition-colors';
    }
  });

  // 4. Logout Footer
  const aside = document.querySelector('aside');
  if (aside && !document.getElementById('logout-banner')) {
    const logoutDiv = document.createElement('div');
    logoutDiv.id = 'logout-banner';
    logoutDiv.className = 'p-space-sm bg-tertiary border-t border-white/10 text-xs flex justify-end';
    
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'py-1 px-2 rounded text-[11px] bg-red-900/60 hover:bg-red-800 text-white transition-colors flex items-center justify-center gap-1';
    logoutBtn.innerHTML = '<span class="material-symbols-outlined text-[14px]">logout</span><span>Sign Out</span>';
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
