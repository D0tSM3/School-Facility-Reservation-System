import os

with open('public/js/reservations.js', 'r', encoding='utf-8') as f:
    content = f.read()

find_delete = """        const wasPending = (allReservations.find(r => r.reservation_id === currentTargetReservationId) || {}).status === 'Pending';
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
        .finally(closeModal);"""

replace_delete = """        const target = allReservations.find(r => r.reservation_id === currentTargetReservationId) || {};
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
        .finally(closeModal);"""

find_cancel = """      fetch(BASE + 'api/reservations/' + encodeURIComponent(targetId) + '/cancel-request', {
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
      .finally(() => { cancelReqSubmit.disabled = false; });"""

replace_cancel = """      const target = allReservations.find(r => r.reservation_id === currentTargetReservationId) || {};
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
      .finally(() => { cancelReqSubmit.disabled = false; });"""

content = content.replace(find_delete, replace_delete)
content = content.replace(find_cancel, replace_cancel)

with open('public/js/reservations.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Success')
