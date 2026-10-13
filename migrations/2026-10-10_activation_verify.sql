-- Run manually after applying 2026-10-10_activation.sql.

-- Expected columns introduced/required by activation.
SELECT expected.table_name,
       expected.column_name,
       EXISTS (
         SELECT 1
           FROM information_schema.columns actual
          WHERE actual.table_schema = 'public'
            AND actual.table_name = expected.table_name
            AND actual.column_name = expected.column_name
       ) AS present
  FROM (VALUES
         ('users', 'school_id'),
         ('users', 'is_active'),
         ('users', 'activated_at'),
         ('activation_otps', 'purpose'),
         ('activation_otps', 'invalidated_at')
       ) AS expected(table_name, column_name)
 ORDER BY expected.table_name, expected.column_name;

-- Indexes added or required by the activation migration.
SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND indexname IN (
     'school_directory_email_lower_uq',
     'activation_otps_school_created_idx',
     'activation_otps_one_active_uq',
     'users_email_lower_uq'
   )
 ORDER BY indexname;

-- Overall and activation-state counts for users.
SELECT COUNT(*) AS total_users,
       COUNT(*) FILTER (WHERE is_active IS TRUE) AS active_users,
       COUNT(*) FILTER (WHERE is_active IS FALSE) AS inactive_users,
       COUNT(*) FILTER (WHERE activated_at IS NOT NULL) AS users_with_activated_at
  FROM public.users;

-- Roster row count.
SELECT COUNT(*) AS school_directory_count
  FROM public.school_directory;
