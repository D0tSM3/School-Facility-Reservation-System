# Security Logging Plan: Sign-in and Activation

Goal: record sign-in and activation activity so an admin can spot suspicious patterns. Reuse the existing `System_Logs` table, `insertLog()`, `GET /api/logs` and the admin audit view in `admin-governance.html`. No new service. The work is split into **slices**. Each one can be built, committed and tested alone.

## 1. Key decisions

- **Log attempts, not page views.** The login page is static HTML served by Vercel. It never reaches PHP, so nothing is logged for it today. A row per visit would let anyone fill the table by reloading. Attackers also call the API directly. So log what the server decides: sign-in attempts, lockouts, wrong codes, activation requests.
- **Count page loads, don't log them.** The login and activation pages already call `GET /api/auth/csrf` on load. Count those calls per IP in `auth_rate_limits` and write **one** summary row when a burst crosses a threshold (`visit_burst`). Never one row per load.
- **The database is the durable record.** Vercel keeps runtime logs only for a short time (about 1 hour on Hobby, 1 day on Pro), and static-file requests are mostly not in them.
- **Flags are for review.** Nothing blocks automatically, except the hard cap on page loads (section 7) that protects the `sessions` table.

## 2. Research basis

- OWASP ASVS: log successful and failed authentication, never passwords or session tokens.
- OWASP logging guidance: treat logged values as untrusted (strip CR/LF, escape on display), set a retention policy, restrict access to logs containing personal data.
- Credential stuffing rotates IPs through proxies, so detection must use several keys: per IP, per account, and many accounts from one source. The strongest signal is a burst of failures across many accounts, or a success right after several failures.
- OWASP bot guidance: keep anti-abuse signals for a short time.

## 3. Schema: four nullable columns on `system_logs`

Existing rows and screens keep working. The human runs this after a backup, as `migrations/2026-10-11_security_log_columns.sql`:

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.system_logs
  ADD COLUMN IF NOT EXISTS event_type      varchar(40),
  ADD COLUMN IF NOT EXISTS ip_address      varchar(45),
  ADD COLUMN IF NOT EXISTS identifier_hash char(16),
  ADD COLUMN IF NOT EXISTS user_agent      varchar(200);
CREATE INDEX IF NOT EXISTS system_logs_event_time_idx
  ON public.system_logs (event_type, "timestamp" DESC) WHERE event_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS system_logs_ip_time_idx
  ON public.system_logs (ip_address, "timestamp" DESC) WHERE ip_address IS NOT NULL;
