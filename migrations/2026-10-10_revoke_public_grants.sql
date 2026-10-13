-- Remove direct table access for Supabase API roles in the public schema.
-- ALTER DEFAULT PRIVILEGES applies to objects created by the role executing
-- this statement; repeat it for any other role that creates public tables.

BEGIN;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;

COMMIT;
