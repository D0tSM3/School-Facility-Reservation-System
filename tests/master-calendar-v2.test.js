'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const window = {};
const context = vm.createContext({ window, Date, Error, Number, Array, String, Math, Infinity });
for (const file of ['public/js/mc/lanes.js', 'public/js/mc/series.js']) {
  vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
}

test('lane layout gives simultaneous bookings separate equal-width lanes', () => {
  const blocks = [1,2,3,4,5].map(i => ({ id:i, startMin:600, endMin:660 }));
  const lanes = window.MCLanes.layout(blocks);
  assert.deepEqual(lanes.map(x => x.lane).sort(), [0,1,2,3,4]);
  assert.ok(lanes.every(x => x.laneCount === 5 && !x.hidden));
});

test('lane layout reuses a lane for back-to-back items', () => {
  const lanes = window.MCLanes.layout([
    { startMin:540,endMin:600 }, { startMin:600,endMin:660 }, { startMin:550,endMin:610 }
  ]);
  assert.equal(lanes[0].laneCount, 2);
  assert.equal(lanes[1].laneCount, 2);
  assert.equal(lanes[2].laneCount, 2);
});

test('lane layout handles overlap chains without forcing unrelated blocks into extra lanes', () => {
  const lanes = window.MCLanes.layout([
    { startMin:540,endMin:600 }, { startMin:570,endMin:630 }, { startMin:600,endMin:660 }
  ]);
  assert.equal(lanes[0].laneCount, 2);
  assert.equal(lanes[1].laneCount, 2);
  assert.equal(lanes[2].laneCount, 2);
});

test('lane layout flags overflow after three visible lanes', () => {
  const lanes = window.MCLanes.layout([1,2,3,4,5].map(i => ({ id:i, startMin:600, endMin:660 })), 3);
  assert.deepEqual(lanes.map(x => x.hidden), [false,false,false,true,true]);
  assert.ok(lanes.every(x => x.laneCount === 3));
});

test('series expansion includes the endpoints and enforces the seven-day UI cap', () => {
  assert.deepEqual(Array.from(window.MCSeries.expand('2026-10-12','2026-10-18')), [
    '2026-10-12','2026-10-13','2026-10-14','2026-10-15','2026-10-16','2026-10-17','2026-10-18'
  ]);
  assert.throws(() => window.MCSeries.expand('2026-10-12','2026-10-19'), /at most 7 days/);
});

test('specific-day expansion keeps only selected dates', () => {
  assert.deepEqual(Array.from(window.MCSeries.expand('2026-10-12','2026-10-15',['2026-10-12','2026-10-14'])), ['2026-10-12','2026-10-14']);
});

test('single-day and consecutive payloads use the established timestamp fields', () => {
  const single = window.MCSeries.payload({ mode:'single', roomId:'room-1', startDate:'2026-10-12', startTime:'09:00', endTime:'09:30', purpose:'Review', category:'Academic Lecture' });
  assert.equal(single.start_time, '2026-10-12T09:00');
  assert.equal(single.end_time, '2026-10-12T09:30');
  assert.equal(Object.hasOwn(single, 'active_dates'), false);
  const consecutive = window.MCSeries.payload({ mode:'consecutive', roomId:'room-1', startDate:'2026-10-12', endDate:'2026-10-14', startTime:'09:00', endTime:'10:00', purpose:'Review', category:'Academic Lecture' });
  assert.equal(consecutive.start_time, '2026-10-12T09:00');
  assert.equal(consecutive.end_time, '2026-10-14T10:00');
  assert.equal(Object.hasOwn(consecutive, 'active_dates'), false);
});

test('specific-day payload matches the existing reservation API shape', () => {
  const payload = window.MCSeries.payload({ mode:'specific', roomId:'room-1', startDate:'2026-10-12', endDate:'2026-10-14', startTime:'09:00', endTime:'10:00', purpose:'Meeting', category:'Student Org Meeting', equipmentNotes:'HDMI', activeDates:['2026-10-12','2026-10-14'] });
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
    room_id:'room-1', start_time:'2026-10-12T09:00', end_time:'2026-10-14T10:00', purpose:'Meeting', category:'Student Org Meeting', equipment_notes:'HDMI', active_dates:['2026-10-12','2026-10-14']
  });
});
