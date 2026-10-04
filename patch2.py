import os

with open('public/js/reservations.js', 'r', encoding='utf-8') as f:
    content = f.read()

find_move = """        const res = await fetch(${BASE}api/reservations//move-request, {
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
        }"""

replace_move = """        const target = allReservations.find(r => r.reservation_id === currentTargetReservationId) || {};
        const ids = target.is_multi_day ? target.series_rows.map(r => r.reservation_id) : [currentTargetReservationId];
        
        let allSuccess = true;
        let lastError = null;
        
        for (const id of ids) {
          const res = await fetch(${BASE}api/reservations//move-request, {
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
        }"""

content = content.replace(find_move, replace_move)

with open('public/js/reservations.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Success')
