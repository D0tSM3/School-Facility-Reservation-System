import os

with open('public/js/booking.js', 'r', encoding='utf-8') as f:
    content = f.read()

find = """          .then(result => {
            if (!result) return;                       // 401 ? already redirecting to login
            const { status, json } = result;
  
            if (!json) {
              return showCollisionError(`The server sent an unexpected response (HTTP ${status}). Please try again.`, 'Something went wrong');
            }
            if (!json.success && status === 409 && !isRebook && json.data && json.data.override_eligible) {
              return openOverrideModal(payload, json.data.conflict, json.error);
            }
            if (!json.success) {
              return showCollisionError(
                json.error || 'Your request could not be submitted.',
                status === 409 ? 'Scheduling conflict' : 'Unable to submit request'
              );
            }
  
            redirecting = true;
            const ref = 'REQ-' + String(json.data.reservation_id).substring(0, 8).toUpperCase();
            const dayCount = Array.isArray(json.data.series) ? json.data.series.length : 1;
            const what = isRebook ? 'Re-booking created'
              : dayCount > 1 ? `Reservation request created for ${dayCount} days` : 'Reservation request created';"""

replace = """          .then(result => {
            if (!result) return;                       // 401 ? already redirecting to login
            const { ok, status, json } = result;
  
            if (!ok) {
              if (json && !json.success && status === 409 && !isRebook && json.data && json.data.override_eligible) {
                return openOverrideModal(payload, json.data.conflict, json.error);
              }
              return showCollisionError(
                (json && json.error) ? json.error : `The server sent an unexpected response (HTTP ${status}). Please try again.`,
                status === 409 ? 'Scheduling conflict' : 'Something went wrong'
              );
            }

            if (json && !json.success) {
              return showCollisionError(
                json.error || 'Your request could not be submitted.',
                status === 409 ? 'Scheduling conflict' : 'Unable to submit request'
              );
            }
  
            redirecting = true;
            let ref = 'REQ-XXXXXXXX';
            let dayCount = 1;
            if (json && json.data) {
                if (json.data.reservation_id) {
                    ref = 'REQ-' + String(json.data.reservation_id).substring(0, 8).toUpperCase();
                }
                if (Array.isArray(json.data.series)) {
                    dayCount = json.data.series.length;
                }
            }
            
            const what = isRebook ? 'Re-booking created'
              : dayCount > 1 ? `Reservation request created for ${dayCount} days` : 'Reservation request created';"""

content = content.replace(find, replace)

with open('public/js/booking.js', 'w', encoding='utf-8') as f:
    f.write(content)
print("done")
