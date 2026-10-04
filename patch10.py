import os
import re

with open('public/js/booking.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the handler
def replace_submit(m):
    return """          if (!result) return;                       // 401
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

pattern = re.compile(r'          if \(!result\) return;\s*// 401.*?Reservation request created\';', re.DOTALL)
content = pattern.sub(replace_submit, content)

with open('public/js/booking.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Success')