COMMIT;
```
Verify: `SELECT column_name FROM information_schema.columns WHERE table_name='system_logs' AND column_name IN ('event_type','ip_address','identifier_hash','user_agent');` returns 4 rows. Rollback: drop the two indexes, then the four columns.

`action_type` stays a readable sentence, so the current admin table still makes sense.

## 4. Events

| `event_type` | `action_type` text | Logged when |
|---|---|---|
| `login_failed` | Failed sign-in attempt | Wrong password or unknown account. `user_id` only if the account exists |
| `login_locked` | Sign-in locked after repeated failures | Once, when a lockout starts |
| `login_success` | existing text | Existing call, now with the new fields |
| `otp_failed` | Wrong sign-in verification code | Login code check fails |
| `activation_requested` | Account activation requested | Eligible roster match |
| `activation_no_match` | Account activation requested (no roster match) | Unknown ID |
| `activation_skipped` | Account activation requested (already active or inactive) | Those cases |
| `activation_verify_failed` | Wrong activation code | Verify fails |
| `activation_completed` | Account activated | Success (`user_id` set) |
| `visit_burst` | Unusually many page loads from one address | Threshold crossed, once per window |

The four activation-request outcomes each write **exactly one row**, so timing stays the same across outcomes. These details stay in the admin log. Responses to the client stay generic.

## 5. What is stored, and what never is

- **Stored:** event type, time, IP (from the existing client-IP helper), user agent (CR/LF and control characters removed, cut to 200), `user_id` when an account exists, `identifier_hash`.
- `identifier_hash` = first 16 hex characters of `hash_hmac('sha256', normalized_identifier, APP_SECRET)`. Keyed, because a plain hash of an 8-digit student number can be reversed.
- **Never stored:** passwords, codes, tokens, session IDs, the raw identifier typed at login (it may be a password typed in the wrong box), request bodies.
- Everything shown in the dashboard is escaped (`escapeHtml` or `textContent`), including the user agent.
- Logging must **never break sign-in or activation**: wrap it in try/catch and fall back to `error_log`.
- The extended `insertLog` must add the new columns to its INSERT **only when a new value is passed**, so old callers and an unmigrated database keep working.

## 6. Flag rules (computed when the admin opens the view)

No scheduler. SQL runs over recent rows. Thresholds are named constants at the top of `SecurityLogRepository`, so they are easy to tune.

| # | Rule | Window | Severity |
|---|---|---|---|
| R1 | 10 or more `login_failed` from one IP | 15 min | Medium |
| R2 | 5 or more different `identifier_hash` values from one IP (`login_failed`, `activation_no_match`) | 15 min | High |
| R3 | One account (`user_id` or `identifier_hash`) failing from 5 or more different IPs | 60 min | High |
| R4 | `login_success` for an account after 3 or more `login_failed` for it | 15 min before | High (review: may be the owner) |
| R5 | 3 or more `login_locked` events | 60 min | Medium |
| R6 | 10 or more `activation_no_match` from one IP | 15 min | High |
| R7 | 5 or more `otp_failed` or `activation_verify_failed` for one account or ID | 15 min | Medium |
| R8 | 3 or more `login_failed` with an empty or script-like user agent (curl, python, go-http, java, okhttp, axios, node) | 15 min | Low |
| R9 | 1 or more `visit_burst` from one IP | 60 min | Low |

A campus Wi-Fi network can put many students behind one public IP, so R1, R5 and R9 alone prove little. R2, R3 and R6 are more reliable.

## 7. Safeguards against floods

- **Row cap:** before inserting `login_failed`, count that IP's rows from the last 15 minutes. At 20 or more, skip the insert (30 for `activation_no_match`). The rule thresholds stay below these caps.
- **Retention:** delete security rows (non-null `event_type`) older than 90 days, on about 1 in 100 inserts. Never touch reservation audit rows. IPs are personal data: Admin-only, and the school's data protection officer should confirm the period.
- **Page loads:** in `GET /api/auth/csrf`, count per IP in a 60-second window. Flag at 120 (one `visit_burst` row per window). Hard block at 600 with the generic 429, **before a session is started or written**.
- **Sessions table:** with `SESSION_DRIVER=db`, each cookie-less request may create a `sessions` row. Check this in `DbSessionHandler`, and make sure stale rows are cleaned up (about 1 in 100 requests).

## 8. Admin dashboard changes (`admin-governance.html`, `admin-dashboard.js`)

1. A **Security alerts** panel above the audit table: one card per flag with a plain title ("One address tried many accounts", "Many page loads from one address"), a severity label (text and icon, not color alone), the count, the time window, and a "View events" button that filters the table to that IP or account. With no flags: "No suspicious activity in the last 24 hours."
2. A **scope selector**: Activity (default), Security events, Everything.
3. Two new columns in the security views: *Event* (readable label) and *Address* (IP). The *Account* column shows the actor name when known, otherwise "Unknown account" plus the first 8 characters of the hash.
4. A **Refresh** button.
5. **Fix two existing bugs:** the table reads `user_name` but the API returns `actor_name`; the reservation-details code treats the response as an array when it is `{ items, total, limit, offset }`.

`scope=activity` is the default: rows where `event_type` is null or `login_success` or `activation_completed`, so today's view barely changes.

**Staff dashboard: no change.** `/api/logs` and `/api/logs/alerts` stay Admin-only (Staff get 403). Staff keep per-reservation history, which never contains these rows. IPs are personal data and staff do not administer accounts.

## 9. Slices

**Rules for the agent, for every slice:** read only the files named in that slice. No database writes, no migrations run, no seeds. Do not read or print `.env`. Stage files by name (never `git add .`). One commit per numbered step. Final reply: max 8 lines. Run `php -l` and `node --check` on changed files.

### Slice 1: foundation and sign-in logging (small, do first)
1. Write `migrations/2026-10-11_security_log_columns.sql` from section 3 (do not run it).
2. Extend `ReservationRepository::insertLog()`: nullable `$userId`, optional trailing `$eventType`, `$ip`, `$identifierHash`, `$userAgent` (section 5 rule on the INSERT).
3. Create `src/Core/SecurityLog.php` with `record(event, message, ?userId, ?identifier)`: IP via the existing client-IP helper, user agent cleaned, keyed hash, row cap, retention purge, never throws.
4. In `AuthController::login`: log `login_failed`, `login_locked` (once per lockout), and pass the new fields to the existing success log as `login_success`.

### Slice 2: verification and activation logging
Log `otp_failed` in `AuthController`, and the activation events in `ActivationController` (one row per outcome, section 4).

### Slice 3: read side
Filters `scope`, `event_type`, `ip` in `findLogs` and `countLogs`; read them in `UserController::logs()`; return the new columns. New `SecurityLogRepository::findAlerts()` (R1 to R8) and route `GET /api/logs/alerts` (Admin only).

### Slice 4: dashboard
Section 8, including the two bug fixes.

### Slice 5: page-load bursts and sessions
Section 7 (page loads and sessions table) plus rule R9 and its panel label.

## 10. Human test checklist

**After Slice 1** (apply the migration first, after a backup):
1. Three wrong passwords for a real account: three `login_failed` rows with your IP, the account's name, and no password text anywhere in the row.
2. A successful sign-in writes a row with `login_success`.
3. Fifty failed attempts from one IP: no more than 20 `login_failed` rows from that IP.
4. Sign-in works if the migration has not been applied yet.

**After Slice 3 and 4:**
5. Lower one threshold constant, trigger it, and confirm the alert appears and "View events" filters correctly.
6. Send a failed sign-in with the user agent `<script>alert(1)</script>` (for example with curl): it shows as plain text in the table.
7. A staff account calling `GET /api/logs` gets 403. A reservation's history shows no security rows.

**After Slice 5:**
8. Reload the login page 150 times in a minute (script it): one `visit_burst` row, not 150. Check that the `sessions` table did not grow by 150 rows.

## 11. Open decisions (defaults in brackets)

Retention [90 days]. Should staff see anything [no]. An email to the admin on a High alert [later, using the existing mailer]. Geo-IP or reputation lookups [no: they need an outside service].
