-- Manual rollback for 2026-10-14_visitor_days.sql.
-- Review first and back up visitor summaries before dropping this table.

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP TABLE IF EXISTS public.visitor_days;

COMMIT;
