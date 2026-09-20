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
