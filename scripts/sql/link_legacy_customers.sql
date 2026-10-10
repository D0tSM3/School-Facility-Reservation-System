-- Review-only backfill. Do not run until the matched rows are reviewed.
-- It links existing unlinked Customer accounts to a current roster entry
-- only when the email uniquely matches; it does not activate or change roles.
UPDATE public.users AS account
   SET school_id = directory.school_id,
       activated_at = COALESCE(account.activated_at, CURRENT_TIMESTAMP)
  FROM public.school_directory AS directory
 WHERE account.role = 'Customer'
   AND account.school_id IS NULL
   AND directory.is_current IS TRUE
   AND lower(account.email) = lower(directory.email);
