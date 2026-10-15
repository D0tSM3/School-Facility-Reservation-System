-- ===========================================================================
-- CampusRoom — Postgres-correct double-booking backstop (OPTIONAL).
-- SEPARATE, HUMAN-REVIEW migration. DO NOT auto-execute against production.
-- PostgreSQL 17.x. Creates a trigger function + two triggers; changes no rows.
--
-- WHY THIS EXISTS
--   migrations/2026-09-20_sync_reservation_schema.sql declares
--   prevent_double_booking_insert/_update in MySQL syntax (DELIMITER, SIGNAL
--   SQLSTATE, procedural BEGIN...END body). That is invalid on PostgreSQL, so
--   those triggers are NOT installed on the live DB -- the app's catch(45000)
--   fallback never fires here. Overlap safety is now enforced in the
--   application inside advisory-locked transactions (the primary guarantee).
--
--   This migration is an OPTIONAL belt-and-suspenders backstop: a database-level
--   guard that raises the SAME SQLSTATE 45000 the application already catches,
--   so a future code path that forgets to lock still cannot double-book. It is
--   NOT required for the advisory-lock protection to work.
--
-- Overlap rule (half-open ranges: 09:00-10:30 and 10:30-12:00 do NOT clash):
--     NEW.start_time < existing.end_time  AND  NEW.end_time > existing.start_time
-- ===========================================================================

CREATE OR REPLACE FUNCTION prevent_double_booking() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status IN ('Pending', 'Approved') AND EXISTS (
        SELECT 1 FROM reservations
         WHERE room_id = NEW.room_id
           AND status IN ('Pending', 'Approved')
           AND reservation_id <> NEW.reservation_id
           AND NEW.start_time < end_time
           AND NEW.end_time   > start_time
    ) THEN
        RAISE EXCEPTION
            'Scheduling Collision: Room is already booked or pending during this time window.'
            USING ERRCODE = '45000';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_double_booking_insert ON reservations;
CREATE TRIGGER prevent_double_booking_insert
    BEFORE INSERT ON reservations
    FOR EACH ROW EXECUTE FUNCTION prevent_double_booking();

-- On UPDATE only re-check when a field that matters to overlap actually changed,
-- so cancelling/completing a booking is never blocked by an unrelated overlap.
DROP TRIGGER IF EXISTS prevent_double_booking_update ON reservations;
CREATE TRIGGER prevent_double_booking_update
    BEFORE UPDATE ON reservations
    FOR EACH ROW
    WHEN (NEW.status IN ('Pending', 'Approved')
          AND (NEW.room_id    IS DISTINCT FROM OLD.room_id
            OR NEW.start_time IS DISTINCT FROM OLD.start_time
            OR NEW.end_time   IS DISTINCT FROM OLD.end_time
            OR NEW.status     IS DISTINCT FROM OLD.status))
    EXECUTE FUNCTION prevent_double_booking();

-- Verify.
SELECT tgname, tgenabled FROM pg_trigger
 WHERE tgrelid = 'reservations'::regclass AND NOT tgisinternal
 ORDER BY tgname;
