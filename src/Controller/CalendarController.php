<?php

declare(strict_types=1);

namespace CampusRoom\Controller;

use CampusRoom\Core\Auth;
use CampusRoom\Core\DateTimeHelper;
use CampusRoom\Core\ReservationValidator;
use CampusRoom\Core\Response;
use CampusRoom\Core\Settings;
use CampusRoom\Repository\CalendarRepository;

/**
 * CalendarController — read-only endpoints behind the Master Calendar page.
 *
 * Nothing here books anything: the page books through the existing
 * POST /api/reservations. Booking rules are not touched.
 */
class CalendarController
{
    /** Most rooms one request may ask for. */
    private const MAX_ROOMS = 40;
    /** Longest range one request may ask for (a month view). */
    private const MAX_DAYS = 42;

    // --- suggest() tuning -------------------------------------------------
    /** Open days (not calendar days) searched for "next free time in this room". */
    private const SUGGEST_OPEN_DAYS = 7;
    /** Calendar days scanned to find those open days (closed days and holidays are skipped). */
    private const SUGGEST_SCAN_DAYS = 14;
    /** Suggestions returned per list. */
    private const SUGGEST_LIMIT = 3;
    /** ReservationValidator::check() calls one request may spend (each is several ~250 ms DB round trips). */
    private const SUGGEST_VERIFY_TOTAL = 3;
    /** ...and the most that either list may spend, so the second list always gets a turn. */
    private const SUGGEST_VERIFY_PER_LIST = 2;
    /** Another room's slot may start at most this many minutes away from the requested start. */
    private const SUGGEST_MAX_SHIFT = 180;

    private CalendarRepository $calendar;

    public function __construct()
    {
        $this->calendar = new CalendarRepository();
    }

    // ---------------------------------------------------------------
    // GET /api/calendar/master?start=&end=&room_ids=
    // Customers receive the privacy-filtered projection; staff/admin receive a
    // separate detailed projection for their read-only operational calendar.
    // ---------------------------------------------------------------

