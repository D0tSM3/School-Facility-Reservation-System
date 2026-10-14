# Activation, security logging, and visitor privacy

This document describes the implementation in the current source tree. Endpoint behavior is routed from `public/index.php`; the authoritative policy and persistence logic are in `src/`.

## Account activation

1. The person enters an 8-digit school ID matching `19` or `20` followed by six digits. Its four-digit year must not be in the future.
2. The server checks for a current `school_directory` row, validates its email against `ALLOWED_EMAIL_DOMAIN`, and rejects IDs already associated with a user. No email address is accepted from the request.
3. If eligible, a random six-digit code is sent to the roster email. Ineligible, unknown, malformed, already-activated, and inactive cases receive the same generic `202` response. Activation does not use reCAPTCHA; it uses request protection and rate limiting.
4. A valid code is consumed once. Only then is short-lived verified activation state created in the session; the context endpoint reveals the name and a masked email.
5. The person chooses and confirms a password. A user is created transactionally with the roster's name, email, person type and school ID, and the `Customer` role. The flow does not sign the person in; it sends them to sign in.

The activation ID/code path is protected by a CSRF token, same-origin check, and JSON-only POST requirement. The activation request response is padded to a 1.5-second floor. Verification state expires after 15 minutes. The six-digit code defaults to a 10-minute lifetime (configurable from 60 to 3,600 seconds) and five guesses (configurable from one to ten); a replacement code request for an eligible ID invalidates its previous active code.

### Activation and related endpoints

| Method and path | Access and behavior |
|---|---|
| `GET /api/auth/csrf` | Starts the CSRF/session flow; counts page-load requests and returns a CSRF token. `?page=login` or `?page=activate` also records an aggregate visitor hit. |
| `POST /api/auth/activate/request` | Protected JSON POST; accepts `student_id`; sends a code only when eligible; always gives the generic response. |
| `POST /api/auth/activate/verify` | Protected JSON POST; checks `student_id` and six-digit `otp`, consumes a valid code and establishes verified session state. |
| `GET /api/auth/activate/context` | Requires verified activation state; returns the name, masked email, person type, remaining state lifetime, and password length bounds. |
| `POST /api/auth/activate/complete` | Protected JSON POST; accepts `password` and `password_confirm`; creates the Customer account but does not log in. |

## Password policy and hashing

Activation and password-reset passwords are checked by `PasswordPolicy`:

- 15–128 Unicode code points; leading or trailing whitespace is rejected.
- No character-composition rule is imposed.
- Rejects repeated-character or repeated-block values, any ascending or descending five-character run of ASCII letters or digits, a built-in common-password list, and passwords containing the school ID, a full-name token of at least four code points, an email local part of at least four code points, the first label of `ALLOWED_EMAIL_DOMAIN`, or `campusroom`.
- When local checks pass, checks the password through the Have I Been Pwned range API using the first five SHA-1 hex characters. The password itself is not sent. The check fails open if cURL is unavailable or the service errors/times out (two-second request timeout).

New activation passwords are hashed with Argon2id. Login upgrades older hashes to Argon2id when needed. Activation codes are not stored as plaintext: the code hash is HMAC-SHA-256 over `school_id|code`, using a key derived from `APP_SECRET` with the fixed context `activation-otp-v1`.

## Security logs

The `system_logs` migration adds nullable `event_type` (`varchar(40)`), `ip_address` (`varchar(45)`), `identifier_hash` (`char(16)`), and `user_agent` (`varchar(200)`) columns, plus indexes on `(event_type, timestamp DESC)` and `(ip_address, timestamp DESC)`. Existing `action_type` text remains the readable event description.

Event types emitted by the current code:

| Event type | Meaning |
|---|---|
| `login_failed` | Unknown account, inactive account, or incorrect password |
| `login_locked` | Login lockout begins |
| `login_success` | Login verification succeeded and a session was started |
| `otp_failed` | Login verification code was wrong or expired |
| `activation_requested` | Eligible roster entry requested a code |
| `activation_no_match` | No matching eligible roster entry; the repository currently returns the same ineligible result for other rejected roster cases. |
| `activation_skipped` | A controller branch exists for already-active/inactive results, but the current repository does not return those result keys, so this event is not emitted by the current repository flow. |
| `activation_verify_failed` | Activation code check failed |
| `activation_completed` | Account activation completed |
| `visit_burst` | A page-load counter crossed the logging threshold |

