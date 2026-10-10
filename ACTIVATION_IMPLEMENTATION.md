# Account Activation Rework — Agent Implementation Instructions

**Project:** CampusRoom (School Facility Reservation System)
**Stack:** Framework-free PHP 8+ REST API, PDO, Supabase-hosted PostgreSQL, static HTML frontend in `public/`
**Task:** Replace open self-registration with school-roster-gated **account activation** (email OTP, then user-chosen password), with full security hardening and validation.

> **How to use this document.** Work through the phases in order. Do **Phase 0 (recon) first** and do not assume file names, class names, or existing behaviour. This document was written without access to the PHP source or the HTML files, so every file path below is a *likely* location, not a fact. Where this document and the real code disagree, trust the code, then adapt the plan and note the difference in your final report.

---

## 1. Goal and flow

Only people who exist in the school's records may get an account. Outsiders must not be able to register or log in.

```
1. User enters school email or school ID.
2. Server looks the identifier up in the school directory (server-side only).
3. If it matches an eligible, not-yet-activated person: generate OTP, email it to the
   address ON FILE (never an address the client supplied). Otherwise do nothing visible.
   -> The HTTP response is IDENTICAL in every case.
4. User enters the OTP. Server verifies it.
5. On success the session is marked "verified for school_id X". The activation page
   greets the user by name and asks for a new password (+ confirmation).
6. Server validates the password, creates the row in `users`, marks OTPs consumed,
   logs the event, emails an "account activated" notice.
7. User is redirected to the login page (NOT auto-logged-in) and signs in with
   school email (or school ID) + the new password.
```

### Non-goals (do not build now)
- Forgot-password flow (but design tables so it can reuse the OTP machinery: see `purpose` column).
- Admin UI for the school directory.
- MFA / TOTP for login.
- Live integration with an external school database (build a CSV importer behind an interface; see §10).

---

## 2. Non-negotiable security invariants

Every one of these must hold at the end. They are the acceptance criteria in §14.

1. **No account enumeration.** `POST /api/auth/activate/request` returns the same status code, same JSON body (byte-for-byte), same headers/cookies, and statistically indistinguishable response time whether the identifier is unknown, known-and-eligible, known-and-already-activated, or known-but-inactive.
2. **OTP is only ever sent to the email stored in `school_directory`.** Never to a client-supplied address.
3. **The activation page and `complete` endpoint are gated server-side** by session state set only after a successful OTP verification. Hitting the URL directly must fail.
4. **The user's name is revealed only after OTP verification.**
5. **OTPs:** 6 digits from a CSPRNG, stored only as keyed hashes, single-use, short-lived (≤ 10 min), attempt-limited, compared in constant time.
6. **Passwords** are validated server-side (client validation is UX only), checked against common/breached lists, hashed with Argon2id (or bcrypt fallback), never logged, never stored in session, never placed in a URL.
7. **Role is never taken from the client.** Activation always creates `Customer`. Staff/Admin are assigned by an admin or SQL only.
8. **Race-safe creation:** two simultaneous activations of the same person produce exactly one account (DB unique constraints + transaction).
9. **The old open `register` endpoint is removed**, not merely hidden.
10. **All new tables are protected from Supabase's auto-generated REST API** (RLS enabled, no public policies, anon/authenticated access revoked).
11. **Secrets (OTP pepper, SMTP password, DB password) live only in `.env`**, never in code or logs.

---

## 3. Decisions to confirm (use the defaults if the user cannot answer)

Ask the user once, up front, in a single message. If there is no answer, proceed with the default and record it in your final report.

| # | Decision | Default |
|---|----------|---------|
| D1 | Where does school data come from? | CSV import into `school_directory` (§10). Keep the source behind an interface so an API/DB source can replace it. |
| D2 | Accepted identifier format | Accept **school email** OR **school ID**. Ask for the school ID pattern; until known use `^[A-Za-z0-9._-]{3,64}$` for IDs. |
| D3 | SMTP provider & sender address | PHPMailer over SMTP, credentials from `.env`. Sender must be on a domain with SPF/DKIM configured. |
| D4 | Existing `users` not in the roster (old self-registered customers) | **Report only.** Produce a list; do **not** deactivate automatically. Never touch Staff/Admin. |
| D5 | Password minimum length | 12 characters (configurable), maximum accepted 128 characters. |
| D6 | OTP lifetime | 600 seconds (never above 600). |
| D7 | Is the site served over HTTPS in production? | Assume yes. Cookie `Secure` flag and HSTS enabled when HTTPS is detected. |

---

## 4. Phase 0 — Recon (read-only; produce notes before changing anything)

Inspect the repository and write a short findings list. Confirm each of these:

- [ ] Location and content of the **register HTML page** and its JS (`public/*.html`, inline `<script>` or separate files). Note whether pages use inline scripts/styles (affects CSP, §12).
- [ ] How `public/index.php` routes requests: how routes are declared, how static HTML is served, how JSON bodies are parsed, how `Response` builds the envelope `{ "success", "data", "error" }`.
- [ ] `src/Core/Auth.php`: session start parameters, cookie flags, how `requireRole()` works, whether a custom session handler uses the `sessions` table.
- [ ] How **`auth_rate_limits`** is currently used (columns: `rate_key` PK, `action`, `identifier`, `failed_attempts`, `locked_until`, `updated_at`). **Extend that helper; do not build a second rate limiter.**
- [ ] Current `AuthController::register()`, `login()`, `logout()` behaviour, error messages, and what they return for unknown email vs wrong password vs unverified account.
- [ ] How `users.otp_code`, `users.otp_expires_at`, `users.is_verified` are currently used (grep for them). They are superseded by this work.
- [ ] How `system_logs` rows are written (`user_id` nullable, `action_type` varchar) and what existing `action_type` strings look like (follow the same naming style).
- [ ] The shared frontend `fetch` helper (if any) used by pages to call the API.
- [ ] Existing `.htaccess` and `.env.example` contents.
- [ ] PHP extensions available: `pdo_pgsql`, `openssl`, `mbstring`, `intl` (optional), Argon2 support (`defined('PASSWORD_ARGON2ID')`).

