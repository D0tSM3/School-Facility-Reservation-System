-- CampusRoom: combined migration run.
-- Runs, in the only order that is safe given their dependencies:
--   1. 2026-09-20_sync_reservation_schema.sql
--   2. 2026-09-20_reservation_category.sql
--   3. 2026-09-20_customer_remove_and_cancel_requests.sql
--   4. 2026-09-20_rename_cancellation_requests.sql
--
-- Each file is independently safe to re-run (IF NOT EXISTS / rename-detection
-- guards), so re-running this whole combined script is also safe.
--
-- BEFORE running this: back up your database from a terminal, not from inside
-- this SQL file --
--   mysqldump -uroot campusroom > campusroom_backup.sql
--
-- TO RUN:
--   mysql -uroot campusroom < migrations/run_all_migrations.sql
-- or, in phpMyAdmin: select the campusroom database, Import tab, choose this file.


-- ============================================================
-- 1. 2026-09-20_sync_reservation_schema.sql
-- ============================================================
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

-- ============================================================
-- 2. 2026-09-20_reservation_category.sql
-- ============================================================
-- CampusRoom: promote the reservation category out of the purpose text.
-- Business Rules Revision 2, Section 2 + Schema impact.
--
-- BEFORE: the booking form wrote the category into `purpose` as a string
--         prefix — "Student Org Meeting: weekly assembly" — so the category
--         could only be recovered by parsing text, and a requester who happened
--         to type that prefix themselves was indistinguishable from the real
--         thing.
-- AFTER:  `category` is a real ENUM column. `purpose` holds only the
--         requester's own description.
--
-- NOTE ON THE ENUM VALUE 'Exam/Quiz': the old text prefix was "Exam / Quiz"
-- (spaces around the slash); the column value is "Exam/Quiz" per the rules
-- doc. The backfill below maps the old spelling onto the new value.
--
-- The backfill is a ONE-TIME data fix. Re-running this file is harmless for
-- normal data: rows are only touched while they still carry a prefix, and the
-- strip removes it. (A requester who literally types "Academic Lecture: " at
-- the start of a description would have it stripped on a second run — worth
-- knowing, not worth guarding for a file that runs once.)
--
--   mysql -uroot campusroom < migrations/2026-09-20_reservation_category.sql

-- 1. The column -------------------------------------------------------------
ALTER TABLE Reservations
    ADD COLUMN IF NOT EXISTS category
        ENUM('Academic Lecture','Faculty Defense','Student Org Meeting','Dept Workshop','Exam/Quiz')
        NOT NULL DEFAULT 'Academic Lecture' AFTER purpose;

-- 2. Backfill from the old prefix, pass 1: set the category ------------------
UPDATE Reservations SET category = 'Academic Lecture'   WHERE purpose LIKE 'Academic Lecture: %';
UPDATE Reservations SET category = 'Faculty Defense'    WHERE purpose LIKE 'Faculty Defense: %';
UPDATE Reservations SET category = 'Student Org Meeting' WHERE purpose LIKE 'Student Org Meeting: %';
UPDATE Reservations SET category = 'Dept Workshop'      WHERE purpose LIKE 'Dept Workshop: %';
UPDATE Reservations SET category = 'Exam/Quiz'          WHERE purpose LIKE 'Exam / Quiz: %';
UPDATE Reservations SET category = 'Exam/Quiz'          WHERE purpose LIKE 'Exam/Quiz: %';

-- 3. Backfill pass 2: strip the prefix off `purpose` -------------------------
-- Guarded so a purpose that is ONLY a prefix never becomes the empty string
-- (the column is NOT NULL and an empty purpose would fail the API's own
-- "purpose is required" rule on any later edit).
UPDATE Reservations
   SET purpose = TRIM(SUBSTRING(purpose, CHAR_LENGTH('Academic Lecture') + 3))
 WHERE purpose LIKE 'Academic Lecture: %'
   AND TRIM(SUBSTRING(purpose, CHAR_LENGTH('Academic Lecture') + 3)) <> '';