Identifier hashes are keyed HMACs; raw login/activation identifiers, passwords, codes, and session tokens are not stored in these event fields. The user agent is stripped of control characters and truncated to 200 characters. The IP address is stored in security rows for investigation.

### Admin log endpoints

| Method and path | Behavior |
|---|---|
| `GET /api/logs/alerts` | Admin-only; computes the nine alert rules below from recent security events and returns at most 20 items. |
| `GET /api/logs/visitors` | Admin-only; returns today's aggregate page loads, distinct daily hashes, page totals, and up to five repeat-hash summaries. |
| `POST /api/logs/visitors/lookup` | Admin-only; accepts a valid IPv4 or IPv6 `ip`, derives its daily hashes for the latest 30 days, and returns matching day/page aggregates. Raw visitor IPs are not kept in `visitor_days`. |
| `GET /api/logs` | Admin-only audit-log query; supports `scope`, `event_type`, `ip`, reservation/user IDs, date range, text query, limit, and offset. |

### Alert rules and current thresholds

Rules are evaluated when the Admin requests alerts; they do not automatically block accounts. Results are severity-ordered and capped at 20.

| Rule | Trigger | Window | Severity |
|---|---|---|---|
| R1 | At least 10 `login_failed` events from one IP | 15 minutes | Medium |
| R2 | At least 5 distinct identifier hashes from one IP across `login_failed` and `activation_no_match` | 15 minutes | High |
| R3 | One account/identifier has failures from at least 5 distinct IPs | 60 minutes | High |
| R4 | A `login_success` follows at least 3 `login_failed` events for the account | 15 minutes before success | High |
| R5 | At least 3 `login_locked` events from one IP | 60 minutes | Medium |
| R6 | At least 10 `activation_no_match` events from one IP | 15 minutes | High |
| R7 | At least 5 `otp_failed` or `activation_verify_failed` events for one account/identifier | 15 minutes | Medium |
| R8 | At least 3 `login_failed` events from one IP with an empty or script-like user agent (`curl`, `python`, `go-http`, `java`, `okhttp`, `axios`, or `node`) | 15 minutes | Low |
| R9 | At least 1 `visit_burst` event from one IP | 60 minutes | Low |

The event writer also suppresses excess duplicate rows per IP/event in a 15-minute period: 20 by default, 20 for `login_failed`, and 30 for `activation_no_match`. `login_success`, `activation_completed`, `login_locked`, and `visit_burst` are exempt.

## Visitor summaries, privacy, and retention

`POST /api/visit?page=landing|login|activate` is a public, no-session endpoint. Unsupported pages receive no content. Accepted hits are keyed by page, calendar day, and a daily HMAC of the client IP; the row stores the 16-hex-character hash, browser family, hit count, and first/last timestamps, not the raw IP or full user agent. The HMAC key is derived from `APP_SECRET`, and hashes are different by day. Summaries are approximate network/browser aggregates, not unique-person counts.

`visitor_days` has primary key `(day, visitor_hash, page)` and accepts only the three public pages and the browser-family values `Chrome`, `Firefox`, `Safari`, `Edge`, and `script/other`. At most 10,000 new summary rows are admitted per day; hits to an existing row continue to increment. Admin repeat summaries use a five-hit minimum and return at most five hashes. Visitor rows older than the 30-day cutoff are purged opportunistically, on about 1 in 100 visitor records.

The visitor endpoint also counts requests per IP in a 60-second window, records `visit_burst` at 120 requests, and returns HTTP 429 at 600. The CSRF endpoint uses the same thresholds for its own counter.

Security event rows are cleaned up opportunistically, on about 1 in 100 security-log writes. Non-null `event_type` rows other than `login_success` and `activation_completed` are deleted after 90 days. Those two success event types remain, but their IP, user-agent, and identifier-hash fields are nulled after 90 days. Reservation/activity rows with a null `event_type` are not part of this cleanup.

The public landing and activation pages display this privacy notice: “For security, we record your browser type and a scrambled version of your network address for 30 days. If you try to sign in or suspicious activity is detected, your network address may be kept in security logs for up to 90 days.”

## Inactivity timeout

The client-side `public/js/inactivity.js` signs the user out after 15 minutes without pointer, keyboard, scroll, touch, or input activity. It warns one minute before logout, calls `/api/auth/logout`, clears the client-side role hint, and redirects to sign-in. This is a browser-side timeout, not a server-enforced idle-session expiry.

## Environment variables read by application and utility PHP code

Names only; no values are included here. “Production required” means required for secure production operation or for the associated production feature to work. Optional values use code defaults or enable optional behavior.