Deliver a 10–20 line summary of findings to the user before Phase 1 if anything contradicts this document.

---

## 5. Phase 1 — Database migration

Create `migrations/001_activation.sql` (create the folder if needed). It must be **idempotent** and run inside a transaction. **Test on a staging copy / Supabase branch first; take a backup before running against production.** Do not drop any existing column in this migration.

```sql
BEGIN;

-- 1. School roster (source of truth for who may activate) --------------------
CREATE TABLE IF NOT EXISTS public.school_directory (
  school_id    varchar(64)  PRIMARY KEY,
  full_name    varchar(200) NOT NULL,
  email        varchar(254) NOT NULL,
  person_type  varchar(32)  NOT NULL,          -- e.g. Student / Faculty / Staff (maps to users.account_type)
  is_current   boolean      NOT NULL DEFAULT true,
  synced_at    timestamp    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS school_directory_email_lower_uq
  ON public.school_directory (lower(email));

-- 2. OTP storage (reusable later for password reset via `purpose`) -----------
CREATE TABLE IF NOT EXISTS public.activation_otps (
  otp_id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id       varchar(64) NOT NULL REFERENCES public.school_directory(school_id),
  purpose         varchar(32) NOT NULL DEFAULT 'activation',
  code_hash       char(64)    NOT NULL,         -- HMAC-SHA256 hex, never the code itself
  expires_at      timestamp   NOT NULL,
  attempts        integer     NOT NULL DEFAULT 0,
  used_at         timestamp,
  invalidated_at  timestamp,
  created_at      timestamp   NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS activation_otps_school_created_idx
  ON public.activation_otps (school_id, created_at DESC);

-- 3. Link users to the roster ------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS school_id    varchar(64) UNIQUE REFERENCES public.school_directory(school_id),
  ADD COLUMN IF NOT EXISTS is_active    boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS activated_at timestamp;

-- 4. Case-insensitive email uniqueness on users.
--    PRE-CHECK (run first, must return 0 rows or the index will fail):
--    SELECT lower(email), count(*) FROM public.users GROUP BY 1 HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_uq
  ON public.users (lower(email));

-- 5. Lock the new tables away from Supabase's auto-generated REST API --------
ALTER TABLE public.school_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activation_otps  ENABLE ROW LEVEL SECURITY;
-- No policies on purpose. The PDO connection (table owner) bypasses RLS.
-- Supabase-specific; skip these lines if the roles do not exist:
REVOKE ALL ON public.school_directory FROM anon, authenticated;
REVOKE ALL ON public.activation_otps  FROM anon, authenticated;

COMMIT;
```

**Notes for the agent**
- **Time handling:** all existing timestamp columns are `timestamp without time zone` defaulting to `CURRENT_TIMESTAMP`. Do **all expiry and window math in SQL using `CURRENT_TIMESTAMP`** (e.g. `expires_at = CURRENT_TIMESTAMP + make_interval(secs => :ttl)`). Never compare against PHP `time()`.
- `person_type` values: adapt to what the school's data actually contains once D1/D2 are answered. Do not add a CHECK constraint until the values are known.
- **Flag to the user (do not fix silently):** the existing tables in `public` (`users`, `sessions`, `system_logs`, etc.) appear to have no RLS in the provided schema dump. Tell the user to check the Supabase **Security Advisor** and consider enabling RLS on them too. `sessions.data` and `users.password_hash` are sensitive.
- A second migration `002_drop_legacy_otp.sql` (dropping `users.otp_code`, `users.otp_expires_at`, and possibly `is_verified`) is a **follow-up**, to be run only after the new flow is verified in production. Write it, but do not run it and do not include it in the main migration.

---

## 6. Phase 2 — Configuration and dependencies

### Composer
```
composer require phpmailer/phpmailer
```
Do not add other runtime dependencies without a strong reason.

### `.env.example` additions (also add to real `.env`; never commit `.env`)
```
# --- Mail ---
MAIL_HOST=smtp.example.edu
MAIL_PORT=587
MAIL_ENCRYPTION=tls              # tls | ssl
MAIL_USER=
MAIL_PASS=
MAIL_FROM=no-reply@example.edu
MAIL_FROM_NAME="CampusRoom"

# --- Activation / OTP ---
OTP_PEPPER=                      # 32+ random bytes, hex or base64. Generate: php -r "echo bin2hex(random_bytes(32));"
OTP_LENGTH=6
OTP_TTL_SECONDS=600              # MUST NOT exceed 600
OTP_MAX_ATTEMPTS=5               # per OTP
OTP_RESEND_COOLDOWN_SECONDS=60
OTP_MAX_SENDS_PER_HOUR=5         # per school_id
ACTIVATION_SESSION_TTL_SECONDS=900  # verified state lifetime

# --- Password policy ---
PASSWORD_MIN_LENGTH=12
PASSWORD_MAX_LENGTH=128

# --- Network ---
TRUSTED_PROXIES=                 # comma-separated IPs allowed to set X-Forwarded-For; empty = ignore the header
APP_ENV=production               # production | development
```
Fail fast at boot (with a clear server-side error, generic client error) if `OTP_PEPPER` is missing or shorter than 32 bytes, or if `OTP_TTL_SECONDS > 600`.

