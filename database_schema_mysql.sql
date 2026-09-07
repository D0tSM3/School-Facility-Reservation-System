-- CampusRoom Reservation System — MySQL Database Schema
-- Converted from PostgreSQL (Supabase) to MySQL (XAMPP)
-- Run this in phpMyAdmin or via MySQL CLI after creating the DB.

-- Drop tables in reverse order to respect FK constraints
DROP TABLE IF EXISTS System_Logs;
DROP TABLE IF EXISTS Reservations;
DROP TABLE IF EXISTS Rooms;
DROP TABLE IF EXISTS Users;

-- 1. Users Table
CREATE TABLE Users (
    user_id       CHAR(36)     NOT NULL PRIMARY KEY DEFAULT (UUID()),
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          ENUM('Admin','Staff','Customer') NOT NULL DEFAULT 'Customer',
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Rooms Table
CREATE TABLE Rooms (
    room_id    CHAR(36)     NOT NULL PRIMARY KEY DEFAULT (UUID()),
    name       VARCHAR(100) NOT NULL,
    capacity   INT          NOT NULL CHECK (capacity > 0),
    is_active  TINYINT(1)   NOT NULL DEFAULT 1,
    status     ENUM('Available','Maintenance') NOT NULL DEFAULT 'Available',
    created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Reservations Table
CREATE TABLE Reservations (
    reservation_id CHAR(36)    NOT NULL PRIMARY KEY DEFAULT (UUID()),
    customer_id    CHAR(36)    NOT NULL,
    room_id        CHAR(36)    NOT NULL,
    start_time     DATETIME    NOT NULL,
    end_time       DATETIME    NOT NULL,
    status         ENUM('Pending','Approved','Rejected','Completed') NOT NULL DEFAULT 'Pending',
    processed_by   CHAR(36)    NULL DEFAULT NULL,
    created_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Note: end_time > start_time is enforced by the prevent_double_booking triggers below
    CONSTRAINT fk_res_customer  FOREIGN KEY (customer_id)  REFERENCES Users(user_id) ON DELETE CASCADE,
    CONSTRAINT fk_res_room      FOREIGN KEY (room_id)      REFERENCES Rooms(room_id) ON DELETE CASCADE,
    CONSTRAINT fk_res_processor FOREIGN KEY (processed_by) REFERENCES Users(user_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. System_Logs Table
CREATE TABLE System_Logs (
    log_id      CHAR(36)     NOT NULL PRIMARY KEY DEFAULT (UUID()),
    user_id     CHAR(36)     NULL DEFAULT NULL,
    action_type VARCHAR(255) NOT NULL,
    timestamp   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_log_user FOREIGN KEY (user_id) REFERENCES Users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. Concurrency Control: Overlap-Prevention Triggers (MySQL syntax)
-- MySQL does not support raising exceptions with SQLSTATE directly from triggers,
-- so we signal a custom error (45000) that will bubble up as a PDOException.

DROP TRIGGER IF EXISTS prevent_double_booking_insert;
DELIMITER $$
CREATE TRIGGER prevent_double_booking_insert
BEFORE INSERT ON Reservations
FOR EACH ROW
BEGIN
    IF EXISTS (
        SELECT 1 FROM Reservations
         WHERE room_id = NEW.room_id
           AND status IN ('Pending', 'Approved')
           AND (
               (NEW.start_time >= start_time AND NEW.start_time < end_time) OR
               (NEW.end_time   >  start_time AND NEW.end_time  <= end_time) OR
               (NEW.start_time <= start_time AND NEW.end_time  >= end_time)
           )
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
    IF EXISTS (
        SELECT 1 FROM Reservations
         WHERE room_id = NEW.room_id
           AND status IN ('Pending', 'Approved')
           AND reservation_id != NEW.reservation_id
           AND (
               (NEW.start_time >= start_time AND NEW.start_time < end_time) OR
               (NEW.end_time   >  start_time AND NEW.end_time  <= end_time) OR
               (NEW.start_time <= start_time AND NEW.end_time  >= end_time)
           )
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Scheduling Collision: Room is already booked or pending during this time window.';
    END IF;
END$$
DELIMITER ;
