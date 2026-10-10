-- Read-only reconciliation report for the current roster and Customer accounts.
SELECT 'current_roster_without_user' AS issue,
       directory.school_id,
       directory.email
  FROM public.school_directory AS directory
 WHERE directory.is_current IS TRUE
   AND NOT EXISTS (
       SELECT 1
         FROM public.users AS account
        WHERE account.school_id = directory.school_id
           OR lower(account.email) = lower(directory.email)
   )

UNION ALL

SELECT 'customer_without_current_roster' AS issue,
       account.school_id,
       account.email
  FROM public.users AS account
 WHERE account.role = 'Customer'
   AND NOT EXISTS (
       SELECT 1
         FROM public.school_directory AS directory
        WHERE directory.school_id = account.school_id
          AND directory.is_current IS TRUE
   )
 ORDER BY issue, school_id, email;