---

## 7. Phase 3 — Backend

### 7.1 Suggested structure (match the existing style; the repository pattern is a stated architecture decision, so **all SQL stays in repositories**, controllers never touch PDO)

```
src/Core/
  Csrf.php                  -- token + Origin check
  RateLimiter.php           -- extend/wrap the existing auth_rate_limits logic
  Mailer.php                -- PHPMailer wrapper
  Timing.php                -- minimum-duration padding helper
  ClientIp.php              -- trusted-proxy aware IP resolution
src/Security/
  PasswordPolicy.php        -- server-side validation (+ blocklist + HIBP)
  Otp.php                   -- generate / hash / verify helpers
src/Repository/
  SchoolDirectoryRepository.php
  ActivationOtpRepository.php
  (extend) UserRepository.php
src/Service/
  ActivationService.php     -- orchestration, keeps the controller thin
src/Controller/
  ActivationController.php  -- or add methods to AuthController
resources/
  common-passwords.txt      -- top ~10k–100k common passwords, lowercase, one per line
  mail/                     -- email templates
scripts/
  import_school_directory.php
```

### 7.2 Routes

Register in `public/index.php`:

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET  | `/api/auth/csrf` | none | Returns CSRF token bound to session |
| POST | `/api/auth/activate/request` | none | Start activation (generic response) |
| POST | `/api/auth/activate/verify` | session ctx | Verify OTP |
| GET  | `/api/auth/activate/context` | verified session | Returns `{ "name": "..." }` |
| POST | `/api/auth/activate/complete` | verified session | Set password, create account |
| ~~POST~~ | ~~`/api/auth/register`~~ | — | **Remove** |

Old page `register.html` (or whatever it is called): replace with `activate.html`, and add a redirect from the old URL to the new one in `.htaccess` (301) so existing links do not 404.

### 7.3 Session state machine

Use the existing session mechanism. Store **only non-secret state**:

```php
$_SESSION['activation'] = [
  'identifier_hash' => hash('sha256', $normalizedIdentifier), // for rate limiting; never the raw value
  'school_id'       => $schoolIdOrNull,   // null when no eligible match (decoy path)
  'started_at'      => time(),
  'verified'        => false,
  'verified_at'     => null,
];
```

Rules:
- `request` always starts the session and always sets state (including the decoy path with `school_id = null`), so cookies and behaviour are identical.
- `verify` success: set `verified = true`, `verified_at = time()`, and call **`session_regenerate_id(true)`**.
- `context` and `complete` require `verified === true` **and** `time() - verified_at <= ACTIVATION_SESSION_TTL_SECONDS`. Otherwise return `401` with a generic message ("Your session expired. Please start again.") and clear the state.
- `complete` success: **destroy the activation state** (`unset($_SESSION['activation'])`) and regenerate the session ID. The state is single-use.
- Never store the OTP, the password, or password hashes in the session.

### 7.4 `POST /api/auth/activate/request`

**Input:** `{ "identifier": "string" }`

**Processing order (strict):**

1. Record start time (for timing padding).
2. Validate CSRF + Origin (§7.9).
3. Parse and validate **format only** (independent of the database): trim, max 254 chars, must match email format OR the school-ID pattern (D2). Empty/invalid format → `422` with a fixed message (this does not reveal anything about the roster).
4. Normalize: trim, lowercase if it looks like an email. Compute `identifier_hash`.
5. **Rate limit** (see §8). IP limit exceeded → `429` generic. Identifier limit exceeded → *continue as normal but suppress sending* (still returns the standard 200, so limit state cannot be used to probe existence).
6. Look up `school_directory` by `lower(email) = :id` OR `school_id = :id`.
7. Branches (all produce the same HTTP response):
   - **No row or `is_current = false`:** no email. `school_id = null` in session state.
   - **Row exists AND a `users` row exists for that `school_id` or email:** send the **"already active" notice** to the email on file (subject to the per-school_id send cap). No OTP.
   - **Row exists, eligible, not activated:** if cooldown/hourly cap allow → invalidate previous unused OTPs for that `school_id`, generate new OTP, store hash, send OTP email to `school_directory.email`.
8. Set session state, **respond first, then send email** (see timing below).
9. Pad total duration to a fixed floor (§7.8).

**Response (identical in every branch):**
```json
HTTP 200
{
  "success": true,
  "data": {
    "message": "If this matches a school record, a verification code has been sent to the email on file.",
    "otp_length": 6,
    "expires_in_seconds": 600,
    "resend_after_seconds": 60
  },
  "error": null
}
```
No per-user fields. Do not echo the identifier. Do **not** show a masked email (e.g. `j***@school.edu`); that confirms existence.

**Send-after-respond:** the SMTP call takes noticeable time that exists only in the "match" branch. Flush the response to the client before sending mail:
```php
ignore_user_abort(true);
$body = json_encode($payload);
header('Content-Type: application/json');
header('Content-Length: ' . strlen($body));
header('Connection: close');
echo $body;
if (function_exists('fastcgi_finish_request')) { fastcgi_finish_request(); } else { @ob_end_flush(); @flush(); }
// ... now send mail
```
Verify the behaviour in the actual deployment (php-fpm vs Apache mod_php vs built-in dev server behave differently). If respond-then-send cannot be made reliable, fall back to padding every response to a floor longer than the 95th percentile SMTP time (e.g. 2.5 s) and document the trade-off.

