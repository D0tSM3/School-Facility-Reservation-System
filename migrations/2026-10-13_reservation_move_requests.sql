-- CampusRoom: create missing ReservationMoveRequests table (PostgreSQL / Supabase).
--
-- This table tracks reservation move (reschedule) requests filed by customers or staff.
-- SAFE TO RE-RUN: guarded by IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS ReservationMoveRequests (
    request_id           UUID PRIMARY KEY,
    reservation_id       UUID NOT NULL REFERENCES Reservations(reservation_id) ON DELETE CASCADE,
    requested_start_time TIMESTAMP NOT NULL,
    requested_end_time   TIMESTAMP NOT NULL,
    reason               VARCHAR(500) NULL,
    status               request_status NOT NULL DEFAULT 'Pending',
    staff_comment        VARCHAR(500) NULL,
    processed_by         UUID NULL REFERENCES Users(user_id) ON DELETE SET NULL,
    created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_move_req_res    ON ReservationMoveRequests (reservation_id);
CREATE INDEX IF NOT EXISTS idx_move_req_status ON ReservationMoveRequests (status);
