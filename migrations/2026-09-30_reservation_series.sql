-- CampusRoom: multi-day range bookings (PostgreSQL / Supabase).
--
-- WHAT THIS ADDS
--   Reservations.series_id — links the per-day rows of one multi-day booking.
--   "Oct 1-3, 09:00-12:00" is stored as three ordinary Reservations rows
--   (Oct 1 09:00-12:00, Oct 2 09:00-12:00, Oct 3 09:00-12:00) that share one
--   series_id. Every row is still a single-day range, so the overlap checks,
--   the double-booking trigger and the move/cancel flows work unchanged.
--   Single-day bookings keep series_id NULL.
--
-- SAFE TO RE-RUN: purely additive and guarded with IF NOT EXISTS. No rows are
-- changed or deleted. Run it in the Supabase SQL editor.
--
-- Unlike the 2026-09-20 files (written for the old MySQL/XAMPP database),
-- this one is PostgreSQL.

ALTER TABLE Reservations
    ADD COLUMN IF NOT EXISTS series_id UUID NULL DEFAULT NULL;

-- Series-wide approve/reject and the calendar's grouping look rows up by series.
CREATE INDEX IF NOT EXISTS idx_res_series ON Reservations (series_id);