    public function master(): never
    {
        $role = Auth::role();
        if ($role === 'Customer') {
            Auth::requireRole(['Customer']);
        } else {
            Auth::requireRole(['Staff', 'Admin']);
        }

        $tz  = new \DateTimeZone('Asia/Manila');
        $now = new \DateTimeImmutable('now', $tz);

        // No dates = today. This is how the page learns server_now before it
        // knows which day to ask for.
        $start = $_GET['start'] ?? $now->format('Y-m-d');
        $end   = $_GET['end']   ?? $start;

        $start = is_string($start) ? DateTimeHelper::toMysqlDate($start) : null;
        $end   = is_string($end)   ? DateTimeHelper::toMysqlDate($end)   : null;
        if ($start === null || $end === null) {
            Response::error('Invalid date format. Use YYYY-MM-DD.', 400);
        }
        if ($end < $start) {
            Response::error('end must not be before start.', 400);
        }

        $days = (int) (new \DateTimeImmutable($start, $tz))->diff(new \DateTimeImmutable($end, $tz))->days + 1;
        if ($days > self::MAX_DAYS) {
            Response::error('The date range may not exceed ' . self::MAX_DAYS . ' days.', 400);
        }

        $roomIds = [];
        $raw     = $_GET['room_ids'] ?? '';
        if (is_string($raw) && trim($raw) !== '') {
            foreach (explode(',', $raw) as $id) {
                $id = strtolower(trim($id));
                if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $id) !== 1) {
                    Response::error('room_ids must be a comma-separated list of room UUIDs.', 400);
                }
                $roomIds[$id] = $id;
            }
            $roomIds = array_values($roomIds);
            if (count($roomIds) > self::MAX_ROOMS) {
                Response::error('At most ' . self::MAX_ROOMS . ' rooms per request.', 400);
            }
        }

        $data = $role === 'Customer'
            ? $this->calendar->master($roomIds, $start, $end, (string) Auth::userId())
            : $this->calendar->masterDetailed($roomIds, $start, $end);

        // Group the flat lists under their room.
        $rooms = [];
        foreach ($data['rooms'] as $room) {
            $room['reservations'] = [];
            $room['classes']      = [];
            $rooms[$room['room_id']] = $room;
        }
        foreach ($data['reservations'] as $reservation) {
            if (isset($rooms[$reservation['room_id']])) {
                $rooms[$reservation['room_id']]['reservations'][] = $reservation;
            }
        }
        foreach ($data['classes'] as $class) {
            if (isset($rooms[$class['room_id']])) {
                $rooms[$class['room_id']]['classes'][] = $class;
            }
        }

        Response::json([
            // Asia/Manila wall-clock, so the browser never has to trust the device clock.
            'server_now' => $now->format('Y-m-d\TH:i:s'),
            // Lets the shared calendar page switch itself to read-only for Staff/Admin.
            'viewer_role' => $role,
            'rules'      => [
                'open'       => Settings::businessHoursStart(),
                'close'      => Settings::businessHoursEnd(),
                'closedDays' => Settings::closedDays(),
                'periods'    => Settings::periods(),
            ],
            'holidays'   => $data['holidays'],
            'rooms'      => array_values($rooms),
        ]);
    }

    // ---------------------------------------------------------------
    // Customer: GET /api/calendar/suggest?room_id=&date=&start=&end=&capacity=
    //
    // "Don't just show an error": for a slot that is taken (or no longer free)
    // return the next free windows of the same length in the same room and a
    // few similar rooms that are free at about the same time.
    //
    // Read-only. Candidates come from the same bulk data as /master, using the
    // same overlap rule as the validator (start < other.end && end > other.start).
    // The first few are then confirmed with ReservationValidator::check() — the
    // single source of truth — and dropped if it disagrees. Whatever is not
    // confirmed is still re-validated by the server when the customer submits.
    // Nothing about anyone's booking is returned, only free windows.
    // ---------------------------------------------------------------

    public function suggest(): never
    {
        Auth::requireRole(['Customer']);

        $roomId = $_GET['room_id'] ?? '';
        $roomId = is_string($roomId) ? strtolower(trim($roomId)) : '';
        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $roomId) !== 1) {
            Response::error('room_id must be a room UUID.', 400);
        }

        $dateRaw = $_GET['date'] ?? '';
        $date    = is_string($dateRaw) ? DateTimeHelper::toMysqlDate($dateRaw) : null;
        if ($date === null) {
            Response::error('Invalid date format. Use YYYY-MM-DD.', 400);
        }

        $start = $this->timeParam('start');
        $end   = $this->timeParam('end');
        if ($start === null || $end === null) {
            Response::error('start and end must be times in HH:MM.', 400);
        }
        if ($end <= $start) {
            Response::error('end must be after start.', 400);
        }

        $seats = null;
        $rawSeats = $_GET['capacity'] ?? '';
        if (is_string($rawSeats) && trim($rawSeats) !== '') {
            if (ctype_digit(trim($rawSeats)) === false) {
                Response::error('capacity must be a whole number.', 400);
            }
            $seats = min(100000, max(1, (int) trim($rawSeats)));
        }

        $tz     = new \DateTimeZone('Asia/Manila');
        $now    = new \DateTimeImmutable('now', $tz);
        $today  = $now->format('Y-m-d');
        $nowMin = ((int) $now->format('G')) * 60 + (int) $now->format('i');

        // Never look into the past.
        $from = $date < $today ? $today : $date;
        $to   = (new \DateTimeImmutable($from, $tz))
            ->modify('+' . (self::SUGGEST_SCAN_DAYS - 1) . ' days')
            ->format('Y-m-d');

        $data = $this->calendar->master([], $from, $to, (string) Auth::userId());

        $rooms = [];
        foreach ($data['rooms'] as $r) {
            $rooms[(string) $r['room_id']] = $r;
        }
        if (!isset($rooms[$roomId])) {
            Response::error('Room not found.', 404);
        }
        $asked = $rooms[$roomId];

        // ---- what occupies each room: classes by weekday, reservations by date ----
        $classes = [];   // [room_id][Weekday][] = [startMin, endMin]
        foreach ($data['classes'] as $c) {
            $classes[(string) $c['room_id']][(string) $c['day_of_week']][] =
                [$this->toMin((string) $c['start_time']), $this->toMin((string) $c['end_time'])];
        }
        $booked = [];    // [room_id][Y-m-d][] = [startMin, endMin]
        foreach ($data['reservations'] as $rv) {
            $st = (string) $rv['start_time'];
            $en = (string) $rv['end_time'];
            // 'YYYY-MM-DD?HH:MM' — the separator may be 'T' or a space.
            $booked[(string) $rv['room_id']][substr($st, 0, 10)][] =
                [$this->toMin(substr($st, 11, 5)), $this->toMin(substr($en, 11, 5))];
        }
        $holidays = [];
        foreach ($data['holidays'] as $h) {
            $holidays[substr((string) $h['holiday_date'], 0, 10)] = true;
        }

        // ---- the open days to search ----
        $closedDays = Settings::closedDays();
        $openDays   = [];   // 'Y-m-d' => 'Monday'
        for ($i = 0; $i < self::SUGGEST_SCAN_DAYS && count($openDays) < self::SUGGEST_OPEN_DAYS; $i++) {
            $d   = (new \DateTimeImmutable($from, $tz))->modify("+{$i} days");
            $ymd = $d->format('Y-m-d');
            $dow = $d->format('l');
            if (in_array($dow, $closedDays, true) || isset($holidays[$ymd])) {
                continue;
            }
            $openDays[$ymd] = $dow;
        }

        // ---- windows of the requested length made of back-to-back snap periods ----
        $startMin = $this->toMin($start);
        $duration = $this->toMin($end) - $startMin;
        $units    = $this->units(Settings::businessHoursStart(), Settings::businessHoursEnd(), Settings::periods());
        $windows  = $this->windows($units, $duration);

        $isFree = function (string $rid, string $ymd, string $dow, array $w) use ($classes, $booked, $today, $nowMin): bool {
            // The server requires a start in the future.
            if ($ymd === $today && $w[0] <= $nowMin) {
                return false;
            }
            foreach ($classes[$rid][$dow] ?? [] as $b) {
                if ($w[0] < $b[1] && $w[1] > $b[0]) {
                    return false;
                }
            }
            foreach ($booked[$rid][$ymd] ?? [] as $b) {
                if ($w[0] < $b[1] && $w[1] > $b[0]) {
                    return false;
                }
            }
            return true;
        };

        // ---- 1. same room, next free windows (chronological) ----
        $same = [];
        if (($asked['status'] ?? '') !== 'Maintenance') {
            foreach ($openDays as $ymd => $dow) {
                foreach ($windows as $w) {
                    if ($ymd === $date && $w[0] === $startMin) {
                        continue;   // the slot that just failed
                    }
                    if ($isFree($roomId, $ymd, $dow, $w)) {
                        $same[] = ['room_id' => $roomId, 'date' => $ymd, 'w' => $w];
                    }
                }
            }
        }

        // ---- 2. similar rooms, same day, closest time first ----
        $targetDay = array_key_first($openDays);          // the requested day when it is open, else the next open one
        $need      = $seats ?? (int) $asked['capacity'];
        $askedType = $this->typeKey($asked['room_type'] ?? null);
        $askedFloor = ($asked['floor'] ?? null) === null ? null : (int) $asked['floor'];
        $others = [];
        if ($targetDay !== null) {
            $dow = $openDays[$targetDay];
            foreach ($rooms as $rid => $r) {
                if ($rid === $roomId || ($r['status'] ?? '') === 'Maintenance') {
                    continue;
                }
                if ((int) $r['capacity'] < $need || $this->typeKey($r['room_type'] ?? null) !== $askedType) {
                    continue;
                }
                $best = null;
                foreach ($windows as $w) {
                    $shift = abs($w[0] - $startMin);
                    if ($shift > self::SUGGEST_MAX_SHIFT || !$isFree($rid, $targetDay, $dow, $w)) {
                        continue;
                    }
                    $rank = [$shift === 0 ? 0 : 1, $shift];
                    if ($best === null || $rank < $best['rank']) {
                        $best = ['rank' => $rank, 'w' => $w];
                    }
                }
                if ($best === null) {
                    continue;
                }
                $floor     = ($r['floor'] ?? null) === null ? null : (int) $r['floor'];
                $floorDiff = ($floor === null || $askedFloor === null) ? null : abs($floor - $askedFloor);
                $others[] = [
                    'room'  => $r,
                    'date'  => $targetDay,
                    'w'     => $best['w'],
                    'exact' => $best['rank'][0] === 0,
                    'floor_diff' => $floorDiff,
                    // exact time first, then same floor / nearest floor (unknown last),
                    // then closest fit in seats, then closest time, then name.
                    'sort'  => [
                        $best['rank'][0],
                        $floorDiff ?? 1000,
                        (int) $r['capacity'] - $need,
                        $best['rank'][1],
                        strtolower((string) $r['name']),
                    ],
                ];
            }
            usort($others, static fn(array $a, array $b): int => $a['sort'] <=> $b['sort']);
        }

        // ---- verify the first few with the real validator, drop any it rejects ----
        $budget  = self::SUGGEST_VERIFY_TOTAL;
        $sameOut = [];
        $spent   = 0;
        foreach ($same as $c) {
            if (count($sameOut) >= self::SUGGEST_LIMIT) {
                break;
            }
            $ok = null;
            if ($budget > 0 && $spent < self::SUGGEST_VERIFY_PER_LIST) {
                $budget--;
                $spent++;
                $ok = $this->verify($c['room_id'], $c['date'], $c['w']);
                if ($ok === false) {
                    continue;
                }
            }
            $sameOut[] = [
                'date'     => $c['date'],
                'start'    => $this->hm($c['w'][0]),
                'end'      => $this->hm($c['w'][1]),
                'verified' => $ok === true,
            ];
        }

        $otherOut = [];
        $spent    = 0;
        foreach ($others as $c) {
            if (count($otherOut) >= self::SUGGEST_LIMIT) {
                break;
            }
            $r  = $c['room'];
            $ok = null;
            if ($budget > 0 && $spent < self::SUGGEST_VERIFY_PER_LIST) {
                $budget--;
                $spent++;
                $ok = $this->verify((string) $r['room_id'], $c['date'], $c['w']);
                if ($ok === false) {
                    continue;
                }
            }
            $otherOut[] = [
                'room_id'   => (string) $r['room_id'],
                'name'      => (string) $r['name'],
                'floor'     => ($r['floor'] ?? null) === null ? null : (int) $r['floor'],
                'capacity'  => (int) $r['capacity'],
                'room_type' => $r['room_type'] ?? null,
                'date'      => $c['date'],
                'start'     => $this->hm($c['w'][0]),
                'end'       => $this->hm($c['w'][1]),
                'exact'     => $c['exact'],
                'distance'  => $this->distanceLabel($c['floor_diff']),
                'verified'  => $ok === true,
            ];
        }

        Response::json([
            'server_now'   => $now->format('Y-m-d\TH:i:s'),
            'duration_min' => $duration,
            'same_room'    => $sameOut,
            'other_rooms'  => $otherOut,
        ]);
    }

    // ---------------------------------------------------------------
    // suggest() helpers (pure, except verify())
    // ---------------------------------------------------------------

    /** A strict HH:MM query parameter, or null. */
    private function timeParam(string $key): ?string
    {
        $v = $_GET[$key] ?? null;
        if (!is_string($v)) {
            return null;
        }
        $v = trim($v);
        return preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $v) === 1 ? $v : null;
    }

    /** 'HH:MM' (or longer, e.g. 'HH:MM:SS') -> minutes after midnight. */
    private function toMin(string $t): int
    {
        return ((int) substr($t, 0, 2)) * 60 + (int) substr($t, 3, 2);
    }

    /** Minutes after midnight -> 'HH:MM'. */
    private function hm(int $m): string
    {
        return sprintf('%02d:%02d', intdiv($m, 60), $m % 60);
    }

    /**
     * The bookable time units: snap periods clipped to business hours, or a
     * half-hour grid when none are configured. Same definition as the page
     * (mc/filters.js units()), so "free" means the same thing everywhere.
     *
     * @param array<int, array{0: string, 1: string}> $periods
     * @return array<int, array{0: int, 1: int}>
     */
    private function units(string $open, string $close, array $periods): array
    {
        $o   = $this->toMin($open);
        $c   = $this->toMin($close);
        $out = [];
        foreach ($periods as $p) {
            $s = max($this->toMin($p[0]), $o);
            $e = min($this->toMin($p[1]), $c);
            if ($e > $s) {
                $out[] = [$s, $e];
            }
        }
        if ($out !== []) {
            return $out;
        }
        for ($m = ((int) ceil($o / 30)) * 30; $m + 30 <= $c; $m += 30) {
            $out[] = [$m, $m + 30];
        }
        return $out;
    }

    /**
     * Every window of exactly $duration minutes that starts on a unit start and
     * ends on a unit end, with no gap between the units it spans — i.e. every
     * selection the calendar grid could actually make.
     *
     * @param array<int, array{0: int, 1: int}> $units
     * @return array<int, array{0: int, 1: int}>
     */
    private function windows(array $units, int $duration): array
    {
        $out = [];
        $n   = count($units);
        for ($i = 0; $i < $n; $i++) {
            $s = $units[$i][0];
            for ($j = $i; $j < $n; $j++) {
                if ($j > $i && $units[$j][0] !== $units[$j - 1][1]) {
                    break;                                   // a gap between periods
                }
                $len = $units[$j][1] - $s;
                if ($len === $duration) {
                    $out[] = [$s, $units[$j][1]];
                    break;
                }
                if ($len > $duration) {
                    break;
                }
            }
        }
        return $out;
    }

    /** Case-insensitive room type; every type containing "lab" counts as one (as the Labs chip does). */
    private function typeKey(mixed $type): string
    {
        $t = strtolower(trim((string) ($type ?? '')));
        return str_contains($t, 'lab') ? 'lab' : $t;
    }

    private function distanceLabel(?int $floorDiff): string
    {
        if ($floorDiff === null) {
            return '';
        }
        return $floorDiff === 0 ? 'Same floor' : $floorDiff . ' floor' . ($floorDiff === 1 ? '' : 's') . ' away';
    }

    /**
     * Ask the real booking validator whether the window would be accepted.
     * true = accepted, false = rejected, null = could not tell (keep, unverified).
     *
     * @param array{0: int, 1: int} $w
     */
    private function verify(string $roomId, string $ymd, array $w): ?bool
    {
        try {
            return ReservationValidator::check(
                $roomId,
                $ymd . ' ' . $this->hm($w[0]) . ':00',
                $ymd . ' ' . $this->hm($w[1]) . ':00'
            ) === null;
        } catch (\Throwable $e) {
            return null;
        }
    }
}
