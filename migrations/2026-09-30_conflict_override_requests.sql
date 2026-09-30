-- CampusRoom: conflict override (urgent) requests (PostgreSQL / Supabase).
--
-- WHAT THIS ADDS
--   ConflictOverrideRequests — a customer whose wanted slot is blocked only by
--   someone else's Approved booking can ask staff to override it, with a
--   reason. Staff approve (the blocking booking gets a move request and the
--   new booking is created as Pending) or reject (with an optional comment).
--
-- Translated from the MySQL spec: CHAR(36) -> UUID, UUID() ->
-- gen_random_uuid(), ENUM -> the existing request_status /
-- reservation_category enum types, DATETIME -> TIMESTAMP, no ENGINE clause.
-- purpose / category / equipment_notes are added beyond the spec: approving
-- creates a Reservations row, and those columns are required there.
--
-- start_time / end_time follow POST /api/reservations: the DATES are the
-- range and the CLOCKS the daily window. 2026-10-01 09:00 -> 2026-10-03 12:00
-- means 09:00-12:00 on Oct 1, 2 and 3. Same date = one day.
--
-- SAFE TO RE-RUN: IF NOT EXISTS throughout. Run it in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS ConflictOverrideRequests (
    request_id                 UUID                 NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
    requested_by               UUID                 NOT NULL,
    room_id                    UUID                 NOT NULL,
    start_time                 TIMESTAMP            NOT NULL,
    end_time                   TIMESTAMP            NOT NULL,
    purpose                    VARCHAR(255)         NOT NULL,
    category                   reservation_category NOT NULL,
    equipment_notes            VARCHAR(500)         NULL,
    reason                     VARCHAR(500)         NOT NULL,
    conflicting_reservation_id UUID                 NOT NULL,
    status                     request_status       NOT NULL DEFAULT 'Pending',
    staff_comment              VARCHAR(500)         NULL,
    processed_by               UUID                 NULL,
    processed_at               TIMESTAMP            NULL,
    created_at                 TIMESTAMP            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_override_range     CHECK (end_time > start_time),
    CONSTRAINT fk_override_user       FOREIGN KEY (requested_by)               REFERENCES Users(user_id)               ON DELETE CASCADE,
    CONSTRAINT fk_override_room       FOREIGN KEY (room_id)                    REFERENCES Rooms(room_id)               ON DELETE CASCADE,
    CONSTRAINT fk_override_conflict   FOREIGN KEY (conflicting_reservation_id) REFERENCES Reservations(reservation_id) ON DELETE CASCADE,
    CONSTRAINT fk_override_processor  FOREIGN KEY (processed_by)               REFERENCES Users(user_id)               ON DELETE SET NULL
);

-- Staff queue (Pending first), the customer's own list, and "is there already
-- an open request against this booking?".
CREATE INDEX IF NOT EXISTS idx_override_status    ON ConflictOverrideRequests (status, created_at);
CREATE INDEX IF NOT EXISTS idx_override_requester ON ConflictOverrideRequests (requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_override_conflict  ON ConflictOverrideRequests (conflicting_reservation_id);

-- Resolution tracking. The DB trigger forbids two overlapping Pending/Approved
-- bookings, so the override's booking can't exist while the conflicting one
-- still holds the slot. Approving therefore runs as a chain:
--   1. staff approve the override -> a move request is filed on the
--      conflicting booking (move_request_id); outcome = 'Awaiting move'
--   2. staff approve that move     -> the slot is free, the requester's
--      reservation is created as Pending (created_reservation_id);
--      outcome = 'Booked' (or 'Booking failed' + outcome_note if something
--      else took the slot meanwhile)
--      staff reject that move      -> outcome = 'Move rejected'
ALTER TABLE ConflictOverrideRequests
    ADD COLUMN IF NOT EXISTS move_request_id        UUID         NULL REFERENCES ReservationMoveRequests(request_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS created_reservation_id UUID         NULL REFERENCES Reservations(reservation_id)       ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS outcome                VARCHAR(20)  NULL,
    ADD COLUMN IF NOT EXISTS outcome_note           VARCHAR(500) NULL;

CREATE INDEX IF NOT EXISTS idx_override_move ON ConflictOverrideRequests (move_request_id);

-- Why a move was proposed, shown to the booking's holder. NULL for moves the
-- customer asked for themselves.
ALTER TABLE ReservationMoveRequests
    ADD COLUMN IF NOT EXISTS reason VARCHAR(500) NULL;
