-- CampusRoom: roster-gated activation (diff against live Supabase, 2026-10-10).
--
-- READ-ONLY RECON (do not re-run as part of this file):
--   * public has 16 tables, all lowercase unquoted names (users, not "Users").
--   * RLS is already ON for all 16; pg_policies is empty (no policies).
--   * school_directory and activation_otps already exist (0 rows).
--   * users already has school_id (UNIQUE, FK to school_directory) and is_active.
--   * Duplicate lower(email) on users: 0 rows — safe to add the unique index.
--
-- THIS FILE ADDS ONLY WHAT IS MISSING. It does not drop columns, shrink types,
-- or rewrite existing unique constraints on email / school_id.
-- DO NOT RUN until approved. Take a backup / use a Supabase branch first.
--
-- Follow-up (NOT in this file): 002_drop_legacy_otp.sql remains a draft and
-- must not drop users.otp_code / otp_expires_at while login 2FA uses them.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. School roster ----------------------------------------------------------------
-- Live already has this table. Kept for empty clones.
CREATE TABLE IF NOT EXISTS public.school_directory (
  school_id    varchar(64)  PRIMARY KEY,
  full_name    varchar(200) NOT NULL,
  email        varchar(254) NOT NULL,
  person_type  varchar(32)  NOT NULL,
  is_current   boolean      NOT NULL DEFAULT true,
  synced_at    timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Live unique is on email as stored (school_directory_email_key).
-- Plan requires case-insensitive uniqueness as well.
CREATE UNIQUE INDEX IF NOT EXISTS school_directory_email_lower_uq
  ON public.school_directory (lower(email));

-- 2. OTP storage ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activation_otps (
  otp_id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       varchar(64) NOT NULL REFERENCES public.school_directory(school_id),
  purpose         varchar(32) NOT NULL DEFAULT 'activation',
  code_hash       char(64)    NOT NULL,
  expires_at      timestamp   NOT NULL,
  attempts        integer     NOT NULL DEFAULT 0,
  used_at         timestamp,
  invalidated_at  timestamp,
  created_at      timestamp   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Live table is missing these two columns (and the supporting index).
ALTER TABLE public.activation_otps
  ADD COLUMN IF NOT EXISTS purpose        varchar(32) NOT NULL DEFAULT 'activation',
  ADD COLUMN IF NOT EXISTS invalidated_at timestamp;

CREATE INDEX IF NOT EXISTS activation_otps_school_created_idx
  ON public.activation_otps (school_id, created_at DESC);

-- The service invalidates the current row before inserting its replacement,
-- in the same transaction; this index enforces that invariant under races.
CREATE UNIQUE INDEX IF NOT EXISTS activation_otps_one_active_uq
  ON public.activation_otps (school_id, purpose)
  WHERE used_at IS NULL AND invalidated_at IS NULL;

-- 3. users: activated_at only -----------------------------------------------------
-- school_id and is_active already exist (UNIQUE + FK, NOT NULL DEFAULT true).
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS activated_at timestamp;

-- Case-insensitive email uniqueness. Existing users_email_key (exact email) stays.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq
  ON public.users (lower(email));

-- 4. Lock new tables away from Supabase auto REST ---------------------------------
-- RLS is already enabled on the live DB; these are idempotent.
ALTER TABLE public.school_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activation_otps  ENABLE ROW LEVEL SECURITY;
-- No policies on purpose. Table owner (postgres / PDO) bypasses RLS.
-- Leftover live grants: anon/authenticated still have REFERENCES, TRIGGER, TRUNCATE.
REVOKE ALL ON public.school_directory FROM anon, authenticated;
REVOKE ALL ON public.activation_otps  FROM anon, authenticated;

COMMIT;
