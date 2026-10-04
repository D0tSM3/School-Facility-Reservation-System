import os

with open('public/js/booking.js', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Update sendReservation
find_send_res = """    let json = null;
    try { json = await res.json(); } catch (_) { /* HTML error page or empty body */ }
    return { status: res.status, json };"""

replace_send_res = """    let json = null;
    try { json = await res.json(); } catch (_) { /* HTML error page or empty body */ }
    return { ok: res.ok, status: res.status, json };"""

content = content.replace(find_send_res, replace_send_res)


# 2. Update submitOverride
find_submit_override = """    if (!result) return;                                   // 401 → already redirecting to login
    const { status, json } = result;
    if (!json) return fail(`The server sent an unexpected response (HTTP ${status}). Please try again.`);
    if (!json.success) return fail(json.error || 'Your override request could not be submitted.');"""

replace_submit_override = """    if (!result) return;                                   // 401 → already redirecting to login
    const { ok, status, json } = result;
    if (!ok) {
      if (json && json.error) return fail(json.error);
      return fail(`The server sent an unexpected response (HTTP ${status}). Please try again.`);
    }
    if (json && !json.success) return fail(json.error || 'Your override request could not be submitted.');"""

content = content.replace(find_submit_override, replace_submit_override)


# 3. Update main submit handler
find_submit_handler = """            if (!result) return;                       // 401 → already redirecting to login
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

replace_submit_handler = """            if (!result) return;                       // 401 → already redirecting to login
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

content = content.replace(find_submit_handler, replace_submit_handler)

with open('public/js/booking.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Success')
