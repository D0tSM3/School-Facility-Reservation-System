document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // Shared helper (js/util.js). Declared up here so nothing can call it before it exists.
  const { parseDate } = window.CampusRoomUtil;

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

            // parseDate() (js/util.js): strict-spec browsers like Safari
            // won't parse the space-separated "YYYY-MM-DD HH:MM:SS" form
            // `new Date(value)` gets here, so this used to silently drop
            // every reservation out of both the upcoming and past counts.
            const endTime = parseDate(r.end_time);
            if (!endTime) return; // unparseable: leave uncounted, same as before

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
