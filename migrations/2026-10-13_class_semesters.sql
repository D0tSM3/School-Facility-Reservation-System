-- CampusRoom: semester-bound class schedules (PostgreSQL / Supabase).
--
-- WHY
--   Class schedules used to be indefinite weekly recurrences. They are now
--   bound to an academic semester: the Admin configures the current semester's
--   start/end dates (system_settings keys semester_start / semester_end), and
--   every class is stamped with the semester it belongs to when it is created.
--   A class only applies — blocks bookings, shows on the calendar — for dates
--   inside its own [semester_start, semester_end] window, so last term's
--   classes expire automatically without any manual cleanup.
--
-- Columns are nullable so any pre-existing row keeps working (NULL bounds are
-- treated as "always active" by the queries, via COALESCE). Every class created
-- through the app from now on carries non-null bounds.

ALTER TABLE ClassSchedules
    ADD COLUMN IF NOT EXISTS semester_start DATE,
    ADD COLUMN IF NOT EXISTS semester_end   DATE;

-- Helps the per-date window checks in ReservationValidator / availability.
CREATE INDEX IF NOT EXISTS idx_classschedules_semester
    ON ClassSchedules (room_id, day_of_week, semester_start, semester_end);

-- The semester itself lives in system_settings (semester_start / semester_end),
-- created on first save by the Admin — no seed row needed here. Settings.php
-- defaults them to '' (meaning "not configured yet").