### 7.5 `POST /api/auth/activate/verify`

**Input:** `{ "code": "123456" }`

1. CSRF/Origin check.
2. Require `$_SESSION['activation']` to exist and be younger than `ACTIVATION_SESSION_TTL_SECONDS`; otherwise `400` generic.
3. Validate format: exactly `OTP_LENGTH` digits (`/^\d{6}$/`), else the same generic failure (no separate "bad format" message that differs in timing).
4. Rate limit (§8). Locked → `429` generic.
5. If `school_id` is null (decoy path): perform an equivalent dummy HMAC + constant-time compare against a dummy hash, count the failure against `identifier_hash`, return the generic failure. Timing must match the real path.
6. Real path, inside a transaction:
   ```sql
   SELECT otp_id, code_hash, attempts
   FROM activation_otps
   WHERE school_id = :sid AND purpose = 'activation'
     AND used_at IS NULL AND invalidated_at IS NULL
     AND expires_at > CURRENT_TIMESTAMP
   ORDER BY created_at DESC LIMIT 1
   FOR UPDATE;
   ```
   - No row → generic failure.
   - `hash_equals($row.code_hash, hmac(code))`:
     - **Match:** `UPDATE ... SET used_at = CURRENT_TIMESTAMP`; set session `verified`; regenerate session ID.
     - **No match:** `UPDATE ... SET attempts = attempts + 1, invalidated_at = CASE WHEN attempts + 1 >= :max THEN CURRENT_TIMESTAMP END`. Also increment the per-`school_id` failure counter in `auth_rate_limits`, which is **not reset when a new OTP is issued** (this stops "request new code, guess again" loops).
7. Pad to the timing floor.

**Responses:**
- Success: `200 { "success": true, "data": { "verified": true } }`
- Any failure: `400 { "success": false, "error": "That code is incorrect or has expired." }` (same text for wrong, expired, used, no such OTP, decoy path)
- Rate-limited: `429 { "success": false, "error": "Too many attempts. Please try again later." }` (same text for all keys)

### 7.6 `GET /api/auth/activate/context`
Requires verified, unexpired session state. Returns `{ "name": "<school_directory.full_name>" }` fetched fresh from the DB by `school_id`. If the directory row is now `is_current = false`, return `401` and clear state. Response header `Cache-Control: no-store`.

### 7.7 `POST /api/auth/activate/complete`

**Input:** `{ "password": "...", "password_confirm": "..." }`

1. CSRF/Origin check; rate limit; require verified, unexpired state.
2. Server-side checks (§9). Policy failures → `422` with a field-level list of **which rules failed** (safe here because the caller is verified):
   ```json
   { "success": false, "data": null, "error": "Password does not meet requirements.", "details": ["too_short", "common_password"] }
   ```
   Use stable machine codes in `details`; the frontend maps them to messages.
3. Transaction:
   ```sql
   BEGIN;
   SELECT school_id, full_name, email, person_type
     FROM school_directory WHERE school_id = :sid AND is_current = true FOR UPDATE;
   -- no row => ROLLBACK, 401 "Your session expired. Please start again."

   SELECT 1 FROM users WHERE school_id = :sid OR lower(email) = lower(:email);
   -- row exists => ROLLBACK, 409 generic "This account cannot be activated. Please sign in or contact support."

   INSERT INTO users
     (name, email, password_hash, role, is_verified, account_type, school_id, is_active, activated_at)
   VALUES
     (:full_name, lower(:email), :hash, 'Customer', true, :person_type, :sid, true, CURRENT_TIMESTAMP)
   RETURNING user_id;

   UPDATE activation_otps SET invalidated_at = CURRENT_TIMESTAMP
     WHERE school_id = :sid AND used_at IS NULL AND invalidated_at IS NULL;

   INSERT INTO system_logs (user_id, action_type) VALUES (:uid, 'ACCOUNT_ACTIVATED');
   COMMIT;
   ```
   - `role` is the literal `'Customer'`. **Ignore any `role` in the request.**
   - Catch the unique-violation SQLSTATE `23505` from a race and return the same 409.
   - `name`, `email`, `account_type` come **from the directory row, never the client**.
4. After commit: clear activation session state, regenerate session ID, send the "account activated" email (respond-then-send is fine).
5. **Do not auto-login.** Respond `201 { "success": true, "data": { "activated": true } }`; the frontend redirects to the login page with a success notice.

### 7.8 Timing helper (`src/Core/Timing.php`)

