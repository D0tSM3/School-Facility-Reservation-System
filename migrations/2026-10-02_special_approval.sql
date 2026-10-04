-- CampusRoom: special-approval flag on rooms (PostgreSQL / Supabase).
--
-- WHAT THIS ADDS
--   Rooms.requires_approval — some spaces (auditoriums, specialised labs)
--   should ALWAYS be signed off by Staff, even when they are free and every
--   other rule passes. When this is true, a booking for the room skips
--   auto-approval (2026-10-02_auto_approval.sql) and enters the queue as
--   Pending with approval_type = 'special', so Staff can see WHY it is there.
--
--   Only an Admin can set the flag (RoomController enforces this); the toggle
--   lives next to the status control on the Rooms tab of admin-governance.html.
--
-- No existing row is changed: every current room defaults to false (standard
-- auto-approval behaviour).
--
-- SAFE TO RE-RUN: IF NOT EXISTS. Run it in the Supabase SQL editor (or it is
-- applied directly during development).

ALTER TABLE Rooms
    ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN NOT NULL DEFAULT false;
