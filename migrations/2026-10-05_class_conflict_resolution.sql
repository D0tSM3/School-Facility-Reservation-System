-- CampusRoom: class-conflict request slips + relocate/reschedule resolution
-- (PostgreSQL / Supabase). Run this in the Supabase SQL editor.
--
-- WHAT THIS ADDS
--   1. A conflict override (request slip) may now be filed against an official
--      CLASS SCHEDULE, not only another customer's reservation. On approval,
--      staff resolve it by relocating the class to another room and/or
--      rescheduling its weekday/time so the requested slot is freed, then the
--      requester's booking is created.
--   2. A reservation move proposed by staff may now also RELOCATE the
--      conflicting booking to a different room (new_room_id), not only
--      reschedule its time.
--
-- SAFE TO RE-RUN: IF NOT EXISTS / conditional guards throughout.

-- 1. ConflictOverrideRequests may point at a class instead of a reservation.
ALTER TABLE ConflictOverrideRequests
    ALTER COLUMN conflicting_reservation_id DROP NOT NULL;

ALTER TABLE ConflictOverrideRequests
    ADD COLUMN IF NOT EXISTS conflicting_class_id UUID NULL
        REFERENCES ClassSchedules(schedule_id) ON DELETE CASCADE;

-- Exactly one of the two conflict targets must be set.
ALTER TABLE ConflictOverrideRequests
    DROP CONSTRAINT IF EXISTS chk_override_one_conflict;
ALTER TABLE ConflictOverrideRequests
    ADD CONSTRAINT chk_override_one_conflict
        CHECK ((conflicting_reservation_id IS NOT NULL) <> (conflicting_class_id IS NOT NULL));

CREATE INDEX IF NOT EXISTS idx_override_class ON ConflictOverrideRequests (conflicting_class_id);

-- 2. A staff-proposed reservation move may relocate the booking's room too.
ALTER TABLE ReservationMoveRequests
    ADD COLUMN IF NOT EXISTS new_room_id UUID NULL
        REFERENCES Rooms(room_id) ON DELETE SET NULL;
