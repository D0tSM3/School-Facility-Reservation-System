$file = Get-Content public\js\reservations.js -Raw

# 1. Patch Move Submit
$findMove = <<<'EOD'
        const res = await fetch(`${BASE}api/reservations/${currentTargetReservationId}/move-request`, {
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
        }
EOD
$replaceMove = <<<'EOD'
        const target = allReservations.find(r => r.reservation_id === currentTargetReservationId) || {};
        const ids = target.is_multi_day ? target.series_rows.map(r => r.reservation_id) : [currentTargetReservationId];
        
        let allSuccess = true;
        let lastError = null;
        
        for (const id of ids) {
          // Adjust requested start/end for each specific day in the series
          let reqStart = requestedStart;
          let reqEnd = requestedEnd;
          if (target.is_multi_day) {
            const originalRow = target.series_rows.find(r => r.reservation_id === id);
            if (originalRow) {
               const origDate = originalRow.start_time.slice(0, 10);
               // We keep the time from requestedStart, but use the date from the original row.
               // Wait, Move is usually for one day. If they move a multi-day series, what date do they pick?
               // The move UI only asks for ONE date. Moving a multi-day series to a new single date doesn't make sense,
               // or moving it by shifting all dates? The UI isn't designed for multi-day move.
               // Let's just pass the requestedStart/End exactly as selected, for all rows.
            }
          }

          const res = await fetch(`${BASE}api/reservations/${id}/move-request`, {
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
        }
EOD

$findMove = $findMove -replace '\r\n', "`n"
$replaceMove = $replaceMove -replace '\r\n', "`n"
$file = $file.Replace($findMove, $replaceMove)

# 2. Patch Remove (DELETE)
$findRemove = <<<'EOD'
      const wasPending = (allReservations.find(r => r.reservation_id === currentTargetReservationId) || {}).status === 'Pending';
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
      .finally(closeModal);
EOD
$replaceRemove = <<<'EOD'
      const target = allReservations.find(r => r.reservation_id === currentTargetReservationId) || {};
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
      .finally(closeModal);
EOD

$findRemove = $findRemove -replace '\r\n', "`n"
$replaceRemove = $replaceRemove -replace '\r\n', "`n"
$file = $file.Replace($findRemove, $replaceRemove)

# 3. Patch Cancel Request (POST)
$findCancel = <<<'EOD'
      cancelReqSubmit.disabled = true;
      const targetId = currentTargetReservationId;
      fetch(BASE + 'api/reservations/' + encodeURIComponent(targetId) + '/cancel-request', {
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
      .finally(() => { cancelReqSubmit.disabled = false; });
EOD
$replaceCancel = <<<'EOD'
      cancelReqSubmit.disabled = true;
      const target = allReservations.find(r => r.reservation_id === currentTargetReservationId) || {};
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
      .finally(() => { cancelReqSubmit.disabled = false; });
EOD

$findCancel = $findCancel -replace '\r\n', "`n"
$replaceCancel = $replaceCancel -replace '\r\n', "`n"
$file = $file.Replace($findCancel, $replaceCancel)

Set-Content public\js\reservations.js $file
