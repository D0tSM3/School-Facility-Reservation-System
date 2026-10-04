-- CampusRoom: Archival mechanism for deletions (PostgreSQL / Supabase).
--
-- All deleted records (class schedules, holidays, reservations, rooms)
-- are stored in archived_records with an automated 30-day retention window.
--

CREATE TABLE IF NOT EXISTS archived_records (
    archive_id     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name     VARCHAR(64)  NOT NULL,
    record_id      VARCHAR(128) NOT NULL,
    record_summary VARCHAR(255) NOT NULL,
    record_data    JSONB        NOT NULL,
    reason         TEXT         NULL,
    archived_by    UUID         NULL REFERENCES users(user_id) ON DELETE SET NULL,
    archived_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    purge_at       TIMESTAMP    NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '30 days')
);

CREATE INDEX IF NOT EXISTS idx_archived_records_table ON archived_records(table_name);
CREATE INDEX IF NOT EXISTS idx_archived_records_purge ON archived_records(purge_at);
CREATE INDEX IF NOT EXISTS idx_archived_records_archived_at ON archived_records(archived_at DESC);
