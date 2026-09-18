document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const summaryUpcoming = document.getElementById('summaryUpcoming');
  const summaryPast = document.getElementById('summaryPast');
  const summaryPending = document.getElementById('summaryPending');
  const pendingRequests = document.getElementById('dashboardPendingRequests');
  const maintenanceRooms = document.getElementById('dashboardMaintenanceRooms');
  const todayBookings = document.getElementById('dashboardTodayBookings');
  const peakUtilization = document.getElementById('dashboardPeakUtilization');
  const nextRoom = document.getElementById('dashboardNextRoom');
  const nextStatus = document.getElementById('dashboardNextStatus');
  const nextTime = document.getElementById('dashboardNextTime');
  const nextPurpose = document.getElementById('dashboardNextPurpose');
  const nextId = document.getElementById('dashboardNextId');

  const BASE = window.location.pathname.replace(/[^\/]*$/, '');

  function parseLocalDateTime(value) {
    if (!value) return new Date(NaN);
    return new Date(String(value).replace(' ', 'T'));
  }

  function formatReservationTime(value) {
    const date = parseLocalDateTime(value);
    return Number.isNaN(date.getTime())
      ? 'Time unavailable'
      : date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  }

  Promise.all([
    fetch(BASE + 'api/reservations/mine', { credentials: 'include' }).then(res => res.json()),
    fetch(BASE + 'api/rooms', { credentials: 'include' }).then(res => res.json())
  ])
    .then(([reservationResponse, roomResponse]) => {
      const reservations = reservationResponse.success && Array.isArray(reservationResponse.data)
        ? reservationResponse.data
        : [];
      const rooms = roomResponse.success && Array.isArray(roomResponse.data)
        ? roomResponse.data
        : [];
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const activeReservations = reservations.filter(r => !['Rejected', 'Cancelled'].includes(r.status));
      const upcomingReservations = activeReservations
        .filter(r => parseLocalDateTime(r.end_time) > now)
        .sort((a, b) => parseLocalDateTime(a.start_time) - parseLocalDateTime(b.start_time));
      const nextReservation = upcomingReservations[0];
      const upcomingCount = upcomingReservations.length;
      const pastCount = activeReservations.filter(r => parseLocalDateTime(r.end_time) <= now).length;
      const pendingCount = reservations.filter(r => r.status === 'Pending').length;
      const todayCount = activeReservations.filter(r => String(r.start_time).slice(0, 10) === today).length;

      if (summaryUpcoming) summaryUpcoming.textContent = upcomingCount;
      if (summaryPast) summaryPast.textContent = pastCount;
      if (summaryPending) summaryPending.textContent = pendingCount;
      if (pendingRequests) pendingRequests.textContent = pendingCount;
      if (maintenanceRooms) maintenanceRooms.textContent = rooms.filter(r => r.status === 'Maintenance').length;
      if (todayBookings) todayBookings.textContent = todayCount;
      if (peakUtilization) {
        const occupiedCount = rooms.filter(r => r.live_status === 'Occupied').length;
        peakUtilization.textContent = rooms.length ? `${Math.round((occupiedCount / rooms.length) * 100)}%` : '--';
      }

      if (nextReservation) {
        if (nextRoom) nextRoom.textContent = nextReservation.room_name || nextReservation.room_id;
        if (nextStatus) nextStatus.textContent = nextReservation.status;
        if (nextTime) nextTime.textContent = formatReservationTime(nextReservation.start_time);
        if (nextPurpose) nextPurpose.textContent = nextReservation.purpose;
        if (nextId) nextId.textContent = `ID: #${String(nextReservation.reservation_id).substring(0, 8)}`;
      }
    })
    .catch(err => console.error('Error loading dashboard data:', err));
});
