-- CampusRoom: seed the 14 sample class schedules for the new rooms.
-- (PostgreSQL / Supabase.) ADDITIVE — inserts rows only, deletes nothing.
--
-- PREREQUISITE: the current semester MUST be configured first
--   (Admin → Configuration → Current Academic Semester, or
--    PATCH /api/settings with semester_start / semester_end).
--   This seed stamps every class with the configured semester dates. The
--   guard below inserts NOTHING if no semester is set, so you can never create
--   classes with NULL (never-expiring) bounds by mistake.
--
-- Rooms are matched by name, so this works regardless of the generated UUIDs.
-- Multi-day courses (e.g. Tue + Thu) are separate rows, one per weekday.

INSERT INTO ClassSchedules
    (schedule_id, room_id, course_code, section, day_of_week, start_time, end_time, semester_start, semester_end)
SELECT gen_random_uuid(),
       r.room_id,
       v.course_code,
       v.section,
       v.day_of_week,
       v.start_time::time,
       v.end_time::time,
       (SELECT setting_value::date FROM system_settings WHERE setting_key = 'semester_start'),
       (SELECT setting_value::date FROM system_settings WHERE setting_key = 'semester_end')
FROM (VALUES
    ('Room 1035', 'ITS122P',   'AM2',  'Monday',    '07:30', '12:00'),
    ('Room 1038', 'ITS122P',   'AM2',  'Tuesday',   '07:30', '09:00'),
    ('Room 1038', 'ITS122P',   'AM2',  'Thursday',  '07:30', '09:00'),
    ('Room 2035', 'PHY10-8',   'AM6',  'Monday',    '13:30', '16:30'),
    ('Room 2039', 'PHY10-8L',  'AM3',  'Saturday',  '12:00', '16:30'),
    ('Room 3031', 'PCC150',    'BM11', 'Monday',    '16:30', '18:00'),
    ('Room 3031', 'PCC150',    'BM11', 'Wednesday', '16:30', '18:00'),
    ('Room 4018', 'CSS125P',   'AM3',  'Tuesday',   '12:00', '13:30'),
    ('Room 4018', 'CSS125P',   'AM3',  'Thursday',  '12:00', '13:30'),
    ('Room 4018', 'CSS125P',   'AM3',  'Wednesday', '12:00', '16:30'),
    ('Room 4029', 'CSS142P',   'AM5',  'Tuesday',   '15:00', '16:30'),
    ('Room 4029', 'CSS142P',   'AM5',  'Thursday',  '15:00', '16:30'),
    ('Room 4029', 'CSS142P',   'AM5',  'Saturday',  '07:30', '12:00'),
    ('Room 4031', 'CSS182-02', 'AM3',  'Wednesday', '07:30', '10:30')
) AS v(room_name, course_code, section, day_of_week, start_time, end_time)
JOIN Rooms r ON r.name = v.room_name
-- Guard: only seed when a semester is actually configured.
WHERE EXISTS (SELECT 1 FROM system_settings WHERE setting_key = 'semester_start' AND setting_value <> '')
  AND EXISTS (SELECT 1 FROM system_settings WHERE setting_key = 'semester_end'   AND setting_value <> '');

-- Check: expect 14 rows across 8 rooms, all stamped with the configured semester.
SELECT count(*) AS seeded FROM ClassSchedules;
SELECT r.name, cs.course_code, cs.section, cs.day_of_week, cs.start_time, cs.end_time,
       cs.semester_start, cs.semester_end
  FROM ClassSchedules cs JOIN Rooms r ON r.room_id = cs.room_id
 ORDER BY r.name, cs.day_of_week, cs.start_time;
