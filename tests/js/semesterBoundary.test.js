/**
 * Semester-boundary tests for the shared calendar helpers (public/js/schedule.js).
 *
 * Run: node tests/js/semesterBoundary.test.js
 *
 * Loads schedule.js under a minimal `window`/`fetch` shim (it is a browser
 * IIFE that attaches to window.CampusSchedule) and exercises classRunsOn()
 * and busyBlocks() across the verified Q1 AY2026-2027 boundary:
 *   Aug 2 (out) · Aug 3 (first day) · Oct 16 (in) · Oct 17 (last day) · Oct 18 (out)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// --- load schedule.js in a sandbox that mimics the browser globals it needs ---
const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'js', 'schedule.js'), 'utf8');
const sandbox = { window: {}, fetch: () => Promise.resolve({ json: () => ({}) }), Promise, Date, console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const S = sandbox.window.CampusSchedule;

let pass = 0, fail = 0;
function ok(label, cond) {
  if (cond) { pass++; console.log('  ok   ' + label); }
  else { fail++; console.log('  FAIL ' + label); }
}

// A Q1 class: Monday ITS122P, Aug 3 -> Oct 17 2026.
// (Aug 3 2026 is a Monday, Oct 12 2026 is a Monday, Oct 19 2026 is a Monday.)
const q1Monday = {
  day_of_week: 'Monday', course_code: 'ITS122P', section: 'AM2',
  start_time: '07:30', end_time: '12:00',
  semester_start: '2026-08-03', semester_end: '2026-10-17',
};
const legacy = { day_of_week: 'Monday', course_code: 'OLD', section: 'X', start_time: '07:30', end_time: '09:00', semester_start: null, semester_end: null };

console.log('classRunsOn — weekday gate');
ok('matching weekday inside term renders',  S.classRunsOn(q1Monday, '2026-08-10') === true);   // Mon in term
ok('wrong weekday never renders',           S.classRunsOn(q1Monday, '2026-08-11') === false);  // Tue

console.log('classRunsOn — inclusive boundaries');
ok('Aug 2 (day before start) excluded',     S.classRunsOn(q1Monday, '2026-08-02') === false);
ok('Aug 3 first day included',              S.classRunsOn(q1Monday, '2026-08-03') === true);
ok('Oct 12 within term included',          S.classRunsOn(q1Monday, '2026-10-12') === true);
ok('Oct 17 last day — but is a Saturday',  S.classRunsOn(q1Monday, '2026-10-17') === false); // Oct17 is Sat, not Monday
ok('Oct 19 (Mon after end) excluded',       S.classRunsOn(q1Monday, '2026-10-19') === false);

console.log('classRunsOn — last-day inclusivity on the right weekday');
// Use a Saturday class to prove Oct 17 (a Saturday) is included as the last day.
const q1Saturday = Object.assign({}, q1Monday, { day_of_week: 'Saturday' });
ok('Oct 17 Saturday last-day included',     S.classRunsOn(q1Saturday, '2026-10-17') === true);
ok('Oct 24 Saturday after end excluded',    S.classRunsOn(q1Saturday, '2026-10-24') === false);

console.log('classRunsOn — legacy null bounds = always active');
ok('legacy class renders on its weekday',   S.classRunsOn(legacy, '2020-01-06') === true);  // a Monday
ok('legacy class still weekday-gated',      S.classRunsOn(legacy, '2020-01-07') === false); // a Tuesday

console.log('busyBlocks — expired class does NOT occupy a later date');
const data = { class_schedules: [q1Monday], reservations: [], holidays: [] };
ok('Oct 12 (Mon, in term) shows the class', S.busyBlocks(data, '2026-10-12').some(b => b.kind === 'class'));
ok('Oct 19 (Mon, past end) shows no class', !S.busyBlocks(data, '2026-10-19').some(b => b.kind === 'class'));

console.log('findConflicts — booking after semester_end is NOT blocked by the expired class');
ok('Oct 19 booking free of class conflict', S.findConflicts(data, '2026-10-19', '07:30', '09:00').length === 0);
ok('Oct 12 booking blocked by the class',   S.findConflicts(data, '2026-10-12', '08:00', '09:00').some(c => c.kind === 'class'));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
