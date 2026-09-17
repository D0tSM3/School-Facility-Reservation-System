/**
 * CampusRoom — Shared Application Shell & Navigation
 * Handles session info, active links, header profiles, and logout with subfolder relative paths.
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const DB = window.CampusRoomDB;
  if (!DB) return;

  const currentUser = DB.getCurrentUser();
  const role = currentUser ? String(currentUser.role || '').toLowerCase() : '';
  const staffLink = document.querySelector('aside nav a[data-path="staff-queue"]');
  const adminLink = document.querySelector('aside nav a[data-path="admin-governance"]');

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

  // 1. Update Profile Header if present
  const headerUserName = document.querySelector('header .font-label-md.text-on-surface');
  const headerUserRole = document.querySelector('header .font-label-sm.text-primary');

  if (currentUser && headerUserName) {
    headerUserName.textContent = currentUser.name;
    if (headerUserRole) {
      headerUserRole.textContent = currentUser.role === 'Staff' || currentUser.role === 'Admin'
        ? `${currentUser.role} / Registrar`
        : 'Faculty / Academic';
    }
  }

  // 2. Highlight Active Navigation Link & Ensure Correct Relative URLs
  const currentPath = window.location.pathname.toLowerCase();
  const navLinks = document.querySelectorAll('aside nav a');

  navLinks.forEach(link => {
    const dataPath = link.getAttribute('data-path') || '';

    // Fix relative links if not already set
    if (dataPath === 'customer-dashboard') {
      link.setAttribute('href', 'dashboard.html');
    } else if (dataPath === 'rooms') {
      link.setAttribute('href', 'book-room.html');
    } else if (dataPath === 'my-reservations') {
      link.setAttribute('href', 'my-reservations.html');
    } else if (dataPath === 'staff-queue') {
      link.setAttribute('href', 'staff-queue.html');
    } else if (dataPath === 'admin-governance') {
      link.setAttribute('href', 'admin-governance.html');
    }

    let isActive = false;
    if (currentPath.includes('dashboard.html') && dataPath === 'customer-dashboard') {
      isActive = true;
    } else if (currentPath.includes('book-room.html') && dataPath === 'rooms') {
      isActive = true;
    } else if (currentPath.includes('my-reservations.html') && dataPath === 'my-reservations') {
      isActive = true;
    } else if (currentPath.includes('staff-queue.html') && dataPath === 'staff-queue') {
      isActive = true;
    } else if (currentPath.includes('admin-governance.html') && dataPath === 'admin-governance') {
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

  // 3. User Role Switcher in Sidebar Footer
  const aside = document.querySelector('aside');
  if (aside && !document.getElementById('role-switcher-banner')) {
    const switcherDiv = document.createElement('div');
    switcherDiv.id = 'role-switcher-banner';
    switcherDiv.className = 'p-space-sm bg-tertiary border-t border-white/10 text-xs flex flex-col gap-1.5';
    
    const roleTitle = document.createElement('div');
    roleTitle.className = 'flex items-center justify-between text-tertiary-fixed-dim font-label-sm';
    roleTitle.innerHTML = `<span>Session: <strong>${currentUser ? currentUser.role : 'Guest'}</strong></span>`;

    const btnContainer = document.createElement('div');
    btnContainer.className = 'flex gap-1';

    const custBtn = document.createElement('button');
    custBtn.className = 'flex-1 py-1 px-1.5 rounded text-[11px] bg-white/10 hover:bg-white/20 text-white transition-colors';
    custBtn.textContent = 'Customer';
    custBtn.title = 'Switch to Dr. Edgardo Valderama';
    custBtn.addEventListener('click', () => {
      const users = DB.getUsers();
      const cust = users.find(u => u.role === 'Customer') || users[0];
      DB.setCurrentUser(cust);
      window.location.reload();
    });

    const staffBtn = document.createElement('button');
    staffBtn.className = 'flex-1 py-1 px-1.5 rounded text-[11px] bg-white/10 hover:bg-white/20 text-white transition-colors';
    staffBtn.textContent = 'Staff Desk';
    staffBtn.title = 'Switch to Facilities Staff Desk';
    staffBtn.addEventListener('click', () => {
      const users = DB.getUsers();
      const staff = users.find(u => u.role === 'Staff') || users[1];
      DB.setCurrentUser(staff);
      window.location.href = 'staff-queue.html';
    });

    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'py-1 px-2 rounded text-[11px] bg-red-900/60 hover:bg-red-800 text-white transition-colors flex items-center justify-center';
    logoutBtn.innerHTML = '<span class="material-symbols-outlined text-[14px]">logout</span>';
    logoutBtn.title = 'Sign Out';
    logoutBtn.addEventListener('click', () => {
      DB.logout();
      window.location.href = 'index.html';
    });

    btnContainer.appendChild(custBtn);
    btnContainer.appendChild(staffBtn);
    btnContainer.appendChild(logoutBtn);

    switcherDiv.appendChild(roleTitle);
    switcherDiv.appendChild(btnContainer);
    aside.appendChild(switcherDiv);
  }
});
