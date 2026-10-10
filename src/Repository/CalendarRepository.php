<?php

declare(strict_types=1);

namespace CampusRoom\Repository;

use CampusRoom\Core\Database;

/**
 * CalendarRepository — read-only bulk queries for the Master Calendar.
 *
 * One round trip for any number of rooms (the database is remote, ~250 ms per
 * trip), using JSON aggregation like RoomRepository::getRoomCalendar().
 */
class CalendarRepository
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /**
     * Rooms plus everything that occupies them between two dates.
     *
     * Privacy (identical to RoomController::getCalendar for customers, but
     * enforced in SQL so other people's data never leaves the database):
     * another customer's booking comes back with purpose "Reserved", no
     * category, no name, no customer_id and no reservation_id/series_id.
     * Only is_mine says whose it is.
     *
     * @param string[] $roomIds validated UUIDs; empty = every active room
     * @return array{rooms: array, reservations: array, classes: array, holidays: array}
     */
    public function master(array $roomIds, string $startDate, string $endDate, string $userId): array
    {
        $ids = implode(',', $roomIds);

        $stmt = $this->db->query(
            "WITH sel AS (
                SELECT room_id, name, floor, room_type, capacity,
                       status::text AS status, requires_approval
                  FROM Rooms
                 WHERE is_active = TRUE
                   AND (:ids_all = '' OR room_id = ANY(string_to_array(:ids_list, ',')::uuid[]))
                 ORDER BY name
                 LIMIT 40
             )
             SELECT
                (SELECT COALESCE(json_agg(row_to_json(s) ORDER BY s.name), '[]') FROM sel s) AS rooms,
                (SELECT COALESCE(json_agg(row_to_json(r) ORDER BY r.start_time), '[]') FROM (
                    SELECT CASE WHEN rv.customer_id = :me4 THEN rv.reservation_id ELSE NULL END AS reservation_id,
                           rv.room_id, rv.start_time, rv.end_time,
                           rv.status::text AS status,
                           CASE WHEN rv.customer_id = :me5 THEN rv.series_id ELSE NULL END AS series_id,
                           (rv.customer_id = :me1) AS is_mine,
                           CASE WHEN rv.customer_id = :me2 THEN rv.purpose ELSE 'Reserved' END AS purpose,
                           CASE WHEN rv.customer_id = :me3 THEN rv.category::text ELSE NULL END AS category
                      FROM Reservations rv
                      JOIN sel ON sel.room_id = rv.room_id
                     WHERE rv.status IN ('Pending', 'Approved')
                       AND rv.start_time < :end_ts
                       AND rv.end_time   > :start_ts
                ) r) AS reservations,
                (SELECT COALESCE(json_agg(row_to_json(c)), '[]') FROM (
                    SELECT cs.room_id, cs.course_code, cs.section,
                           cs.day_of_week::text AS day_of_week,
                           to_char(cs.start_time, 'HH24:MI') AS start_time,
                           to_char(cs.end_time,   'HH24:MI') AS end_time
                      FROM ClassSchedules cs
                      JOIN sel ON sel.room_id = cs.room_id
                     ORDER BY cs.day_of_week, cs.start_time
                ) c) AS classes,
                (SELECT COALESCE(json_agg(row_to_json(h)), '[]') FROM (
                    SELECT holiday_date, name, type::text AS type
                      FROM Holidays
                     WHERE holiday_date >= :start_d
                       AND holiday_date <= :end_d
                     ORDER BY holiday_date
                ) h) AS holidays",
            [
                ':ids_all'  => $ids,
                ':ids_list' => $ids,
                ':me1'      => $userId,
                ':me2'      => $userId,
                ':me3'      => $userId,
                ':me4'      => $userId,
                ':me5'      => $userId,
                ':start_ts' => $startDate . ' 00:00:00',
                ':end_ts'   => $endDate . ' 23:59:59',
                ':start_d'  => $startDate,
                ':end_d'    => $endDate,
            ]
        );

        $row = $stmt->fetch();

        return [
            'rooms'        => json_decode((string) $row['rooms'], true) ?: [],
            'reservations' => json_decode((string) $row['reservations'], true) ?: [],
            'classes'      => json_decode((string) $row['classes'], true) ?: [],
            'holidays'     => json_decode((string) $row['holidays'], true) ?: [],
        ];
    }


    /**
     * Staff/admin calendar data. This is deliberately a separate SQL path from
     * master() so the customer response and its privacy projection remain unchanged.
     * Only non-sensitive requester display name is included; no email or account data.
     * @return array{rooms: array, reservations: array, classes: array, holidays: array}
     */
    public function masterDetailed(array $roomIds, string $startDate, string $endDate): array
    {
        $ids = implode(',', $roomIds);
        $stmt = $this->db->query(
            "WITH sel AS (
                SELECT room_id, name, floor, room_type, capacity,
                       status::text AS status, requires_approval
                  FROM Rooms
                 WHERE is_active = TRUE
                   AND (:ids_all = '' OR room_id = ANY(string_to_array(:ids_list, ',')::uuid[]))
                 ORDER BY name LIMIT 40
             )
             SELECT
                (SELECT COALESCE(json_agg(row_to_json(s) ORDER BY s.name), '[]') FROM sel s) AS rooms,
                (SELECT COALESCE(json_agg(row_to_json(r) ORDER BY r.start_time), '[]') FROM (
                    SELECT rv.reservation_id, rv.room_id, rv.start_time, rv.end_time,
                           rv.status::text AS status, rv.series_id,
                           rv.purpose, rv.category::text AS category,
                           u.name AS requester_name, FALSE AS is_mine
                      FROM Reservations rv
                      JOIN sel ON sel.room_id = rv.room_id
                      LEFT JOIN Users u ON u.user_id = rv.customer_id
                     WHERE rv.status IN ('Pending', 'Approved')
                       AND rv.start_time < :end_ts AND rv.end_time > :start_ts
                ) r) AS reservations,
                (SELECT COALESCE(json_agg(row_to_json(c)), '[]') FROM (
                    SELECT cs.room_id, cs.course_code, cs.section,
                           cs.day_of_week::text AS day_of_week,
                           to_char(cs.start_time, 'HH24:MI') AS start_time,
                           to_char(cs.end_time, 'HH24:MI') AS end_time
                      FROM ClassSchedules cs JOIN sel ON sel.room_id = cs.room_id
                     ORDER BY cs.day_of_week, cs.start_time
                ) c) AS classes,
                (SELECT COALESCE(json_agg(row_to_json(h)), '[]') FROM (
                    SELECT holiday_date, name, type::text AS type FROM Holidays
                     WHERE holiday_date >= :start_d AND holiday_date <= :end_d
                     ORDER BY holiday_date
                ) h) AS holidays",
            [
                ':ids_all' => $ids, ':ids_list' => $ids,
                ':start_ts' => $startDate . ' 00:00:00', ':end_ts' => $endDate . ' 23:59:59',
                ':start_d' => $startDate, ':end_d' => $endDate,
            ]
        );
        $row = $stmt->fetch();
        return [
            'rooms' => json_decode((string) $row['rooms'], true) ?: [],
            'reservations' => json_decode((string) $row['reservations'], true) ?: [],
            'classes' => json_decode((string) $row['classes'], true) ?: [],
            'holidays' => json_decode((string) $row['holidays'], true) ?: [],
        ];
    }

}
