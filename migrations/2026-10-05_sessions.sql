-- CampusRoom: database-backed PHP sessions (PostgreSQL / Supabase).
-- Run this in the Supabase SQL editor.
--
-- WHY: on serverless hosts (Vercel) each request runs in a fresh container, so
-- PHP's default filesystem session store (/tmp) is wiped between requests and
-- users are logged out immediately after signing in. Storing the session here
-- — the same move we made for the OTP code — makes login persist. Local XAMPP
-- keeps using filesystem sessions; this table is only used when SESSION_DRIVER
-- is 'db' or the app detects it is running on Vercel.
--
-- SAFE TO RE-RUN: IF NOT EXISTS throughout.

CREATE TABLE IF NOT EXISTS Sessions (
    session_id   VARCHAR(190)  NOT NULL PRIMARY KEY,
    data         TEXT          NOT NULL DEFAULT '',
    last_active  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Lets garbage collection drop idle sessions efficiently.
CREATE INDEX IF NOT EXISTS idx_sessions_last_active ON Sessions (last_active);
