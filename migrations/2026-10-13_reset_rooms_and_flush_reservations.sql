-- CampusRoom: reset the room directory to the 5-floor (0–4) building plan,
-- flush the legacy reservation + class-schedule data, and DROP the retired
-- move/override workflow tables. Clean slate, hard delete, no archive.
-- (PostgreSQL / Supabase.)
--
-- ⚠️ BACK UP THE DATABASE BEFORE RUNNING. This permanently deletes rows and does
--    NOT populate archived_records (archiving only happens in app code).
--
-- ROOM COUNT: 24, not 25. The supplied CSV contains 24 rooms (floor 4 has 7,
--    not 8). No 8th floor-4 room exists in the source data, so none is invented.
--    If a 25th room is real, add one INSERT row with its name/type/capacity.
--
-- FOREIGN-KEY BEHAVIOUR (verified against the live schema):
--   Into Reservations (ON DELETE CASCADE): ReservationCancellationRequests,
--     ConflictOverrideRequests.conflicting_reservation_id, system_logs rows.
--     (created_reservation_id is ON DELETE SET NULL.)
--   Live tables confirmed present: Rooms, Reservations, ClassSchedules,
--     ReservationMoveRequests, ConflictOverrideRequests,
--     ReservationCancellationRequests. (ReservationCancelRequests and a
--     separate ReservationLogs table do NOT exist in this database.)
--   Into Rooms (ON DELETE CASCADE / SET NULL): Reservations, ClassSchedules,
--     ConflictOverrideRequests.room_id.
--   So deleting Rooms would cascade to Reservations and ClassSchedules anyway;
--   this script still clears them explicitly first, in dependency order, so the
--   intent is obvious and the result deterministic regardless of cascade config.
--
-- One transaction: it all commits, or nothing changes.

BEGIN;

-- =========================================================================
-- SECTION A — Retire the approval/move/override tables, then flush legacy
--             reservations and class schedules. Hard delete; nothing archived.
-- =========================================================================

-- Drop the two retired workflow tables entirely (no code reads or writes them
-- any more; the confirmation slip's move-history display was also removed).
-- Order matters: ConflictOverrideRequests has a FK (move_request_id) to
-- ReservationMoveRequests, so it must be dropped first.
DROP TABLE IF EXISTS ConflictOverrideRequests;
DROP TABLE IF EXISTS ReservationMoveRequests;

-- Remaining request rows that reference reservations.
DELETE FROM ReservationCancellationRequests;

-- Reservations (cascades to system_logs rows and any remaining linked rows).
DELETE FROM Reservations;

-- Class schedules tied to the rooms being replaced (recreated afterwards).
DELETE FROM ClassSchedules;

-- =========================================================================
-- SECTION B — Replace the room directory with the 24-room, 5-floor plan.
--   Floors 0–4; all Available / active; direct booking → requires_approval
--   is false for every room (approval workflow is retired, incl. Room 1038).
-- =========================================================================
DELETE FROM Rooms;

INSERT INTO Rooms (room_id, name, floor, room_type, capacity, status, is_active, requires_approval) VALUES
  (gen_random_uuid(), 'Room 0018', 0, 'Studio',       36,  'Available', true, false),
  (gen_random_uuid(), 'Room 0027', 0, 'Lecture Hall', 483, 'Available', true, false),
  (gen_random_uuid(), 'Room 0035', 0, 'Studio',       232, 'Available', true, false),
  (gen_random_uuid(), 'Room 0036', 0, 'Conference',   24,  'Available', true, false),
  (gen_random_uuid(), 'Room 1025', 1, 'Lecture Hall', 483, 'Available', true, false),
  (gen_random_uuid(), 'Room 1035', 1, 'Studio',       56,  'Available', true, false),
  (gen_random_uuid(), 'Room 1038', 1, 'Studio',       40,  'Available', true, false),
  (gen_random_uuid(), 'Room 2018', 2, 'Lecture Hall', 44,  'Available', true, false),
  (gen_random_uuid(), 'Room 2025', 2, 'Conference',   24,  'Available', true, false),
  (gen_random_uuid(), 'Room 2035', 2, 'Lecture Hall', 187, 'Available', true, false),
  (gen_random_uuid(), 'Room 2036', 2, 'Studio',       40,  'Available', true, false),
  (gen_random_uuid(), 'Room 2039', 2, 'Studio',       72,  'Available', true, false),
  (gen_random_uuid(), 'Room 3018', 3, 'Lecture Hall', 44,  'Available', true, false),
  (gen_random_uuid(), 'Room 3025', 3, 'Lecture Hall', 80,  'Available', true, false),
  (gen_random_uuid(), 'Room 3031', 3, 'Lecture Hall', 174, 'Available', true, false),
  (gen_random_uuid(), 'Room 3038', 3, 'Studio',       40,  'Available', true, false),
  (gen_random_uuid(), 'Room 3039', 3, 'Lecture Hall', 300, 'Available', true, false),
  (gen_random_uuid(), 'Room 4018', 4, 'Studio',       36,  'Available', true, false),
  (gen_random_uuid(), 'Room 4025', 4, 'Lecture Hall', 112, 'Available', true, false),
  (gen_random_uuid(), 'Room 4029', 4, 'Studio',       144, 'Available', true, false),
  (gen_random_uuid(), 'Room 4031', 4, 'Studio',       80,  'Available', true, false),
  (gen_random_uuid(), 'Room 4035', 4, 'Studio',       54,  'Available', true, false),
  (gen_random_uuid(), 'Room 4036', 4, 'Studio',       36,  'Available', true, false),
  (gen_random_uuid(), 'Room 4039', 4, 'Lecture Hall', 64,  'Available', true, false);

COMMIT;

-- =========================================================================
-- POST-MIGRATION CHECKS — run after COMMIT and eyeball the results.
-- =========================================================================
-- Expect 24.
SELECT count(*) AS total_rooms FROM Rooms;

-- Expect floors 0,1,2,3,4 with counts 4,3,5,5,7.
SELECT floor, count(*) AS rooms FROM Rooms GROUP BY floor ORDER BY floor;

-- Expect ZERO rows: no floor outside 0–4 may remain (this was the 607 bug).
SELECT room_id, name, floor FROM Rooms WHERE floor < 0 OR floor > 4;

-- Full directory: names, capacities, statuses, approval flag (all false).
SELECT name, floor, room_type, capacity, status, is_active, requires_approval
FROM Rooms ORDER BY floor, name;

-- Expect 0 for all: the flush is complete.
SELECT
  (SELECT count(*) FROM Reservations)                    AS reservations,
  (SELECT count(*) FROM ReservationCancellationRequests) AS cancel_requests,
  (SELECT count(*) FROM ClassSchedules)                  AS class_schedules;

-- Expect both false: the retired tables are gone.
SELECT to_regclass('public.conflictoverriderequests') IS NOT NULL AS override_table_exists,
       to_regclass('public.reservationmoverequests')   IS NOT NULL AS move_table_exists;
