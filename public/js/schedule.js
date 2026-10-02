/**
 * CampusRoom — shared schedule-range helpers.
 *
 * Plain script, no modules (matches the rest of public/js). Load it with
 * <script src="js/schedule.js"></script> BEFORE the page script that uses it.
 *
 *   const S = window.CampusSchedule;
 *   const data = await S.fetchDay(BASE, roomId, '2026-09-21');
 *   const clash = S.findConflicts(data, '2026-09-21', '09:00', '12:00');
 *   if (clash.length) alert(S.describe(clash, '09:00', '12:00'));
 *
 * A reservation is a RANGE, not a start time. It conflicts with a class, an
 * existing Pending/Approved reservation, or a holiday when the two ranges share
 * any minute — including the case where the request starts in a free slot but
 * runs on into a busy one, or wraps around a busy one entirely. Ranges are
 * half-open, so 09:00-10:30 and 10:30-12:00 do NOT conflict. That is exactly the
 * rule ReservationValidator (PHP) and the DB triggers enforce:
 *
 *     start < other.end  &&  end > other.start
 *
 * This is a CONVENIENCE layer that lets the forms warn before submitting; the
 * server stays the authority and re-checks everything.
 *
 * Times are literal Asia/Manila wall-clock strings, compared as "HH:MM" text
 * (zero-padded 24h strings sort correctly). Nothing here uses the device timezone.
 */
