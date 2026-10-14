/* Pure date expansion and payload builder for single/range/specific-day bookings. */
(function (root) {
  'use strict';
  const ymd = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  function expand(start, end, activeDates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) throw new Error('Choose a valid date range.');
    const a = new Date(start+'T12:00:00'), b = new Date(end+'T12:00:00'), days=[];
    for (let d=new Date(a); d<=b; d.setDate(d.getDate()+1)) { days.push(ymd(d)); if (days.length>7) throw new Error('Calendar bookings can cover at most 7 days.'); }
    if (activeDates !== null && activeDates !== undefined) return days.filter(d => activeDates.includes(d));
    return days;
  }
  function payload(input) {
    const days = input.mode === 'single' ? [input.startDate] : expand(input.startDate,input.endDate,input.mode==='specific' ? input.activeDates : null);
    if (!days.length) throw new Error('Select at least one booking date.');
    const last = input.mode === 'single' ? input.startDate : (input.endDate || input.startDate);
    const out = { room_id: input.roomId, start_time: input.startDate+'T'+input.startTime, end_time: last+'T'+input.endTime, purpose: input.purpose, category: input.category, equipment_notes: input.equipmentNotes || '' };
    if (input.mode === 'specific') out.active_dates = days;
    return out;
  }
  root.MCSeries = Object.freeze({ expand, payload });
})(window);
