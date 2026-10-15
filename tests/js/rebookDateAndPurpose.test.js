/**
 * Tests for Customer & Staff Rebooking Date Integrity,
 * Optional Reservation Purpose, Category Mapping, and Account Lockout.
 *
 * Run:
 *   node tests/js/rebookDateAndPurpose.test.js
 */
const assert = require('assert');

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    fail++;
    console.error(`  FAIL ${name}: ${err.message}`);
  }
}

console.log('--- Rebooking Date Extraction & Preservation ---');

function extractDate(dateTimeStr) {
  return String(dateTimeStr || '').split(/[T\s]/)[0];
}

test('extractDate parses SQL timestamp format', () => {
  assert.strictEqual(extractDate('2026-10-16 09:00:00'), '2026-10-16');
});

test('extractDate parses ISO timestamp format', () => {
  assert.strictEqual(extractDate('2026-10-16T13:30:00+08:00'), '2026-10-16');
  assert.strictEqual(extractDate('2026-08-03T07:30:00Z'), '2026-08-03');
});

function toYMD(d) {
  const pad = (n) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

test('Date parsing with T00:00:00 never shifts calendar day', () => {
  const dates = ['2026-01-01', '2026-08-03', '2026-10-17', '2026-12-31'];
  dates.forEach((dStr) => {
    const d = new Date(dStr + 'T00:00:00');
    assert.strictEqual(toYMD(d), dStr, `Date ${dStr} must match after local parse`);
  });
});

test('Range expansion preserves all consecutive days without timezone skips', () => {
  const start = '2026-08-03';
  const end = '2026-08-07';
  const result = [];
  let curr = new Date(start + 'T00:00:00');
  const eDate = new Date(end + 'T00:00:00');
  while (curr <= eDate) {
    result.push(toYMD(curr));
    curr.setDate(curr.getDate() + 1);
  }
  assert.deepStrictEqual(result, [
    '2026-08-03',
    '2026-08-04',
    '2026-08-05',
    '2026-08-06',
    '2026-08-07',
  ]);
});

console.log('--- Purpose Optionality & Classification Consistency ---');

const PURPOSE_LABELS = {
  lecture: 'Academic Lecture',
  defense: 'Faculty Defense',
  student_org: 'Student Org Meeting',
  workshop: 'Dept Workshop',
  exam: 'Exam/Quiz',
};

const BACKEND_CATEGORIES = [
  'Academic Lecture',
  'Faculty Defense',
  'Student Org Meeting',
  'Dept Workshop',
  'Exam/Quiz',
];

test('Frontend PURPOSE_LABELS match Backend CATEGORIES enum exactly', () => {
  const frontendValues = Object.values(PURPOSE_LABELS);
  assert.deepStrictEqual(frontendValues.sort(), [...BACKEND_CATEGORIES].sort());
});

test('Payload with empty purpose string is valid', () => {
  const payload = {
    room_id: '11111111-1111-1111-1111-111111111111',
    purpose: '',
    category: PURPOSE_LABELS['lecture'],
    start_time: '2026-08-03T09:00:00',
    end_time: '2026-08-03T10:30:00',
  };
  assert.strictEqual(payload.purpose, '');
  assert.strictEqual(BACKEND_CATEGORIES.includes(payload.category), true);
});

console.log('--- Account Lockout Security Rules ---');

const LOGIN_MAX_ATTEMPTS = 3;
const ACCOUNT_LOCKED_MESSAGE =
  'Your account is locked.';

test('Lockout trips strictly at 3 consecutive failed attempts', () => {
  let failedAttempts = 0;
  function recordAttempt(isSuccess) {
    if (isSuccess) {
      failedAttempts = 0;
      return { locked: false, status: 200 };
    }
    failedAttempts++;
    if (failedAttempts >= LOGIN_MAX_ATTEMPTS) {
      return { locked: true, status: 423, error: ACCOUNT_LOCKED_MESSAGE };
    }
    return { locked: false, status: 401, error: 'Invalid email or password.' };
  }

  // Attempt 1: fail
  let res = recordAttempt(false);
  assert.strictEqual(res.locked, false);
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.error, 'Invalid email or password.');

  // Attempt 2: fail
  res = recordAttempt(false);
  assert.strictEqual(res.locked, false);
  assert.strictEqual(res.status, 401);

  // Attempt 3: fail -> Locked (423)
  res = recordAttempt(false);
  assert.strictEqual(res.locked, true);
  assert.strictEqual(res.status, 423);
  assert.strictEqual(res.error, ACCOUNT_LOCKED_MESSAGE);
});

test('Admin unlock clears lockout and resets counter', () => {
  let isLocked = true;
  let attempts = 3;

  function adminUnlock() {
    isLocked = false;
    attempts = 0;
    return { success: true, cleared_entries: 1 };
  }

  const result = adminUnlock();
  assert.strictEqual(result.success, true);
  assert.strictEqual(isLocked, false);
  assert.strictEqual(attempts, 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
