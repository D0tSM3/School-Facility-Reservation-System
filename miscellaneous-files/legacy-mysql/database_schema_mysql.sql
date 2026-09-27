-- CampusRoom Reservation System - MySQL Database Schema
-- Converted from PostgreSQL (Supabase) to MySQL (XAMPP)

-- Drop in reverse dependency order
DROP TABLE IF EXISTS ReservationCancellationRequests;
DROP TABLE IF EXISTS ReservationMoveRequests;
DROP TABLE IF EXISTS System_Logs;
DROP TABLE IF EXISTS Reservations;
DROP TABLE IF EXISTS ClassSchedules;
DROP TABLE IF EXISTS Holidays;
DROP TABLE IF EXISTS Rooms;
DROP TABLE IF EXISTS Users;

-- 1. Users Table
CREATE TABLE Users (
    user_id        CHAR(36)     NOT NULL PRIMARY KEY DEFAULT (UUID()),
    name           VARCHAR(150) NOT NULL,
    email          VARCHAR(255) NOT NULL UNIQUE,
    password_hash  VARCHAR(255) NOT NULL,
    role           ENUM('Admin','Staff','Customer') NOT NULL DEFAULT 'Customer',
    is_verified    TINYINT(1)   NOT NULL DEFAULT 0,
    otp_code       VARCHAR(6)   NULL,
    otp_expires_at DATETIME     NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Rooms Table
CREATE TABLE Rooms (
    room_id    CHAR(36)     NOT NULL PRIMARY KEY DEFAULT (UUID()),
    name       VARCHAR(100) NOT NULL UNIQUE,
    floor      INT          NULL,
    room_type  VARCHAR(50)  NULL,
    capacity   INT          NOT NULL CHECK (capacity > 0),
    is_active  TINYINT(1)   NOT NULL DEFAULT 1,
    status     ENUM('Available','Maintenance') NOT NULL DEFAULT 'Available',
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Reservations Table
CREATE TABLE Reservations (
    reservation_id     CHAR(36)     NOT NULL PRIMARY KEY DEFAULT (UUID()),
    customer_id        CHAR(36)     NOT NULL,
    room_id            CHAR(36)     NOT NULL,
    purpose            VARCHAR(255) NOT NULL,
    -- Section 2: the booking's category. Promoted out of a text prefix inside
    -- `purpose`, so it can be filtered and reported on rather than parsed.
    category           ENUM('Academic Lecture','Faculty Defense','Student Org Meeting','Dept Workshop','Exam/Quiz')
                       NOT NULL DEFAULT 'Academic Lecture',
    equipment_notes    VARCHAR(500) NULL DEFAULT NULL,
    start_time         DATETIME     NOT NULL,
    end_time           DATETIME     NOT NULL,
    status             ENUM('Pending','Approved','Rejected','Cancelled','Completed') NOT NULL DEFAULT 'Pending',
    -- 1 once the customer "removes" the booking from My Reservations. A soft
    -- hide: staff, the calendar and the audit log still see the row.
    customer_hidden    TINYINT(1)   NOT NULL DEFAULT 0,
    processed_by       CHAR(36)     NULL DEFAULT NULL,
    processed_at       DATETIME     NULL DEFAULT NULL,
    cancellation_reason VARCHAR(500) NULL DEFAULT NULL,
    cancelled_by       CHAR(36)     NULL DEFAULT NULL,
    created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_valid_time   CHECK (end_time > start_time),
    CONSTRAINT fk_res_customer  FOREIGN KEY (customer_id)  REFERENCES Users(user_id) ON DELETE CASCADE,
    CONSTRAINT fk_res_room      FOREIGN KEY (room_id)      REFERENCES Rooms(room_id) ON DELETE CASCADE,
    CONSTRAINT fk_res_processor FOREIGN KEY (processed_by) REFERENCES Users(user_id) ON DELETE SET NULL,
    CONSTRAINT fk_res_cancelled_by FOREIGN KEY (cancelled_by) REFERENCES Users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. System_Logs Table
CREATE TABLE System_Logs (
    log_id         CHAR(36)     NOT NULL PRIMARY KEY DEFAULT (UUID()),
    user_id        CHAR(36)     NULL DEFAULT NULL,
    reservation_id CHAR(36)     NULL DEFAULT NULL,
    action_type    VARCHAR(255) NOT NULL,
    timestamp      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_log_user        FOREIGN KEY (user_id)        REFERENCES Users(user_id) ON DELETE CASCADE,
    CONSTRAINT fk_log_reservation FOREIGN KEY (reservation_id) REFERENCES Reservations(reservation_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. ClassSchedules Table
CREATE TABLE ClassSchedules (
    schedule_id CHAR(36)    NOT NULL PRIMARY KEY DEFAULT (UUID()),
    room_id     CHAR(36)    NOT NULL,
    course_code VARCHAR(50) NOT NULL,
    section     VARCHAR(20) NOT NULL,
    day_of_week ENUM('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday') NOT NULL,
    start_time  TIME        NOT NULL,
    end_time    TIME        NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_class_time CHECK (end_time > start_time),
    CONSTRAINT fk_class_room  FOREIGN KEY (room_id) REFERENCES Rooms(room_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. Holidays Table
CREATE TABLE Holidays (
    holiday_date DATE         NOT NULL PRIMARY KEY,
    name         VARCHAR(150) NOT NULL,
    type         ENUM('Regular','Special Non-Working') NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. ReservationMoveRequests Table
CREATE TABLE ReservationMoveRequests (
    request_id           CHAR(36)   NOT NULL PRIMARY KEY DEFAULT (UUID()),
    reservation_id       CHAR(36)   NOT NULL,
    requested_start_time DATETIME   NOT NULL,
    requested_end_time   DATETIME   NOT NULL,
    status               ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
    staff_comment        VARCHAR(500) NULL,
    processed_by         CHAR(36)   NULL,
    created_at           TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_move_time       CHECK (requested_end_time > requested_start_time),
    CONSTRAINT fk_move_reservation FOREIGN KEY (reservation_id) REFERENCES Reservations(reservation_id) ON DELETE CASCADE,
    CONSTRAINT fk_move_processor   FOREIGN KEY (processed_by)   REFERENCES Users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7b. ReservationCancellationRequests Table
-- An Approved booking cannot be cancelled by its customer directly; they file
-- one of these and staff decide. Approving it is what sets the booking to
-- Cancelled.
CREATE TABLE ReservationCancellationRequests (
    request_id     CHAR(36)     NOT NULL PRIMARY KEY DEFAULT (UUID()),
    reservation_id CHAR(36)     NOT NULL,
    reason         VARCHAR(500) NOT NULL,
    status         ENUM('Pending','Approved','Rejected') NOT NULL DEFAULT 'Pending',
    staff_comment  VARCHAR(500) NULL DEFAULT NULL,
    processed_by   CHAR(36)     NULL DEFAULT NULL,
    created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cancel_reservation FOREIGN KEY (reservation_id) REFERENCES Reservations(reservation_id) ON DELETE CASCADE,
    CONSTRAINT fk_cancel_processor   FOREIGN KEY (processed_by)   REFERENCES Users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. Indexes for the application's hot queries
CREATE INDEX idx_res_customer_created ON Reservations (customer_id, created_at DESC);
CREATE INDEX idx_res_created          ON Reservations (created_at DESC);
CREATE INDEX idx_res_room_time        ON Reservations (room_id, start_time, end_time);
CREATE INDEX idx_res_status           ON Reservations (status);
CREATE INDEX idx_logs_timestamp       ON System_Logs (timestamp DESC);
CREATE INDEX idx_logs_reservation     ON System_Logs (reservation_id, timestamp DESC);
CREATE INDEX idx_class_room_day       ON ClassSchedules (room_id, day_of_week);
CREATE INDEX idx_move_reservation     ON ReservationMoveRequests (reservation_id, created_at DESC);
CREATE INDEX idx_res_customer_hidden  ON Reservations (customer_id, customer_hidden);
CREATE INDEX idx_cancelreq_reservation ON ReservationCancellationRequests (reservation_id, created_at DESC);
CREATE INDEX idx_cancelreq_status      ON ReservationCancellationRequests (status);

-- 9. Concurrency Control: Overlap-Prevention Triggers
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



-- CampusRoom seed data. Run AFTER database_schema_mysql.sql.
-- All accounts use the password: password123

SET FOREIGN_KEY_CHECKS = 0;
DELETE FROM ReservationMoveRequests;
DELETE FROM System_Logs;
DELETE FROM Reservations;
DELETE FROM ClassSchedules;
DELETE FROM Holidays;
DELETE FROM Rooms;
DELETE FROM Users;
SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- 1. Users
-- ============================================================
INSERT INTO Users (user_id, name, email, password_hash, role, is_verified, created_at) VALUES
('11111111-1111-4111-8111-111111111111', 'Dr. Amelia Concepcion', 'admin@bpu.edu.ph',
 '$2y$10$2n02Zl514J8X.MYWmU8rw.3i7SvVjQPJtZ6VAX8KktOCL6fJWaTUS', 'Admin', 1, '2026-01-06 08:00:00'),
('22222222-2222-4222-8222-222222222222', 'Marianne Lin', 'staff@bpu.edu.ph',
 '$2y$10$2n02Zl514J8X.MYWmU8rw.3i7SvVjQPJtZ6VAX8KktOCL6fJWaTUS', 'Staff', 1, '2026-01-06 08:05:00'),
('33333333-3333-4333-8333-333333333333', 'Joselito Ramos', 'staff2@bpu.edu.ph',
 '$2y$10$2n02Zl514J8X.MYWmU8rw.3i7SvVjQPJtZ6VAX8KktOCL6fJWaTUS', 'Staff', 1, '2026-01-06 08:06:00'),
('44444444-4444-4444-8444-444444444444', 'Dr. Edgardo Valderama', 'customer@bpu.edu.ph',
 '$2y$10$2n02Zl514J8X.MYWmU8rw.3i7SvVjQPJtZ6VAX8KktOCL6fJWaTUS', 'Customer', 1, '2026-01-07 09:12:00'),
('55555555-5555-4555-8555-555555555555', 'Prof. Nerissa Bautista', 'nbautista@bpu.edu.ph',
 '$2y$10$2n02Zl514J8X.MYWmU8rw.3i7SvVjQPJtZ6VAX8KktOCL6fJWaTUS', 'Customer', 1, '2026-01-09 14:30:00'),
('66666666-6666-4666-8666-666666666666', 'Kenneth Ocampo', 'kocampo@bpu.edu.ph',
 '$2y$10$2n02Zl514J8X.MYWmU8rw.3i7SvVjQPJtZ6VAX8KktOCL6fJWaTUS', 'Customer', 1, '2026-02-02 11:00:00'),
-- Unverified on purpose: exercises the OTP branch in AuthController::login()
('77777777-7777-4777-8777-777777777777', 'Trixie Sandoval', 'unverified@bpu.edu.ph',
 '$2y$10$2n02Zl514J8X.MYWmU8rw.3i7SvVjQPJtZ6VAX8KktOCL6fJWaTUS', 'Customer', 0, '2026-09-15 16:45:00');

-- ============================================================
-- 2. Rooms
-- ============================================================
INSERT INTO Rooms (room_id, name, floor, room_type, capacity, is_active, status, created_at) VALUES
('a0000001-0000-4000-8000-000000000001', 'Lecture Hall 301',        3, 'Lecture Hall', 120, 1, 'Available',   '2026-01-05 08:00:00'),
('a0000002-0000-4000-8000-000000000002', 'Computer Laboratory 204', 2, 'Laboratory',    40, 1, 'Available',   '2026-01-05 08:00:00'),
('a0000003-0000-4000-8000-000000000003', 'Audio-Visual Room 105',   1, 'AVR',           80, 1, 'Available',   '2026-01-05 08:00:00'),
('a0000004-0000-4000-8000-000000000004', 'University Gymnasium',    1, 'Gymnasium',    600, 1, 'Available',   '2026-01-05 08:00:00'),
('a0000005-0000-4000-8000-000000000005', 'Seminar Room 402',        4, 'Seminar Room',  30, 1, 'Available',   '2026-01-05 08:00:00'),
('a0000006-0000-4000-8000-000000000006', 'Science Laboratory 208',  2, 'Laboratory',    35, 1, 'Available',   '2026-01-05 08:00:00'),
('a0000007-0000-4000-8000-000000000007', 'Conference Room 501',     5, 'Conference',    20, 1, 'Available',   '2026-01-05 08:00:00'),
('a0000008-0000-4000-8000-000000000008', 'Drawing Studio 306',      3, 'Studio',        45, 1, 'Available',   '2026-01-05 08:00:00'),
-- Under maintenance: renders the MAINTENANCE badge + banner on the staff queue
('a0000009-0000-4000-8000-000000000009', 'Multimedia Room 207',     2, 'AVR',           60, 1, 'Maintenance', '2026-01-05 08:00:00'),
-- Decommissioned: must NOT appear in GET /api/rooms (is_active = 0)
('a000000a-0000-4000-8000-00000000000a', 'Old Annex Hall 001',      0, 'Lecture Hall',  90, 0, 'Available',   '2026-01-05 08:00:00');

-- ============================================================
-- 3. ClassSchedules  (recurring blocks the validator checks against)
-- ============================================================
INSERT INTO ClassSchedules (schedule_id, room_id, course_code, section, day_of_week, start_time, end_time) VALUES
('c0000001-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000001', 'GEED-101', 'BSIT-1A', 'Monday',    '10:00:00', '12:00:00'),
('c0000002-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-000000000001', 'HIST-201', 'BSED-2B', 'Tuesday',   '13:00:00', '15:00:00'),
('c0000003-0000-4000-8000-000000000003', 'a0000002-0000-4000-8000-000000000002', 'CCS-105',  'BSCS-1A', 'Monday',    '07:30:00', '09:30:00'),
('c0000004-0000-4000-8000-000000000004', 'a0000002-0000-4000-8000-000000000002', 'CCS-210',  'BSCS-2A', 'Wednesday', '08:00:00', '10:00:00'),
('c0000005-0000-4000-8000-000000000005', 'a0000003-0000-4000-8000-000000000003', 'COMM-150', 'BACOM-1', 'Thursday',  '13:00:00', '15:00:00'),
('c0000006-0000-4000-8000-000000000006', 'a0000003-0000-4000-8000-000000000003', 'COMM-250', 'BACOM-2', 'Friday',    '08:00:00', '10:00:00'),
('c0000007-0000-4000-8000-000000000007', 'a0000006-0000-4000-8000-000000000006', 'CHEM-101', 'BSBIO-1', 'Tuesday',   '08:00:00', '11:00:00');

-- ============================================================
-- 4. Holidays  (validator rejects bookings on these dates)
-- ============================================================
INSERT INTO Holidays (holiday_date, name, type) VALUES
('2026-11-01', 'All Saints Day',                 'Special Non-Working'),
('2026-11-02', 'All Souls Day',                  'Special Non-Working'),
('2026-11-30', 'Bonifacio Day',                  'Regular'),
('2026-12-08', 'Feast of the Immaculate Conception', 'Special Non-Working'),
('2026-12-24', 'Christmas Eve',                  'Special Non-Working'),
('2026-12-25', 'Christmas Day',                  'Regular'),
('2026-12-30', 'Rizal Day',                      'Regular'),
('2026-12-31', 'Last Day of the Year',           'Special Non-Working');

-- ============================================================
-- 5. Reservations
-- Layout note: no two Pending/Approved rows overlap within a room,
-- or prevent_double_booking_insert will abort this script.
-- 2026-09-21 Mon .. 2026-09-26 Sat are the "upcoming" week.
-- ============================================================
INSERT INTO Reservations (reservation_id, customer_id, room_id, purpose, start_time, end_time, status, processed_by, created_at) VALUES
-- Upcoming, Approved
('e0000001-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'a0000001-0000-4000-8000-000000000001',
 'CCS Department Orientation',        '2026-09-21 08:00:00', '2026-09-21 10:00:00', 'Approved',
 '22222222-2222-4222-8222-222222222222', '2026-09-14 10:22:00'),
('e0000004-0000-4000-8000-000000000004', '55555555-5555-4555-8555-555555555555', 'a0000002-0000-4000-8000-000000000002',
 'Python Remedial Session',           '2026-09-21 10:00:00', '2026-09-21 12:00:00', 'Approved',
 '22222222-2222-4222-8222-222222222222', '2026-09-14 11:05:00'),
('e0000006-0000-4000-8000-000000000006', '44444444-4444-4444-8444-444444444444', 'a0000003-0000-4000-8000-000000000003',
 'Thesis Defense Panel A',            '2026-09-24 08:00:00', '2026-09-24 11:00:00', 'Approved',
 '33333333-3333-4333-8333-333333333333', '2026-09-15 09:40:00'),
('e0000008-0000-4000-8000-000000000008', '66666666-6666-4666-8666-666666666666', 'a0000004-0000-4000-8000-000000000004',
 'Intramurals Opening Rehearsal',     '2026-09-26 08:00:00', '2026-09-26 12:00:00', 'Approved',
 '22222222-2222-4222-8222-222222222222', '2026-09-16 13:15:00'),
-- Upcoming, Pending  (these are what the staff dispatch queue shows)
('e0000002-0000-4000-8000-000000000002', '55555555-5555-4555-8555-555555555555', 'a0000001-0000-4000-8000-000000000001',
 'Faculty Curriculum Review',         '2026-09-21 13:00:00', '2026-09-21 15:00:00', 'Pending', NULL, '2026-09-17 08:30:00'),
('e0000003-0000-4000-8000-000000000003', '66666666-6666-4666-8666-666666666666', 'a0000001-0000-4000-8000-000000000001',
 'Student Council General Assembly',  '2026-09-22 09:00:00', '2026-09-22 11:00:00', 'Pending', NULL, '2026-09-17 14:02:00'),
('e0000005-0000-4000-8000-000000000005', '44444444-4444-4444-8444-444444444444', 'a0000002-0000-4000-8000-000000000002',
 'Capstone Hardware Testing',         '2026-09-23 14:00:00', '2026-09-23 16:00:00', 'Pending', NULL, '2026-09-18 09:47:00'),
('e0000007-0000-4000-8000-000000000007', '55555555-5555-4555-8555-555555555555', 'a0000003-0000-4000-8000-000000000003',
 'Film Screening — Media Studies',    '2026-09-25 13:00:00', '2026-09-25 17:00:00', 'Pending', NULL, '2026-09-18 16:20:00'),
-- History
('e0000009-0000-4000-8000-000000000009', '44444444-4444-4444-8444-444444444444', 'a0000001-0000-4000-8000-000000000001',
 'Midterm Proctoring Briefing',       '2026-09-08 09:00:00', '2026-09-08 11:00:00', 'Completed',
 '22222222-2222-4222-8222-222222222222', '2026-09-01 10:00:00'),
('e000000a-0000-4000-8000-00000000000a', '55555555-5555-4555-8555-555555555555', 'a0000002-0000-4000-8000-000000000002',
 'Database Practicum Makeup',         '2026-09-09 13:00:00', '2026-09-09 15:00:00', 'Completed',
 '33333333-3333-4333-8333-333333333333', '2026-09-02 15:30:00'),
('e000000b-0000-4000-8000-00000000000b', '66666666-6666-4666-8666-666666666666', 'a0000003-0000-4000-8000-000000000003',
 'Fraternity Recruitment Talk',       '2026-09-10 10:00:00', '2026-09-10 12:00:00', 'Rejected',
 '22222222-2222-4222-8222-222222222222', '2026-09-03 08:45:00'),
('e000000c-0000-4000-8000-00000000000c', '44444444-4444-4444-8444-444444444444', 'a0000001-0000-4000-8000-000000000001',
 'Cancelled Dept Meeting',            '2026-09-11 15:00:00', '2026-09-11 17:00:00', 'Cancelled',
 '44444444-4444-4444-8444-444444444444', '2026-09-04 12:00:00'),
('e000000d-0000-4000-8000-00000000000d', '44444444-4444-4444-8444-444444444444', 'a0000005-0000-4000-8000-000000000005',
 'Accreditation Dry Run',             '2026-09-14 08:00:00', '2026-09-14 10:00:00', 'Completed',
 '22222222-2222-4222-8222-222222222222', '2026-09-07 09:00:00'),
('e000000e-0000-4000-8000-00000000000e', '66666666-6666-4666-8666-666666666666', 'a0000004-0000-4000-8000-000000000004',
 'Basketball Varsity Tryouts',        '2026-09-15 16:00:00', '2026-09-15 18:00:00', 'Rejected',
 '33333333-3333-4333-8333-333333333333', '2026-09-08 07:30:00');

-- ============================================================
-- 6. ReservationMoveRequests
-- ============================================================
INSERT INTO ReservationMoveRequests (request_id, reservation_id, requested_start_time, requested_end_time, status, staff_comment, processed_by, created_at) VALUES
-- Pending + APPROVABLE: 2026-09-22 (Tue) 15:30-17:30 in Lecture Hall 301.
-- Room is free then, and the Tuesday class in that room ends at 15:00.
('b0000001-0000-4000-8000-000000000001', 'e0000002-0000-4000-8000-000000000002',
 '2026-09-22 15:30:00', '2026-09-22 17:30:00', 'Pending', NULL, NULL, '2026-09-18 10:10:00'),
-- Pending + MUST FAIL VALIDATION: collides with CCS-210, Wed 08:00-10:00, Computer Lab 204.
-- Approving this should return 409 with the class-collision message.
('b0000002-0000-4000-8000-000000000002', 'e0000005-0000-4000-8000-000000000005',
 '2026-09-23 08:30:00', '2026-09-23 10:00:00', 'Pending', NULL, NULL, '2026-09-18 11:55:00'),
-- Historical, resolved
('b0000003-0000-4000-8000-000000000003', 'e0000006-0000-4000-8000-000000000006',
 '2026-09-24 08:00:00', '2026-09-24 11:00:00', 'Approved', 'Approved. AVR technician confirmed availability.',
 '22222222-2222-4222-8222-222222222222', '2026-09-15 08:00:00'),
('b0000004-0000-4000-8000-000000000004', 'e000000b-0000-4000-8000-00000000000b',
 '2026-09-10 14:00:00', '2026-09-10 16:00:00', 'Rejected', 'Rejected — the requested window conflicts with a scheduled class.',
 '33333333-3333-4333-8333-333333333333', '2026-09-05 09:00:00');

-- ============================================================
-- 7. System_Logs
-- NOTE: reservation_id is populated here, but ReservationRepository::insertLog()
-- does NOT write it today. Fix that in Section 8 or new logs will have NULLs.
-- ============================================================
INSERT INTO System_Logs (log_id, user_id, reservation_id, action_type, timestamp) VALUES
('d0000001-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'e0000001-0000-4000-8000-000000000001', 'Reservation submitted by customer',                      '2026-09-14 10:22:00'),
('d0000002-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222', 'e0000001-0000-4000-8000-000000000001', 'Reservation status changed to Approved',                  '2026-09-14 15:40:00'),
('d0000003-0000-4000-8000-000000000003', '55555555-5555-4555-8555-555555555555', 'e0000004-0000-4000-8000-000000000004', 'Reservation submitted by customer',                      '2026-09-14 11:05:00'),
('d0000004-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', 'e0000004-0000-4000-8000-000000000004', 'Reservation status changed to Approved',                  '2026-09-14 16:02:00'),
('d0000005-0000-4000-8000-000000000005', '66666666-6666-4666-8666-666666666666', 'e000000b-0000-4000-8000-00000000000b', 'Reservation submitted by customer',                      '2026-09-03 08:45:00'),
('d0000006-0000-4000-8000-000000000006', '22222222-2222-4222-8222-222222222222', 'e000000b-0000-4000-8000-00000000000b', 'Reservation status changed to Rejected',                  '2026-09-03 13:10:00'),
('d0000007-0000-4000-8000-000000000007', '44444444-4444-4444-8444-444444444444', 'e000000c-0000-4000-8000-00000000000c', 'Reservation cancelled by customer',                       '2026-09-05 07:55:00'),
('d0000008-0000-4000-8000-000000000008', '44444444-4444-4444-8444-444444444444', 'e0000006-0000-4000-8000-000000000006', 'Move request submitted for reservation',                  '2026-09-15 07:30:00'),
('d0000009-0000-4000-8000-000000000009', '22222222-2222-4222-8222-222222222222', 'e0000006-0000-4000-8000-000000000006', 'Move request Approved',                                   '2026-09-15 08:00:00'),
('d000000a-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', NULL,                                    'Admin flagged Multimedia Room 207 for maintenance',       '2026-09-16 09:00:00'),
('d000000b-0000-4000-8000-00000000000b', '11111111-1111-4111-8111-111111111111', NULL,                                    'Admin changed role of user Joselito Ramos to Staff',      '2026-01-06 08:10:00'),
('d000000c-0000-4000-8000-00000000000c', '33333333-3333-4333-8333-333333333333', 'e000000e-0000-4000-8000-00000000000e', 'Reservation status changed to Rejected',                  '2026-09-09 10:12:00');