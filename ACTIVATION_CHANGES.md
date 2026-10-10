# Activation Rework: Change Documentation

Branch: `feature/activation`. This document records **what was added, changed and removed** when open self-registration was replaced by roster-gated account activation. It does not cover setup of services that already existed (hosting, database, mail provider, captcha).

> **Source of truth:** this list was compiled from the implementation reports. To get the authoritative list, run `git diff main...feature/activation --stat` and `git log --oneline main..feature/activation`.

## 1. Summary of the new behavior

1. A person enters their **8-digit student number**. The first four digits are the year, so `20260123` is valid and a future year is rejected.
2. The server checks the school roster (`school_directory`). The response is the same whether or not a match exists.
3. If the person is eligible and not yet activated, a 6-digit code is emailed to the **address on file** (never one typed by the user).
4. After the code is verified, the page greets the person by name and asks for a password.
5. The account is created in `users` only at that point, with role `Customer`.
6. The person is sent to the login page and signs in with their email or school ID and the new password.

Login still sends an emailed code after the password (the existing second step). It was **not** changed in this work.

## 2. Files

### Added

| File | Purpose |
|---|---|
| `public/activate.html` | Three-stage activation page (identify, verify code, set password) |
| `public/js/activate.js` | Page logic: CSRF handling, captcha, stage switching, error mapping |
| `src/Controller/ActivationController.php` | Endpoints: request, verify, context, complete |
| `src/Repository/ActivationRepository.php` | All activation SQL: roster lookup, OTP issue and verify, account creation |
| `src/Core/PasswordPolicy.php` | Server-side password rules (see section 5) |
| `src/Core/RequestSecurity.php` | CSRF token, Origin check, JSON content-type check |
| `src/Core/Timing.php` | Response-time padding to reduce timing differences |
| `scripts/import_school_directory.php` | CLI importer for the roster CSV |
| `scripts/sql/report_unmatched_users.sql` | Read-only report of existing users not in the roster |
| `scripts/sql/link_legacy_customers.sql` | Links existing customers to roster entries (written, not run) |
| `migrations/2026-10-10_activation.sql` | Schema changes (applied to the live database) |
| `migrations/2026-10-10_activation_verify.sql` | Post-migration checks |
| `migrations/2026-10-10_activation_rollback.sql` | Manual rollback (emergency only) |
| `migrations/2026-10-10_revoke_public_grants.sql` | Removes API-role table permissions (**not applied**) |

### Modified

| File | Change |
|---|---|
| `src/Controller/AuthController.php` | Login: school ID accepted as identifier, one generic failure message, dummy hash for unknown users, exact password tried first then one trimmed fallback with rehash. `forgotPassword`: same response shape for known and unknown emails. Reset uses the new password policy. Old register logic removed |
| `src/Core/Auth.php` | `APP_SECRET` now required (at least 32 characters) for the signed cookie; weaker fallbacks removed. Strict session mode, secure cookies in production |
| `src/Core/RateLimiter.php` | Keys use client IP plus a hashed identifier instead of the session ID. Time math done in SQL. Login lockout longer than 30 seconds. Generic failure responses |
| `src/Core/Mailer.php` | Activation emails added (code, already-active notice, activated notice). Certificate verification on except in development mode |
| `src/Repository/UserRepository.php` | Reads support the new columns |
| `public/index.php` | New routes, generic 500 responses (details logged server-side), `Cache-Control: no-store` on `/api/auth/*` |
| `public/index.html` | Activation success banner; "Register" link now reads "Activate your account" |
| `public/js/auth.js` | Dead register handler removed; CSRF header added |
| `public/verify.html` | CSRF header added |
| `public/.htaccess`, `vercel.json` | `register.html` redirects to `activate.html` |
| `env.example`, `README.md`, `Phase_2_Documentation.md` | Documentation of new variables and flow |

### Removed

| Item | Notes |
|---|---|
| `public/register.html` | Replaced by `activate.html`; old URL redirects |
| `POST /api/auth/register` | Route, controller method and repository method deleted |
| `dev_otp` response field | Removed everywhere |
| `registerPendingUser` | Removed |
| `router.php` | Was a local test helper, not part of the app |

### Local only (gitignored, not deployed)

`.local/` holds test scripts: roster seed, timing harness, session strict-mode test. They read secrets from the environment and contain none.

## 3. API endpoints

| Method and path | Purpose | Notes |
|---|---|---|
| `GET /api/auth/csrf` | Returns a CSRF token tied to the session | Required for the calls below |
| `GET /api/auth/config` | Returns public page configuration (captcha) | |
| `POST /api/auth/activate/request` | Starts activation | Fields include `student_id` and the captcha token. Always returns the same generic message |
| `POST /api/auth/activate/verify` | Checks the emailed code | Generic failure for wrong, expired, used or unknown |
| `GET /api/auth/activate/context` | Returns the person's name | Only after a verified code |
| `POST /api/auth/activate/complete` | Sets the password and creates the account | Does not log the person in |

Exact field names are in `ActivationController.php`.

## 4. Database changes

All additive. Nothing was dropped.

| Table | Change |
|---|---|
| `activation_otps` | Added `purpose`, `invalidated_at`. Index on `(school_id, created_at DESC)`. Unique partial index allowing **one active code per person and purpose** |
| `users` | Added `activated_at`. Unique index on `lower(email)` |
| `school_directory` | Unique index on `lower(email)` |
| both new tables | Row-level security on, public API roles revoked |

Already existed before this work: `school_directory`, `activation_otps`, and `users.school_id` and `users.is_active`. The old `users.otp_code`, `otp_expires_at` and `is_verified` columns are still in place because login uses them.

## 5. Security controls

