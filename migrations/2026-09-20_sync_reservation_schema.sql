-- CampusRoom: bring an existing database up to what the code expects.
--
-- WHY: databases created before the "equipment / cancellation / audit" work
-- lack columns that ReservationRepository reads and writes, so creating,
-- approving, cancelling or logging a reservation fails with a 500
-- ("Unknown column ...").  database_schema_mysql.sql already has most of
-- these, but running it DROPS every table, so use THIS file on a database
-- that holds real data.
--
-- SAFE TO RE-RUN: purely additive, every step is guarded with IF NOT EXISTS
-- (MariaDB 10.x / XAMPP syntax).  No rows are changed or deleted.
--
--   mysql -uroot campusroom < migrations/2026-09-20_sync_reservation_schema.sql

-- Reservations: columns the repository selects/updates.
ALTER TABLE Reservations
    ADD COLUMN IF NOT EXISTS equipment_notes     VARCHAR(500) NULL DEFAULT NULL AFTER purpose,
    ADD COLUMN IF NOT EXISTS processed_at        DATETIME     NULL DEFAULT NULL AFTER processed_by,
    ADD COLUMN IF NOT EXISTS cancellation_reason VARCHAR(500) NULL DEFAULT NULL AFTER processed_at,
    ADD COLUMN IF NOT EXISTS cancelled_by        CHAR(36)     NULL DEFAULT NULL AFTER cancellation_reason;

ALTER TABLE Reservations
    ADD FOREIGN KEY IF NOT EXISTS fk_res_cancelled_by (cancelled_by)
        REFERENCES Users(user_id) ON DELETE SET NULL;

-- System_Logs: per-booking audit trail (ReservationRepository::insertLog).
ALTER TABLE System_Logs
    ADD COLUMN IF NOT EXISTS reservation_id CHAR(36) NULL DEFAULT NULL AFTER user_id;

ALTER TABLE System_Logs
    ADD FOREIGN KEY IF NOT EXISTS fk_log_reservation (reservation_id)
        REFERENCES Reservations(reservation_id) ON DELETE CASCADE;

-- Overlap triggers: replace with the versions in database_schema_mysql.sql.
-- The update trigger now only re-checks when the room, the time range or the
-- status actually changes, and only for Pending/Approved rows, so cancelling
-- or completing a booking can never be blocked by an unrelated overlap.
-- Overlap rule (half-open ranges, so 09:00-10:30 and 10:30-12:00 do NOT clash):
--     NEW.start_time < existing.end_time  AND  NEW.end_time > existing.start_time
DROP TRIGGER IF EXISTS prevent_double_booking_insert;
DELIMITER $$
CREATE TRIGGER prevent_double_booking_insert
BEFORE INSERT ON Reservations
FOR EACH ROW
BEGIN
    IF NEW.status IN ('Pending', 'Approved') AND EXISTS (
        SELECT 1 FROM Reservations
         WHERE room_id = NEW.room_id
           AND status IN ('Pending', 'Approved')
           AND (NEW.start_time < end_time AND NEW.end_time > start_time)
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Scheduling Collision: Room is already booked or pending during this time window.';
    END IF;
END$$
DELIMITER ;

DROP TRIGGER IF EXISTS prevent_double_booking_update;
DELIMITER $$
CREATE TRIGGER prevent_double_booking_update
BEFORE UPDATE ON Reservations
FOR EACH ROW
BEGIN
    IF NEW.status IN ('Pending', 'Approved')
       AND (NEW.room_id    <> OLD.room_id
         OR NEW.start_time <> OLD.start_time
         OR NEW.end_time   <> OLD.end_time
         OR NEW.status     <> OLD.status)
       AND EXISTS (
        SELECT 1 FROM Reservations
         WHERE room_id = NEW.room_id
           AND status IN ('Pending', 'Approved')
           AND reservation_id != NEW.reservation_id
           AND (NEW.start_time < end_time AND NEW.end_time > start_time)
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Scheduling Collision: Room is already booked or pending during this time window.';
    END IF;
END$$
DELIMITER ;