(function () {
  'use strict';

  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  /** "2026-09-21 09:00:00", "2026-09-21T09:00" or "09:00:00" -> "09:00", or ''. */
  function hhmm(value) {
    const m = /(?:^|[T ])(\d{2}):(\d{2})/.exec(String(value == null ? '' : value));
    return m ? m[1] + ':' + m[2] : '';
  }

  /** 'YYYY-MM-DD' -> 'Monday' (built from local parts, so the zone cannot shift the day). */
  function dayName(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
    return m ? DAY_NAMES[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()] : '';
  }

  /** "13:30" -> "1:30 PM". */
  function fmt12(time) {
    const m = /^(\d{2}):(\d{2})$/.exec(time);
    if (!m) return time;
    const h = Number(m[1]);
    return ((h + 11) % 12 + 1) + ':' + m[2] + ' ' + (h >= 12 ? 'PM' : 'AM');
  }

  /**
   * Everything that occupies the room on one date, from a GET api/rooms/{id}/calendar
   * payload: that weekday's classes plus that date's Pending/Approved reservations.
   *
   * opts.excludeReservationId  ignore this reservation (moving a booking must not
   *                            clash with the slot it is leaving).
   */
  function busyBlocks(data, date, opts) {
    const exclude = opts && opts.excludeReservationId;
    const weekday = dayName(date);
    const blocks = [];

    ((data && data.class_schedules) || [])
      .filter(c => c.day_of_week === weekday)
      .forEach(c => blocks.push({
        kind: 'class',
        start: hhmm(c.start_time),
        end: hhmm(c.end_time),
        label: 'class ' + [c.course_code, c.section].filter(Boolean).join(' ')
      }));

    ((data && data.reservations) || [])
      .filter(r => String(r.start_time).startsWith(date) && r.reservation_id !== exclude)
      .forEach(r => blocks.push({
        kind: 'reservation',
        status: r.status,
        start: hhmm(r.start_time),
        end: hhmm(r.end_time),
        label: r.status === 'Pending' ? 'a pending reservation' : 'an approved reservation'
      }));

    return blocks.sort((a, b) => a.start.localeCompare(b.start));
  }

  /**
   * True when every conflict is an Approved reservation — the only kind a
   * customer can ask staff to override (a class, holiday or pending request
   * can't be). The server makes the final call.
   */
  function onlyApprovedConflicts(conflicts) {
    return !!conflicts && conflicts.length > 0 &&
      conflicts.every(c => c.kind === 'reservation' && c.status === 'Approved');
  }

  /**
   * Every conflict for the range [start, end) on `date` ("HH:MM" strings).
   * A holiday closes the whole day, so it is returned alone.
   * Returns [] when the range is free (or when the inputs are incomplete).
   */
  function findConflicts(data, date, start, end, opts) {
    if (!data || !date || !start || !end || end <= start) return [];

    const holiday = (data.holidays || []).find(h => String(h.holiday_date).startsWith(date));
    if (holiday) {
      return [{ kind: 'holiday', start: '00:00', end: '24:00', label: 'a holiday (' + holiday.name + ')' }];
    }

    return busyBlocks(data, date, opts).filter(b => start < b.end && end > b.start);
  }

  /** One sentence naming what the range collides with, for a form error. */
  function describe(conflicts, start, end) {
    if (!conflicts || !conflicts.length) return '';
    const holiday = conflicts.find(c => c.kind === 'holiday');
    if (holiday) return 'That date is unavailable: it falls on ' + holiday.label + '.';

    const list = conflicts.map(c => c.label + ' (' + fmt12(c.start) + ' - ' + fmt12(c.end) + ')');
    const joined = list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : list[0];
    return 'Your selected time (' + fmt12(start) + ' - ' + fmt12(end) + ') overlaps ' + joined + '.';
  }

  /** Every 'YYYY-MM-DD' from start to end inclusive ([] if backwards or malformed). */
  function datesBetween(start, end) {
    const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(start || ''));
    const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(end || ''));
    if (!a || !b || end < start) return [];
    const out = [];
    const d = new Date(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
    for (let ymd = start; ymd <= end && out.length <= 366; ) {
      out.push(ymd);
      d.setDate(d.getDate() + 1);
      ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    return out;
  }

  /**
   * findConflicts() for the same daily window on each of `dates`. Every
   * conflict carries the `date` it falls on.
   */
  function findRangeConflicts(data, dates, start, end, opts) {
    return (dates || []).flatMap(date =>
      findConflicts(data, date, start, end, opts).map(c => Object.assign({ date }, c)));
  }

  /** describe() for a multi-day range: names the first day that clashes. */
  function describeRange(conflicts, start, end) {
    if (!conflicts || !conflicts.length) return '';
    const date = conflicts[0].date;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
    const label = m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
          .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      : '';
    const days = new Set(conflicts.map(c => c.date)).size;
    const more = days > 1 ? ' (' + (days - 1) + ' more day' + (days > 2 ? 's' : '') + ' also clash)' : '';
    return (label ? label + ': ' : '') + describe(conflicts.filter(c => c.date === date), start, end) + more;
  }

  /**
   * A room's schedule from `start` to `end` (inclusive dates). Resolves to the
   * payload, or null on any failure — callers treat null as "can't pre-check;
   * let the server decide", never as "the room is free".
   */
  const _cache = new Map();
  function fetchRange(baseUri, roomId, start, end) {
    const url = baseUri + 'api/rooms/' + encodeURIComponent(roomId) +
      '/calendar?start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end);
    
    if (_cache.has(url)) {
      return Promise.resolve(_cache.get(url));
    }

    return fetch(url, { credentials: 'include' })
      .then(res => res.json())
      .then(json => {
        const data = (json && json.success) ? json.data : null;
        if (data) _cache.set(url, data);
        return data;
      })
      .catch(() => null);
  }

  // ---- Booking rules (Admin > System Configuration, via GET api/config) ----

  /** What the server enforced before the rules became configurable. */
  const DEFAULT_RULES = Object.freeze({ open: '06:00', close: '21:00', closedDays: [] });
  let rulesPromise = null;

  /**
   * The business hours and closed days, fetched once per page. Resolves to
   * { open: 'HH:MM', close: 'HH:MM', closedDays: ['Sunday', ...] } and never
   * rejects: if api/config can't be read, the defaults apply (the server
   * still enforces the real rules either way).
   */
  function loadRules(baseUri) {
    if (!rulesPromise) {
      rulesPromise = fetch(baseUri + 'api/config', { credentials: 'same-origin' })
        .then(res => res.json())
        .then(json => {
          const d = (json && json.success && json.data) || {};
          const time = v => (/^\d{2}:\d{2}$/.test(String(v || '')) ? v : null);
          const open = time(d.business_hours_start), close = time(d.business_hours_end);
          if (!open || !close || close <= open || !Array.isArray(d.closed_days)) return DEFAULT_RULES;
          return Object.freeze({ open, close, closedDays: d.closed_days.filter(x => DAY_NAMES.includes(x)) });
        })
        .catch(() => DEFAULT_RULES);
    }
    return rulesPromise;
  }

  /** Half-hour marks from open to close inclusive: '08:00', '08:30', ... close. */
  function halfHours(open, close) {
    const toMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const out = [];
    // Start on the first :00/:30 at or after opening.
    for (let m = Math.ceil(toMin(open) / 30) * 30; m <= toMin(close); m += 30) {
      out.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'));
    }
    return out;
  }

  /** Is 'YYYY-MM-DD' one of the closed weekdays? */
  function isClosedDay(ymd, closedDays) {
    return (closedDays || []).includes(dayName(ymd));
  }

  /** One day of a room's schedule; see fetchRange(). */
  function fetchDay(baseUri, roomId, date) {
    return fetchRange(baseUri, roomId, date, date);
  }

  window.CampusSchedule = Object.freeze({
    hhmm, dayName, fmt12, busyBlocks, findConflicts, describe, fetchDay,
    datesBetween, findRangeConflicts, describeRange, fetchRange, onlyApprovedConflicts,
    DEFAULT_RULES, loadRules, halfHours, isClosedDay
  });
})();
