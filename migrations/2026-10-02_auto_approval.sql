-- CampusRoom: auto-approval for straightforward bookings (PostgreSQL / Supabase).
--
-- WHAT THIS ADDS
--   Reservations.approval_type — records HOW a booking reached its status, so
--   Staff and Admin can tell an automatic approval from one a human made.
--     'auto'    — submitted with zero conflicts and inside policy, approved
--                 immediately without ever entering the Staff queue.
--     'manual'  — the default; the booking waited for a Staff decision
--                 (also used for conflict-override bookings and long ranges).
--     'special' — the room carries requires_approval, so it skipped
--                 auto-approval on purpose (see 2026-10-02_special_approval.sql).
--
-- No existing row is changed: everything already in the table keeps the
-- 'manual' default, which is accurate — those bookings were all decided the
-- old way.
--
-- SAFE TO RE-RUN: IF NOT EXISTS. Run it in the Supabase SQL editor (or it is
-- applied directly during development).

ALTER TABLE Reservations
    ADD COLUMN IF NOT EXISTS approval_type VARCHAR(20) NOT NULL DEFAULT 'manual';