| Control | Detail |
|---|---|
| No account enumeration | Same status, body and padded timing for unknown, eligible, activated and inactive IDs |
| Codes | 6 digits, random, stored as hashes (see limitations), single use, expire in 10 minutes at most, 5 wrong guesses per code |
| Session gate | The password step works only after a verified code, with a time limit and single use |
| Name privacy | The person's name is shown only after code verification |
| Password rules | 15 to 128 Unicode code points, no composition rules, rejects edge whitespace, repetitive/sequential values, personal information and common passwords, then checks breach data with HIBP k-anonymity (fails open after 2 seconds); Argon2id hashing occurs only after validation |
| Account creation | One transaction. Role always `Customer`. Name and email come from the roster. Duplicate attempts handled |
| Rate limits | By IP and hashed identifier, for requests, code checks, activation and login |
| CSRF | Token plus Origin check plus JSON content-type check on auth endpoints |
| Signed cookie | Requires its own `APP_SECRET`. The app refuses to start in production without it |
| Error handling | Unexpected errors return a generic 500 and are logged server-side |
| Mail | TLS verification on except in development mode |

## 6. Configuration variables

Your local `.env` uses these variables. Only two of them are new with this work.

### New with this work

| Variable | Purpose | Format |
|---|---|---|
| `APP_SECRET` | Signs the session cookie. **Required**: the app refuses to start without it | At least 32 characters, 64 hex recommended. Generate with `php -r "echo bin2hex(random_bytes(32));"`. Use a different value in each environment |
| `TEST_OTP_EMAIL` | Read only by the local test scripts in `.local/` | An email address. **Local only, never set in production** |

### Already existed (unchanged)

`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `APP_TIMEZONE`, `ALLOWED_EMAIL_DOMAIN`, `RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET_KEY`, `RECAPTCHA_ENABLED`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.

`ALLOWED_EMAIL_DOMAIN` now also limits roster emails and login. `RECAPTCHA_ENABLED=true` means the captcha is checked on activation, and the key must list the domain you use.

### Optional (not set in your setup)

Some reports mentioned `APP_ORIGIN`, code-lifetime and attempt limits, and password length limits. None of them is in your `.env` and the page loads without them, so the code either uses its own defaults or does not read them (confirm during the full activation test). Do not add any of them unless the code needs it. To check a name before setting it:
```
Select-String -Path src\*\*.php,public\index.php,env.example -Pattern "getenv|_ENV\[" | Select-Object -ExpandProperty Line
```

### Production rules

- Set a **new** `APP_SECRET` in the host's environment. Never reuse the local one.
- Do not set `TEST_OTP_EMAIL`.
- Keep `RECAPTCHA_ENABLED=true`, and add the production domain to the captcha key's allowed domains.
- Redeploy after changing any variable. Changing `APP_SECRET` signs everyone out.
- If the activation page fails on the production domain with a 403 on its first request, the origin check is rejecting the request. Check the code for how it determines the allowed origin before adding any variable.

## 7. Operations introduced

**Roster import.** The CSV needs the columns `school_id, full_name, email, person_type`. Run it locally against the target database:
```
php scripts/import_school_directory.php roster.csv --dry-run
php scripts/import_school_directory.php roster.csv
```
Rules: invalid rows are rejected and reported. Emails outside `ALLOWED_EMAIL_DOMAIN` are rejected. People missing from the file are marked not current, and their customer accounts are deactivated. An import that would deactivate more than 20% of current people aborts unless `--force` is given. The first import, into an empty roster, skips that check. The CSV stays outside the repository.

**Legacy customers.** Run `report_unmatched_users.sql` to see existing accounts that match no roster entry. `link_legacy_customers.sql` links matching ones and must be reviewed before running. Admin and Staff accounts are never touched.

**Test data convention.** Test roster IDs are `20269997` to `20269999`. Remove them with the cleanup order below, since the account points at the roster row:
```sql
DELETE FROM public.users WHERE school_id IN ('20269999','20269998','20269997');
DELETE FROM public.activation_otps WHERE school_id IN ('20269999','20269998','20269997');
DELETE FROM public.school_directory WHERE school_id IN ('20269999','20269998','20269997');
DELETE FROM public.auth_rate_limits WHERE rate_key LIKE 'activate%';
```

## 8. Verification log (fill in)

| Check | Result |
|---|---|
| Migration applied, columns and indexes present | Done (confirmed in Supabase) |
| Page loads and gets a CSRF token | Done (after setting `APP_SECRET`) |
| Full activation, then login | [ ] |
| Wrong code gives a generic error | [ ] |
| Weak and edge-space passwords rejected | [ ] |
| Unknown ID looks the same as a real one | [ ] |
| Password step blocked without a verified code | [ ] |
| `register.html` redirects to the new page | [ ] |
| Timing for match and no-match measured | [ ] Not done |
| Strict-mode session test in deployment | [ ] Not done |

## 9. Known limitations and open items

- **Password policy updated:** new activation and reset passwords require at least 15 code points and are checked for school ID, name, email-local-part, school-domain label and `campusroom` personal information.
- **Login still sends an emailed code** that is stored in plain text in `users.otp_code`. Moving it to the hashed table is a later change.
- Response timing is padded but **not yet measured**, so the claim that it reveals nothing is unproven.
- The migration that revokes API-role permissions is written but **not applied**.
- No Content Security Policy yet. The pages use inline scripts and a CDN, so it needs a report-only rollout first.
- `composer.lock` is out of date.
- IDs for staff and faculty who lack 8-digit numbers are rejected until their format is defined.
- Existing accounts that are not in the roster keep working until a decision is made about them.
- **Code hashing key:** confirm in `ActivationRepository.php` whether codes are hashed with a dedicated secret or with `APP_SECRET`. If there is no secret at all, a database leak would let someone recover short-lived codes by brute force.
