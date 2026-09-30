-- CampusRoom: admin-configurable booking rules (PostgreSQL / Supabase).
--
-- WHAT THIS ADDS
--   system_settings — key/value rows the Admin edits on the System
--   Configuration tab. ReservationValidator reads them instead of the old
--   hardcoded 06:00-21:00 business hours and Sunday closure.
--     business_hours_start  'HH:MM'
--     business_hours_end    'HH:MM'
--     closed_days           comma-separated weekday names, e.g. 'Sunday'
--                           ('' = open every day)
--
-- SAFE TO RE-RUN: IF NOT EXISTS + ON CONFLICT DO NOTHING, so existing values
-- are never overwritten. Run it in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS system_settings (
    setting_key   VARCHAR(50)  NOT NULL PRIMARY KEY,
    setting_value VARCHAR(255) NOT NULL,
    updated_by    UUID         NULL REFERENCES users(user_id) ON DELETE SET NULL,
    updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_settings (setting_key, setting_value) VALUES
    ('business_hours_start', '06:00'),
    ('business_hours_end',   '21:00'),
    ('closed_days',          'Sunday')
ON CONFLICT (setting_key) DO NOTHING;