UPDATE Reservations
   SET purpose = TRIM(SUBSTRING(purpose, CHAR_LENGTH('Faculty Defense') + 3))
 WHERE purpose LIKE 'Faculty Defense: %'
   AND TRIM(SUBSTRING(purpose, CHAR_LENGTH('Faculty Defense') + 3)) <> '';

UPDATE Reservations
   SET purpose = TRIM(SUBSTRING(purpose, CHAR_LENGTH('Student Org Meeting') + 3))
 WHERE purpose LIKE 'Student Org Meeting: %'
   AND TRIM(SUBSTRING(purpose, CHAR_LENGTH('Student Org Meeting') + 3)) <> '';

UPDATE Reservations
   SET purpose = TRIM(SUBSTRING(purpose, CHAR_LENGTH('Dept Workshop') + 3))
 WHERE purpose LIKE 'Dept Workshop: %'
   AND TRIM(SUBSTRING(purpose, CHAR_LENGTH('Dept Workshop') + 3)) <> '';

UPDATE Reservations
   SET purpose = TRIM(SUBSTRING(purpose, CHAR_LENGTH('Exam / Quiz') + 3))
 WHERE purpose LIKE 'Exam / Quiz: %'
   AND TRIM(SUBSTRING(purpose, CHAR_LENGTH('Exam / Quiz') + 3)) <> '';

UPDATE Reservations
   SET purpose = TRIM(SUBSTRING(purpose, CHAR_LENGTH('Exam/Quiz') + 3))
 WHERE purpose LIKE 'Exam/Quiz: %'
   AND TRIM(SUBSTRING(purpose, CHAR_LENGTH('Exam/Quiz') + 3)) <> '';

-- 4. Retire requestor_type ---------------------------------------------------
-- Revision 2 replaces the two-value Individual/Student-Organization field with
-- the five-value category above. This is a no-op unless the earlier plan's
-- column was actually created.
ALTER TABLE Reservations DROP COLUMN IF EXISTS requestor_type;

-- ============================================================
-- 3. 2026-09-20_customer_remove_and_cancel_requests.sql
-- ============================================================
-- CampusRoom: customer-side "Remove" + cancellation requests for approved bookings.
--
-- WHAT THIS ADDS
--   1. Reservations.customer_hidden — the soft "Remove". The customer's list
--      stops showing the booking; staff, the calendar and the audit log are
--      unaffected. Nothing is ever deleted, so a removed booking can still be
--      explained later ("who withdrew this request, and when?").
--   2. ReservationCancelRequests — an approved booking can no longer be
--      cancelled by the customer directly. They file a request with a reason,
--      staff approve or reject it, and approving is what cancels the booking.
--      Modelled on ReservationMoveRequests, which already works this way.
--
-- SAFE TO RE-RUN: purely additive and guarded with IF NOT EXISTS. No rows are
-- changed or deleted.
--
--   mysql -uroot campusroom < migrations/2026-09-20_customer_remove_and_cancel_requests.sql
--
-- Run 2026-09-20_sync_reservation_schema.sql first if you have not already.

-- 1. Soft remove -------------------------------------------------------------
-- 0 = visible in My Reservations, 1 = the customer removed it from their list.
ALTER TABLE Reservations
    ADD COLUMN IF NOT EXISTS customer_hidden TINYINT(1) NOT NULL DEFAULT 0 AFTER status;

-- findByCustomer() filters on (customer_id, customer_hidden) every page load.
CREATE INDEX IF NOT EXISTS idx_res_customer_hidden
    ON Reservations (customer_id, customer_hidden);

