-- ===========================================================================
-- CampusRoom — exact-duplicate protection for class schedules.
-- SEPARATE, HUMAN-REVIEW migration. DO NOT auto-execute against production.
-- PostgreSQL 17.x (live is 17.6). ADDITIVE: creates one index, changes no rows.
--
-- WHAT IT DOES
--   Prevents inserting an EXACT-duplicate class block: same room, weekday,
--   start, end AND semester window. A unique B-tree stops exact duplicates only
--   -- it does NOT stop two different-but-overlapping intervals. Overlapping
--   intervals stay enforced by the application inside the advisory-locked
--   transaction (ReservationRepository::lockRooms + ClassScheduleController),
--   which is where weekly recurrence + the semester window are understood.
--
-- NULLS NOT DISTINCT: a legacy row with NULL semester bounds must still collide
--   with another identical legacy row (default B-tree treats NULLs as distinct,
--   which would let exact legacy duplicates through). Requires PostgreSQL 15+.
-- ===========================================================================

-- 1) STOP if exact duplicates already exist -- the unique index would fail to
--    build and this tells you which rows to reconcile first. Review the output;
--    if it returns rows, resolve them before running step 2.
SELECT room_id, day_of_week, start_time, end_time, semester_start, semester_end,
       count(*) AS copies
  FROM classschedules
 GROUP BY room_id, day_of_week, start_time, end_time, semester_start, semester_end
HAVING count(*) > 1
 ORDER BY copies DESC;

-- 2) Create the index only when step 1 returned no rows.
--    CONCURRENTLY avoids locking the table for writers; it cannot run inside a
--    transaction block, so run this statement on its own (not wrapped in BEGIN).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_classschedules_identity
    ON classschedules (room_id, day_of_week, start_time, end_time,
                       semester_start, semester_end)
    NULLS NOT DISTINCT;

-- 3) Verify.
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE tablename = 'classschedules'
   AND indexname = 'uq_classschedules_identity';
