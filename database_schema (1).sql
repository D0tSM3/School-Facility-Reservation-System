-- CampusRoom Reservation System — Database Schema
-- Target: PostgreSQL (Supabase-hosted)
-- Revision: adds Rooms.status to support the Live Availability View
-- (Available / Maintenance are stored; "Occupied" is derived at query
-- time from whether an Approved reservation currently covers the
-- requested time window — it is intentionally not a stored value.)

-- 1. Users Table (Strong Entity)
CREATE TABLE Users (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('Admin', 'Staff', 'Customer')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Rooms Table (Strong Entity)
CREATE TABLE Rooms (
    room_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    capacity INT NOT NULL CHECK (capacity > 0),
    is_active BOOLEAN DEFAULT TRUE,
    status VARCHAR(20) NOT NULL DEFAULT 'Available'
        CHECK (status IN ('Available', 'Maintenance')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Reservations Table (Associative Entity)
CREATE TABLE Reservations (
    reservation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES Users(user_id) ON DELETE CASCADE,
    room_id UUID NOT NULL REFERENCES Rooms(room_id) ON DELETE CASCADE,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Completed')),
    processed_by UUID REFERENCES Users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT valid_time_range CHECK (end_time > start_time)
);

-- 4. System_Logs Table (Weak Entity for Audit Trail)
CREATE TABLE System_Logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES Users(user_id) ON DELETE CASCADE,
    action_type VARCHAR(255) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Concurrency Control: Overlap-Prevention Trigger
-- Function to check for overlapping approved/pending reservations
CREATE OR REPLACE FUNCTION check_room_availability()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM Reservations
        WHERE room_id = NEW.room_id
        AND status IN ('Pending', 'Approved')
        AND reservation_id != NEW.reservation_id -- Ignore self on updates
        AND (
            (NEW.start_time >= start_time AND NEW.start_time < end_time) OR
            (NEW.end_time > start_time AND NEW.end_time <= end_time) OR
            (NEW.start_time <= start_time AND NEW.end_time >= end_time)
        )
    ) THEN
        RAISE EXCEPTION 'Scheduling Collision: Room is already booked or pending during this time window.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Bind the trigger to the Reservations table before INSERT or UPDATE
CREATE TRIGGER prevent_double_booking
BEFORE INSERT OR UPDATE ON Reservations
FOR EACH ROW
EXECUTE FUNCTION check_room_availability();