```php
final class Timing {
    /** Sleep so the request takes at least $floorMs (+ small random jitter). */
    public static function pad(float $startedAt, int $floorMs = 400): void {
        $elapsedMs = (microtime(true) - $startedAt) * 1000;
        $remaining = $floorMs - $elapsedMs;
        if ($remaining > 0) {
            usleep((int)(($remaining + random_int(0, 40)) * 1000));
        }
    }
}
```
Pick the floor after measuring (it must exceed the slowest legitimate branch's non-email work). Apply to `request` and `verify`.

### 7.9 CSRF and request hygiene (apply in the router to **all** state-changing methods)

The API uses session cookies, so state-changing calls are CSRF targets.
- Session cookie: `HttpOnly`, `Secure` (when HTTPS), `SameSite=Lax` (or `Strict` if cross-site navigation to the app is not needed), `session.use_strict_mode=1`, `use_only_cookies=1`. Verify what `Auth.php` already sets and fix gaps.
- For `POST/PATCH/PUT/DELETE`: require `Content-Type: application/json` (reject others with `415`), and validate the `Origin` header (fall back to `Referer`) against the configured app origin. Reject mismatches with `403`.
- Synchronizer token: `GET /api/auth/csrf` returns a random token stored in the session; state-changing requests must send it as `X-CSRF-Token`; compare with `hash_equals`. **Mandatory** for the activation and login endpoints. If applying it to every existing endpoint requires rewriting many pages, do the Origin + SameSite protection globally and the token on auth endpoints, and flag the remaining work to the user.
- Reject request bodies over a small limit (e.g. 8 KB) for these endpoints.
- Return `Cache-Control: no-store` on all `/api/auth/*` responses.

### 7.10 Client IP
Resolve the IP via a `ClientIp` helper. Use `$_SERVER['REMOTE_ADDR']`; only honour `X-Forwarded-For` if `REMOTE_ADDR` is listed in `TRUSTED_PROXIES`. Otherwise attackers can spoof the header and bypass IP rate limits.

---

## 8. Rate limiting (extend the existing `auth_rate_limits` helper)

Model: `rate_key` (PK) = `"{action}:{scope}:{value}"`, `failed_attempts` used as the hit counter, `locked_until` set when the limit is exceeded, counter resets when `updated_at` is older than the window. All time comparisons in SQL.

| Action | Scope / key value | Limit | On exceed |
|--------|-------------------|-------|-----------|
| `activate_request` | IP | 20 per 15 min | `429` generic |
| `activate_request` | `identifier_hash` | 5 per 60 min | **Silently suppress sending**, still return standard `200` |
| `activate_send` | `school_id` | 1 per 60 s **and** 5 per hour | Silently suppress sending |
| `activate_verify` | IP | 20 per 15 min | `429` generic |
| `activate_verify` | session | 10 per 15 min | `429` generic |
| `activate_verify_fail` | `school_id` (or `identifier_hash` on decoy path) | 10 failures per 30 min, **not reset by issuing a new OTP** | Lock 30 min, `429` generic |
| `activate_complete` | IP | 10 per 15 min | `429` generic |
| `login` | IP + identifier | keep existing (suggest 5 failures → 15 min lock) | `429` generic |
| `login` | IP | 30 per 15 min | `429` generic |

Critical rule: **limits must behave identically for existing and non-existing identifiers**, otherwise lockout behaviour becomes an enumeration oracle. Key by `identifier_hash`, not by "does the user exist".

Add an opportunistic cleanup: delete `activation_otps` older than 24 h and stale `auth_rate_limits` rows (`locked_until` and `updated_at` older than 24 h) on a small percentage of requests, or via a documented cron SQL.

---

## 9. OTP and password specifications

### 9.1 OTP (`src/Security/Otp.php`)

```php
public static function generate(): string {
    return str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT); // never rand()/mt_rand()
}
public static function hash(string $schoolId, string $code): string {
    // Keyed hash: a leaked DB cannot be brute-forced offline without the pepper.
    return hash_hmac('sha256', $schoolId . '|' . $code, self::pepper());
}
public static function verify(string $storedHash, string $schoolId, string $code): bool {
    return hash_equals($storedHash, self::hash($schoolId, $code));
}
```
- Plain unkeyed SHA-256 of a 6-digit code is reversible by brute force in milliseconds. The HMAC with `OTP_PEPPER` is required.
- Exactly one active OTP per `school_id`: issuing a new one invalidates the previous.
- Max `OTP_MAX_ATTEMPTS` (5) wrong guesses per OTP, then invalidate.
- TTL ≤ 600 s, enforced in SQL.
- Single use: `used_at` set under `FOR UPDATE`.

### 9.2 Password policy (`src/Security/PasswordPolicy.php`)

Server-side, in this order. Return **all** failing codes, not just the first.

| Code | Rule |
|------|------|
| `mismatch` | `password === password_confirm` |
| `too_short` | ≥ `PASSWORD_MIN_LENGTH` (12) characters (count Unicode code points with `mb_strlen`) |
| `too_long` | ≤ `PASSWORD_MAX_LENGTH` (128). If using the bcrypt fallback also enforce ≤ 72 **bytes** (bcrypt silently truncates beyond that) and return a clear message |
| `contains_personal` | Case-insensitive: must not contain the user's email local part, school ID, or any name part of 3+ characters from the directory row |
| `common_password` | Not in `resources/common-passwords.txt` (compare lowercase) |
| `repetitive` | Not a single repeated character, and not trivial sequences (`123456789012`, `abcdefghijkl`) |
| `breached` | Not found in Have I Been Pwned (below). **Fail-open**: if the API is unreachable (2 s timeout), log a warning and continue; the local blocklist still applies |

Rules about rules:
- **Do not** impose "must contain uppercase/digit/symbol" composition rules (current NIST guidance favours length + blocklist checks).
- **Allow** spaces, Unicode, and paste. Allow up to 128 characters.
- Normalize with NFKC (`Normalizer::normalize($pw, Normalizer::FORM_KC)`) before hashing **if `intl` is available**, and apply the same normalization at login. Be consistent or users will be locked out.
- Trim nothing. Passwords are used exactly as given (after normalization).

**HIBP range check (k-anonymity, the full password/hash never leaves the server):**
```php
$sha1   = strtoupper(sha1($password));
$prefix = substr($sha1, 0, 5);
$suffix = substr($sha1, 5);
// GET https://api.pwnedpasswords.com/range/{$prefix}   with header "Add-Padding: true"
// If any returned line starts with "$suffix:" and the count > 0 => breached.
```
Use cURL or `file_get_contents` with a 2 s timeout and a descriptive `User-Agent`.

**Hashing:**
```php
$algo = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_BCRYPT;
$hash = password_hash($password, $algo);   // library-chosen salt; do not roll your own
```
Existing users keep their bcrypt hashes. At login use `password_verify()` (handles both) and, on success, `password_needs_rehash()` → re-hash and update.

---

## 10. School directory import (`scripts/import_school_directory.php`)

Build behind an interface so a future API/DB source can replace the CSV:
```php
interface SchoolDirectorySource { /** @return iterable<array{school_id,full_name,email,person_type}> */ public function rows(): iterable; }
```
CSV importer requirements:
- CLI only (`php scripts/import_school_directory.php path/to/file.csv [--dry-run]`). Refuse to run via web.
- Required columns: `school_id, full_name, email, person_type`. Reject the whole file if the header is wrong.
- Per row validation: non-empty fields, valid email (`filter_var`), trim, lowercase email, length limits, no duplicate `school_id`, no duplicate email within the file. Collect all bad rows into a report; **skip bad rows, never insert partially-validated data**.
- Upsert by `school_id` (`INSERT ... ON CONFLICT (school_id) DO UPDATE`), set `is_current = true`, `synced_at = CURRENT_TIMESTAMP`.
- Rows in the table but **absent from the file** → `is_current = false` (soft delete, never `DELETE`). Then `UPDATE users SET is_active = false WHERE school_id IN (SELECT school_id FROM school_directory WHERE is_current = false) AND role = 'Customer'`. **Never auto-deactivate Staff/Admin.**
- Safety rail: if the file would deactivate more than 20% of current rows, abort unless `--force` is passed (protects against a truncated export wiping everyone out).
- Everything in one transaction; `--dry-run` prints the counts (added / updated / deactivated / rejected) and rolls back.
- If an email changes for an existing `school_id`, update the directory; **do not** auto-change `users.email`. List these in the report for manual review.
- Make sure the CSV is read from outside the web root and is not committed to the repo (`.gitignore` it).
- Log the run (counts only, no personal data) to stdout.

Also provide `scripts/report_unmatched_users.sql` (read-only) listing `users` with `school_id IS NULL` (excluding Staff/Admin) for the admin to review (D4).

---

## 11. Emails (`src/Core/Mailer.php` + `resources/mail/`)

Send both **plain-text and HTML** parts. No tracking pixels. No links that carry tokens. Never include a password. Use `setFrom` from env, enable `SMTPSecure` per `MAIL_ENCRYPTION`, verify TLS certificates (do not disable `verify_peer`). Catch exceptions: log the failure server-side (without the OTP) and **never** change the client-visible response because of a mail failure (that would be an enumeration signal).

| Email | Subject | Content |
|-------|---------|---------|
| OTP | `Your CampusRoom verification code` | Greeting (name), the 6-digit code, expiry in minutes, "If you didn't request this, you can ignore this email. Your account has not been changed." Never ask them to reply with the code. |
| Already active | `CampusRoom: your account is already active` | "Someone (hopefully you) tried to activate this account. It is already active. Sign in, or use Forgot Password if you need to reset it." |
| Activated | `Your CampusRoom account is now active` | Date/time of activation, "If this wasn't you, contact `<support contact>` immediately." |

Operational: SPF, DKIM, DMARC must be configured for the sending domain or codes will land in spam. Mention this to the user as a deployment checklist item.

Mail-log hygiene: do not log OTPs or full email bodies. In development (`APP_ENV=development`) it is acceptable to write the OTP to a local log file **only if** that code path is hard-disabled when `APP_ENV=production`.

---

## 12. Login hardening (`AuthController::login`)

Login identifier: school **email** or **school ID** (`users.email` or `users.school_id`). The schema has no username column, so the school ID plays that role.

- Look up the user. If not found, run `password_verify($password, $DUMMY_HASH)` against a fixed, valid dummy hash so timing does not reveal whether the account exists.
- Fail with **one** generic message and status for: unknown user, wrong password, `is_active = false`, locked-out. Message: `"Invalid email/ID or password."` (lockout: the generic `429`).
- Rate limit (§8). Count failures per `identifier_hash + IP` and per IP.
- On success: `session_regenerate_id(true)`, `password_needs_rehash()` upgrade, log `LOGIN_SUCCESS`.
- Remove any branches that return distinct errors for "unverified" accounts.
- The login page shows a success banner when redirected from activation (`?activated=1`) and links to "Activate your account" (replacing "Register").

---

## 13. Phase 4 — Frontend (`activate.html`)

Locate the existing register page and its script; **convert it** rather than adding a parallel page. If the page uses inline `<script>`/`<style>`, move them to external files so a strict CSP can be applied (§15).

### 13.1 Stages (single page, three steps; show only one at a time)

**Stage 1 — Identify**
- Label: "School email or ID". `autocomplete="username"`, `inputmode="email"`, `autocapitalize="off"`, `spellcheck="false"`, `maxlength="254"`.
- Client validation: non-empty, matches email or ID format. Disable the button while the request is in flight (prevent double submit).
- Always show the **server's generic message** after submit, then move to Stage 2 regardless of match: *"If this matches a school record, we've sent a 6-digit code to the email on file. It expires in 10 minutes."* Never say "email not found", and never display a masked email.

**Stage 2 — Verify**
- Code input: `inputmode="numeric"`, `autocomplete="one-time-code"`, `maxlength="6"`, `pattern="\d{6}"`. Auto-submit when 6 digits are entered (optional).
- "Resend code" button disabled with a visible countdown (`resend_after_seconds`, 60). Countdown is client-side only.
- "Use a different email/ID" link returns to Stage 1.
- Errors: wrong/expired → *"That code is incorrect or has expired."*; `429` → *"Too many attempts. Please wait a few minutes and request a new code."* Clear the field and refocus after an error.
- On success → call `GET /api/auth/activate/context` and go to Stage 3.

**Stage 3 — Create password**
- Greeting: `Welcome, <name>!` — set via **`textContent`**, never `innerHTML` (XSS).
- Fields: new password, confirm password, both `autocomplete="new-password"`, **paste allowed** (do not block paste), show/hide toggle on each.
- Live requirements checklist (`aria-live="polite"`): ≥ 12 characters, doesn't contain your name/ID/email, passwords match. Add a simple strength indicator (length-based plus "common password" feedback after server check). No composition rules in the UI.
- Submit disabled until the client checks pass. These checks are **convenience only**; the server re-validates everything.
- Map server `details` codes to messages: `too_short`, `too_long`, `contains_personal`, `common_password`, `repetitive`, `breached` ("This password appeared in a known data breach. Please choose another."), `mismatch`.
- On `401` (expired session): return to Stage 1 with *"Your session expired. Please start again."*
- On success: clear the form, redirect to `login.html?activated=1` (use the actual login page name).

### 13.2 Frontend security and UX rules
- All API calls go through the shared fetch helper, which adds `Content-Type: application/json`, `credentials: 'same-origin'`, and `X-CSRF-Token` (fetched from `/api/auth/csrf` on page load).
- **Never** put OTP, password, or identifier in a URL/query string.
- **Never** store OTP or password in `localStorage`/`sessionStorage`/cookies/global variables that outlive the step. Clear password inputs on error and on success.
- No third-party scripts or CDNs on this page (keeps CSP strict). If a strength library (e.g. zxcvbn) is wanted, vendor it locally.
- Accessibility: every input has a `<label>`; errors are announced via `aria-live`; focus moves to the first field of each new stage and to the error summary on failure; fully keyboard-operable; don't rely on colour alone.
- Handle network failure gracefully ("Something went wrong. Please try again.") without leaking details.
- Mobile-friendly layout (this is likely used on phones).
- Update any nav/landing links that say "Register" or "Sign up" to "Activate your account".

---

## 14. Phase 5 — Headers and hardening (`.htaccess` / `index.php`)

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin` (or `no-referrer`)
- `X-Frame-Options: DENY` plus `frame-ancestors 'none'` in CSP
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` — **only** when served over HTTPS
- `Cache-Control: no-store` on `/api/auth/*` and on `activate.html`
- **CSP:** `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`. Roll out with `Content-Security-Policy-Report-Only` first, check the other pages for inline scripts/styles that would break, then enforce. Do not break existing pages.
- Disable PHP error display in production (`display_errors=0`); log errors to a file/stderr. The API must never return stack traces or SQL errors; map exceptions to a generic `500` envelope.
- Confirm `.env`, `composer.json`, `composer.lock`, `database_schema_mysql.sql`, `Phase_2_Documentation.md`, migrations, and `scripts/` are **not** web-accessible (deny in `.htaccess` or keep outside the document root; the README says `public/` is the docroot, so verify the Apache deployment does the same).
- Also flag to the user: `database_schema_mysql.sql` is named MySQL but the system targets PostgreSQL/Supabase. Ask which is authoritative; update or remove the stale file.

---

## 15. Logging and audit

Use `system_logs` (`user_id`, `action_type`). Follow the existing naming style. Suggested `action_type` values:

`ACTIVATION_OTP_SENT`, `ACTIVATION_OTP_VERIFIED`, `ACTIVATION_OTP_FAILED`, `ACTIVATION_RATE_LIMITED`, `ACCOUNT_ACTIVATED`, `LOGIN_SUCCESS`, `LOGIN_FAILED`

- `system_logs.user_id` is nullable and has no school_id column. For pre-activation events (no `users` row yet) either skip DB logging or write to the PHP error log with `identifier_hash` only. **Do not** add personal data to logs. If the user wants per-school-ID audit, propose a nullable `details` column rather than overloading `action_type`.
- `ACCOUNT_ACTIVATED` is logged with the new `user_id` inside the creation transaction.
- **Never log:** OTP codes, passwords, password hashes, raw identifiers of non-matching lookups, session IDs, SMTP credentials.
- Privacy: collect and expose the minimum personal data. Student data is personal information under the Philippine Data Privacy Act (RA 10173); suggest the school's data protection officer reviews retention and consent wording. (This is a pointer, not legal advice.)

---

## 16. Legacy handling and cleanup

1. Do not delete or alter existing `users` rows. Existing Staff/Admin accounts remain valid and have `school_id = NULL`.
2. Delete the `register` route, controller method, repository method, and its frontend page/links once `activate.html` works. Search the repo for leftover references (`/api/auth/register`, `register.html`).
3. Existing customers who self-registered but are not in the roster: **report only** (D4). The user decides whether to deactivate them.
4. Update `README.md`: new endpoints and curl examples (with cookie jar and CSRF token), new `.env` variables, import script usage, security notes (OTP, rate limits, RLS). Remove `register` examples. Add the migration instructions.
5. Update `Phase_2_Documentation.md` only if it describes the registration flow.

---

## 17. Testing

Provide curl examples in the README and, if feasible, PHPUnit/Pest tests for the service layer. At minimum, **manually run and record** every case below against a test database seeded with: one eligible person, one already-activated person, one `is_current=false` person, and one Staff user.

| # | Scenario | Expected |
|---|----------|----------|
| T1 | Request with unknown identifier | `200`, standard body, **no email sent** |
| T2 | Request with eligible identifier | `200`, standard body, **one email sent to directory address** |
| T3 | Request with already-activated identifier | `200`, standard body, "already active" email sent |
| T4 | Request with `is_current=false` identifier | `200`, standard body, no email |
| T5 | **Parity check:** T1–T4 responses diffed | Same status, same body bytes, same headers (except Date/Set-Cookie value), median timing difference < 100 ms over 50 runs each |
| T6 | Request with client-supplied different email | OTP still goes only to directory email |
| T7 | Verify with correct code | `200`, session verified, session ID changed |
| T8 | Verify with wrong code ×5 | 5th failure invalidates the OTP; correct code afterwards is rejected |
| T9 | Request new OTP after failures, keep guessing | Failure counter per `school_id` persists; lock after 10 failures / 30 min |
| T10 | Verify after expiry (set `expires_at` in the past) | Generic failure |
| T11 | Reuse a valid code a second time | Generic failure (single use) |
| T12 | Concurrent verify with the same correct code (2 parallel requests) | Exactly one succeeds |
| T13 | `GET /context` and `POST /complete` without verifying | `401` |
| T14 | `/complete` after `ACTIVATION_SESSION_TTL_SECONDS` | `401`, state cleared |
| T15 | `/complete` with weak/short/common/breached/personal-info/mismatched password | `422` with the right `details` codes |
| T16 | `/complete` with `{"role":"Admin"}` in the body | Ignored; user created as `Customer` |
| T17 | Two simultaneous `/complete` calls | One account only, other gets `409` |
| T18 | Request/verify/complete without CSRF token, wrong `Origin`, or wrong `Content-Type` | `403` / `415` |
| T19 | Hammer `/request` from one IP | `429` after limit; identifier/school limits silently suppress emails but still return `200` |
| T20 | Login with new account (email and school ID) | Success; session ID regenerated |
| T21 | Login: unknown user vs wrong password vs deactivated user | Identical message/status; similar timing |
| T22 | Login brute force | Lockout per identifier+IP and per IP |
| T23 | `POST /api/auth/register` | `404` (route removed) |
| T24 | Fetch Supabase REST API with the anon key for `school_directory` and `activation_otps` | Denied / empty (RLS works). Ask the user to verify, as you may not have the anon key |
| T25 | Import script: bad header, bad rows, duplicates, >20% deactivation, `--dry-run` | Behaves as in §10 |
| T26 | Greeting contains `<script>` in name (seed a test row) | Rendered as text, not executed |
| T27 | Stage flow on mobile viewport and with keyboard only | Usable |
| T28 | Browser back button after success / on Stage 3 | No password or OTP retained in fields or history |

---

## 18. Definition of done

- [ ] All invariants in §2 hold, demonstrated by the tests in §17 (record results).
- [ ] Migration is idempotent, tested on a copy, and a rollback note is provided.
- [ ] `register` route, controller code, and page are gone; old URL redirects to `activate.html`.
- [ ] `.env.example` and README updated; no secrets committed; `git grep` for the pepper/SMTP password finds nothing.
- [ ] No inline scripts remain on the activation and login pages; CSP in Report-Only (or enforced if all pages verified).
- [ ] Rate limiting uses the existing `auth_rate_limits` helper (extended, not duplicated).
- [ ] A short **final report** to the user containing: summary of what changed per file, defaults chosen for D1–D7, test results, the list of unmatched legacy users, and the open items below.

### Open items to report (do not silently decide)
- RLS status of pre-existing tables in `public` (Supabase Security Advisor).
- MySQL-named schema file vs Postgres reality.
- Whether to deactivate legacy customers not in the roster.
- SPF/DKIM/DMARC for the mail domain.
- Whether to extend the CSRF token to all pre-existing endpoints.
- A dedicated least-privilege DB role instead of connecting as `postgres`.
- Schedule for syncing the school directory (manual import vs cron) and who owns it.

---

## 19. Reference: error and message copy (keep wording identical across branches)

| Situation | HTTP | Message |
|-----------|------|---------|
| Request accepted (any outcome) | 200 | If this matches a school record, a verification code has been sent to the email on file. |
| Bad identifier format | 422 | Please enter your school email or ID. |
| Wrong / expired / used code | 400 | That code is incorrect or has expired. |
| Rate limited (any key) | 429 | Too many attempts. Please try again later. |
| Session missing/expired | 401 | Your session expired. Please start again. |
| Policy failure | 422 | Password does not meet requirements. (+ `details` codes) |
| Activation conflict | 409 | This account cannot be activated. Please sign in or contact support. |
| Login failure | 401 | Invalid email/ID or password. |
| CSRF/Origin failure | 403 | Request could not be verified. Please reload the page. |
| Wrong content type | 415 | Unsupported content type. |
| Unexpected error | 500 | Something went wrong. Please try again. |
