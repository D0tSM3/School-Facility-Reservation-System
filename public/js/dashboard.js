document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const summaryUpcoming = document.getElementById('summaryUpcoming');
  const summaryPast = document.getElementById('summaryPast');
  const summaryPending = document.getElementById('summaryPending');

  const BASE = window.location.pathname.replace(/[^\/]*$/, '');

  if (summaryUpcoming && summaryPast && summaryPending) {
    fetch(BASE + 'api/reservations/mine')
      .then(res => res.json())
      .then(json => {
        if (json.success && json.data) {
          const reservations = json.data;
          const now = new Date();
          
          let upcomingCount = 0;
          let pastCount = 0;
          let pendingCount = 0;

          reservations.forEach(r => {
            if (r.status === 'Pending') pendingCount++;
            
            const endTime = new Date(r.end_time);
            if (endTime > now && r.status !== 'Rejected' && r.status !== 'Cancelled') {
              upcomingCount++;
            } else if (endTime <= now && r.status !== 'Rejected' && r.status !== 'Cancelled') {
              pastCount++;
            }
          });

          summaryUpcoming.textContent = upcomingCount;
          summaryPast.textContent = pastCount;
          summaryPending.textContent = pendingCount;
        }
      })
      .catch(err => console.error('Error fetching reservations:', err));
  }
});
