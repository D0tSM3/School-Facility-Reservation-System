-- Manual rollback for 2026-10-10_activation.sql.
-- Review first and take a backup. Dropping activated_at, purpose, or
-- invalidated_at discards values written since the migration was applied.
-- This does not restore pre-migration grants; restore ACLs from the backup
-- or your recorded grants rather than guessing them.

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP INDEX IF EXISTS public.activation_otps_one_active_uq;
DROP INDEX IF EXISTS public.activation_otps_school_created_idx;
DROP INDEX IF EXISTS public.school_directory_email_lower_uq;
DROP INDEX IF EXISTS public.users_email_lower_uq;

ALTER TABLE public.activation_otps
  DROP COLUMN IF EXISTS invalidated_at,
  DROP COLUMN IF EXISTS purpose;

ALTER TABLE public.users
  DROP COLUMN IF EXISTS activated_at;

COMMIT;
