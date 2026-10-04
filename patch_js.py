import os

with open('public/js/booking.js', 'r', encoding='utf-8') as f:
    content = f.read()

find = """  async function submitOverride() {
    const { wrap, close, payload } = overrideModal;
    const reason = wrap.querySelector('#overrideReason').value.trim();
    const err = wrap.querySelector('[data-override-error]');
    const btn = wrap.querySelector('[data-override-submit]');
    const fail = (msg) => { err.textContent = msg; err.classList.remove('hidden'); btn.disabled = false; };

    if (!reason) return fail('Please explain why this booking is urgent.');
    btn.disabled = true;
    err.classList.add('hidden');

    let result;
    try {
      result = await sendReservation('api/conflict-override-requests', Object.assign({}, payload, { reason }));"""

replace = """  async function submitOverride() {
    const { wrap, close, payload } = overrideModal;
    const reason = wrap.querySelector('#overrideReason').value.trim();
    const err = wrap.querySelector('[data-override-error]');
    const btn = wrap.querySelector('[data-override-submit]');
    const fail = (msg) => { err.textContent = msg; err.classList.remove('hidden'); btn.disabled = false; };

    const altSchedule = wrap.querySelector('#rsAltSchedule') ? wrap.querySelector('#rsAltSchedule').value : 'No';
    const altDate = wrap.querySelector('input[name="alt_date"]') ? wrap.querySelector('input[name="alt_date"]').value : '';
    const altStart = wrap.querySelector('input[name="alt_start"]') ? wrap.querySelector('input[name="alt_start"]').value : '';
    const altEnd = wrap.querySelector('input[name="alt_end"]') ? wrap.querySelector('input[name="alt_end"]').value : '';

    if (!reason) return fail('Please explain why this booking is urgent.');
    btn.disabled = true;
    err.classList.add('hidden');

    const overridePayload = Object.assign({}, payload, { 
      reason,
      request_type: altSchedule === 'Yes' ? 'Alternative Schedule' : 'Specific Time',
      alt_start_time: altSchedule === 'Yes' && altDate && altStart ? `${altDate} ${altStart}:00` : null,
      alt_end_time: altSchedule === 'Yes' && altDate && altEnd ? `${altDate} ${altEnd}:00` : null
    });

    let result;
    try {
      result = await sendReservation('api/conflict-override-requests', overridePayload);"""

if find in content:
    content = content.replace(find, replace)
    with open('public/js/booking.js', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Updated booking.js")
else:
    print("Could not find pattern in booking.js")