| Variable name | Production requirement |
|---|---|
| `ACTIVATION_OTP_MAX_ATTEMPTS` | Optional |
| `ACTIVATION_OTP_TTL_SECONDS` | Optional |
| `ALLOWED_EMAIL_DOMAIN` | Required |
| `APP_ENV` | Required; set to `production` |
| `APP_ORIGIN` | Required |
| `APP_SECRET` | Required |
| `APP_TIMEZONE` | Optional |
| `DB_HOST` | Required |
| `DB_NAME` | Required |
| `DB_PASSWORD` | Required |
| `DB_PORT` | Required |
| `DB_USER` | Required |
| `RECAPTCHA_ENABLED` | Optional; conditional when reCAPTCHA is used |
| `RECAPTCHA_SECRET_KEY` | Optional; required when reCAPTCHA is enabled |
| `RECAPTCHA_SITE_KEY` | Optional; required when reCAPTCHA is enabled |
| `SESSION_DRIVER` | Optional |
| `SMTP_FROM` | Optional |
| `SMTP_HOST` | Required for production email |
| `SMTP_PASS` | Required for production email unless `SMTP_PASSWORD` is set |
| `SMTP_PASSWORD` | Required for production email unless `SMTP_PASS` is set |
| `SMTP_PORT` | Optional |
| `SMTP_USER` | Required for production email |
| `VERCEL` | Platform-provided/optional outside Vercel |

`APP_SECRET` must contain at least 32 characters. `APP_ORIGIN` is the exact site origin used by protected POSTs. The two SMTP password names are alternatives; configure one, not both necessarily. reCAPTCHA is not used for activation requests.

## Migration inventory

The repository has no migration ledger, so this table is not a fresh database inspection. `2026-10-10_activation.sql` is recorded as applied in the activation verification notes; the remaining forward migrations are listed as applied per project-owner confirmation. The grants migration is **not applied**, as stated by the project owner. Verify/rollback files are support scripts, not forward migrations.

| Migration file | Status |
|---|---|
| `migrations/2026-09-20_customer_remove_and_cancel_requests.sql` | Applied |
| `migrations/2026-09-20_rename_cancellation_requests.sql` | Applied |
| `migrations/2026-09-20_reservation_category.sql` | Applied |
| `migrations/2026-09-20_sync_reservation_schema.sql` | Applied |
| `migrations/2026-09-30_conflict_override_requests.sql` | Applied |
| `migrations/2026-09-30_reservation_series.sql` | Applied |
| `migrations/2026-09-30_system_settings.sql` | Applied |
| `migrations/2026-10-02_archived_records.sql` | Applied |
| `migrations/2026-10-02_auto_approval.sql` | Applied |
| `migrations/2026-10-02_special_approval.sql` | Applied |
| `migrations/2026-10-03_auth_rate_limits.sql` | Applied |
| `migrations/2026-10-05_class_conflict_resolution.sql` | Applied |
| `migrations/2026-10-05_sessions.sql` | Applied |
| `migrations/2026-10-10_activation.sql` | Applied |
| `migrations/2026-10-10_activation_rollback.sql` | Not applied; manual rollback only |
| `migrations/2026-10-10_activation_verify.sql` | Not applied; verification query script |
| `migrations/2026-10-10_revoke_public_grants.sql` | **Not applied** |
| `migrations/2026-10-11_security_log_columns.sql` | Applied |
| `migrations/2026-10-14_visitor_days.sql` | Applied |
| `migrations/2026-10-14_visitor_days_rollback.sql` | Not applied; manual rollback only |

## Known limitations

- Activation supports only the implemented 8-digit `19`/`20` school-ID format; other staff/faculty identifier formats are not supported by this flow.
- Login and password-reset verification codes continue to use the legacy `users.otp_code` field and are stored as plaintext. Expiration rejects a code but does not itself clear the stored value; successful verification/reset or replacement clears/replaces it.
- The HIBP breach check fails open when its network dependency is unavailable.
- Activation request/verification use response-time padding, not a constant-time guarantee.
- The controller has an `activation_skipped` log branch, but the current activation repository does not return the status keys that branch checks; ineligible roster results are consequently categorized as `activation_no_match`.
- Visitor summaries are approximate: an IP can represent multiple people, the browser family is heuristic, and daily hashes intentionally cannot identify a person across different days without an IP supplied to the Admin lookup.
- The public API-role grants-revocation migration has not been applied.
