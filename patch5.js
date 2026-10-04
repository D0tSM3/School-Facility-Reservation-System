const fs = require('fs');
let file = fs.readFileSync('public/js/reservations.js', 'utf8');

// 1. Cancel request
file = file.replace(
  \        fetch(BASE + 'api/reservations/' + encodeURIComponent(targetId) + '/cancel-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason })
        })
        .then(res => res.json())
        .then(json => {
          if (json.success) {
            closeModal();
            showToast('Cancellation request submitted. Your booking stands until staff review it.', 'success');
            fetchReservations();
          } else {
            // 422s here are the real rules (day-of, duplicate request); show them
            // in the form rather than closing it out from under the customer.
            showCancelReqError(json.error || 'Could not submit the request.');
          }
        })
        .catch(err => {
          console.error(err);
          showCancelReqError('Network error. Please try again.');
        })
        .finally(() => { cancelReqSubmit.disabled = false; });\,
  \        const target = allReservations.find(r => r.reservation_id === currentTargetReservationId) || {};
        const ids = target.is_multi_day ? target.series_rows.map(r => r.reservation_id) : [currentTargetReservationId];
        
        Promise.all(ids.map(id => fetch(BASE + 'api/reservations/' + encodeURIComponent(id) + '/cancel-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason })
        }).then(res => res.json())))
        .then(results => {
          const failed = results.find(json => !json.success);
          if (!failed) {
            closeModal();
            showToast('Cancellation request submitted. Your booking stands until staff review it.', 'success');
            fetchReservations();
          } else {
            showCancelReqError(failed.error || 'Could not submit the request.');
          }
        })
        .catch(err => {
          console.error(err);
          showCancelReqError('Network error. Please try again.');
        })
        .finally(() => { cancelReqSubmit.disabled = false; });\
);

// 2. Remove
file = file.replace(
  \        const wasPending = (allReservations.find(r => r.reservation_id === currentTargetReservationId) || {}).status === 'Pending';
        fetch(BASE + 'api/reservations/' + encodeURIComponent(currentTargetReservationId), {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        })
        .then(res => res.json())
        .then(json => {
          if (json.success || json.removed) {
            showToast(wasPending ? 'Request cancelled and moved to archive (retained for 30 days).' : 'Booking moved to archive (retained for 30 days before permanent deletion).', 'success');
            fetchReservations(); // reload entirely
          } else {
            showToast(json.error || 'Failed to remove the booking.', 'error');
          }
        })
        .catch(err => {
          console.error(err);
          showToast('Network error.', 'error');
        })
        .finally(closeModal);\,
  \        const target = allReservations.find(r => r.reservation_id === currentTargetReservationId) || {};
        const wasPending = target.status === 'Pending';
        const ids = target.is_multi_day ? target.series_rows.map(r => r.reservation_id) : [currentTargetReservationId];
        
        Promise.all(ids.map(id => fetch(BASE + 'api/reservations/' + encodeURIComponent(id), {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' }
        }).then(res => res.json())))
        .then(results => {
          const failed = results.find(json => !json.success && !json.removed);
          if (!failed) {
            showToast(wasPending ? 'Request cancelled and moved to archive (retained for 30 days).' : 'Booking moved to archive (retained for 30 days before permanent deletion).', 'success');
            fetchReservations(); // reload entirely
          } else {
            showToast(failed.error || 'Failed to remove the booking.', 'error');
          }
        })
        .catch(err => {
          console.error(err);
          showToast('Network error.', 'error');
        })
        .finally(closeModal);\
);

// 3. Move
file = file.replace(
  \        const res = await fetch(\\\\\\api/reservations/\\\/move-request\\\, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requested_start_time: requestedStart,
            requested_end_time: requestedEnd
          })
        });
        const json = await res.json();

        if (json.success) {
          fetchReservations(); // reload to show pending badge
          closeModal();
        } else {
          moveErrorMsg.textContent = json.error || 'Failed to submit move request.';
          moveErrorMsg.classList.remove('hidden');
        }\,
  \        const target = allReservations.find(r => r.reservation_id === currentTargetReservationId) || {};
        const ids = target.is_multi_day ? target.series_rows.map(r => r.reservation_id) : [currentTargetReservationId];
        
        let allSuccess = true;
        let lastError = null;
        
        for (const id of ids) {
          const res = await fetch(\\\\\\api/reservations/\\\/move-request\\\, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requested_start_time: requestedStart,
              requested_end_time: requestedEnd
            })
          });
          const json = await res.json();
          if (!json.success) {
            allSuccess = false;
            lastError = json.error;
            break;
          }
        }

        if (allSuccess) {
          fetchReservations(); // reload to show pending badge
          closeModal();
        } else {
          moveErrorMsg.textContent = lastError || 'Failed to submit move request for one or more dates.';
          moveErrorMsg.classList.remove('hidden');
        }\
);

fs.writeFileSync('public/js/reservations.js', file, 'utf8');
console.log('Done!');
