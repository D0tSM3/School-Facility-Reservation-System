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
        start: hhmm(r.start_time),
        end: hhmm(r.end_time),
        label: r.status === 'Pending' ? 'a pending reservation' : 'an approved reservation'
      }));

    return blocks.sort((a, b) => a.start.localeCompare(b.start));
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

  /**
   * One day of a room's schedule. Resolves to the payload, or null on any
   * failure — callers treat null as "can't pre-check; let the server decide",
   * never as "the room is free".
   */
  function fetchDay(baseUri, roomId, date) {
    const url = baseUri + 'api/rooms/' + encodeURIComponent(roomId) +
      '/calendar?start=' + encodeURIComponent(date) + '&end=' + encodeURIComponent(date);
    return fetch(url, { credentials: 'include' })
      .then(res => res.json())
      .then(json => (json && json.success ? json.data : null))
      .catch(() => null);
  }

  window.CampusSchedule = Object.freeze({ hhmm, dayName, fmt12, busyBlocks, findConflicts, describe, fetchDay });
})();