-- 2. Cancellation requests ---------------------------------------------------
CREATE TABLE IF NOT EXISTS ReservationCancelRequests (
    request_id     CHAR(36)     NOT NULL PRIMARY KEY DEFAULT (UUID()),
    reservation_id CHAR(36)     NOT NULL,
    reason         VARCHAR(500) NOT NULL,
    status         ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
    staff_comment  VARCHAR(500) NULL DEFAULT NULL,
    processed_by   CHAR(36)     NULL DEFAULT NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cancelreq_reservation FOREIGN KEY (reservation_id)
        REFERENCES Reservations(reservation_id) ON DELETE CASCADE,
    CONSTRAINT fk_cancelreq_processor   FOREIGN KEY (processed_by)
        REFERENCES Users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- "latest request for this booking" (customer badge) and the staff queue.
CREATE INDEX IF NOT EXISTS idx_cancelreq_reservation
    ON ReservationCancelRequests (reservation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cancelreq_status
    ON ReservationCancelRequests (status);

-- ============================================================
-- 4. 2026-09-20_rename_cancellation_requests.sql
-- ============================================================
-- CampusRoom: align the cancellation-request table name with Business Rules
-- Revision 2 ("ReservationCancellationRequests").
--
-- The table was built earlier in this project as `ReservationCancelRequests`
-- with an IDENTICAL column set, so this RENAMES it rather than creating a
-- second table — a create would have orphaned the requests already filed.
-- The FK constraint names are brought in line at the same time.
--
-- SAFE TO RE-RUN, and safe on a fresh database. Each step is guarded against
-- information_schema, so the file handles all three starting points:
--   (a) old name present   -> renamed
--   (b) new name present   -> left alone
--   (c) neither present    -> created
--
--   mysql -uroot campusroom < migrations/2026-09-20_rename_cancellation_requests.sql

-- 1. Rename, only when the old table exists and the new one does not ---------
SET @have_old := (SELECT COUNT(*) FROM information_schema.TABLES
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ReservationCancelRequests');
SET @have_new := (SELECT COUNT(*) FROM information_schema.TABLES
                   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ReservationCancellationRequests');

SET @sql := IF(@have_old = 1 AND @have_new = 0,
               'RENAME TABLE ReservationCancelRequests TO ReservationCancellationRequests',
               'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Fresh install: create it if neither name was present --------------------
CREATE TABLE IF NOT EXISTS ReservationCancellationRequests (
    request_id     CHAR(36)     NOT NULL PRIMARY KEY DEFAULT (UUID()),
    reservation_id CHAR(36)     NOT NULL,
    reason         VARCHAR(500) NOT NULL,
    status         ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
    staff_comment  VARCHAR(500) NULL DEFAULT NULL,
    processed_by   CHAR(36)     NULL DEFAULT NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cancel_reservation FOREIGN KEY (reservation_id)
        REFERENCES Reservations(reservation_id) ON DELETE CASCADE,
    CONSTRAINT fk_cancel_processor   FOREIGN KEY (processed_by)
        REFERENCES Users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Bring the carried-over FK constraint names in line ----------------------
SET @old_fk1 := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                  WHERE CONSTRAINT_SCHEMA = DATABASE()
                    AND TABLE_NAME = 'ReservationCancellationRequests'
                    AND CONSTRAINT_NAME = 'fk_cancelreq_reservation');
SET @sql := IF(@old_fk1 = 1,
               'ALTER TABLE ReservationCancellationRequests
                  DROP FOREIGN KEY fk_cancelreq_reservation,
                  ADD CONSTRAINT fk_cancel_reservation FOREIGN KEY (reservation_id)
                      REFERENCES Reservations(reservation_id) ON DELETE CASCADE',
               'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @old_fk2 := (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
                  WHERE CONSTRAINT_SCHEMA = DATABASE()
                    AND TABLE_NAME = 'ReservationCancellationRequests'
                    AND CONSTRAINT_NAME = 'fk_cancelreq_processor');
SET @sql := IF(@old_fk2 = 1,
               'ALTER TABLE ReservationCancellationRequests
                  DROP FOREIGN KEY fk_cancelreq_processor,
                  ADD CONSTRAINT fk_cancel_processor FOREIGN KEY (processed_by)
                      REFERENCES Users(user_id) ON DELETE SET NULL',
               'DO 0');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. Indexes (names carry over on RENAME; created here for a fresh install) --
CREATE INDEX IF NOT EXISTS idx_cancelreq_reservation
    ON ReservationCancellationRequests (reservation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cancelreq_status
    ON ReservationCancellationRequests (status);
