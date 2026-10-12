# Password Validation Spec: Activation Flow

Scope: choosing a password at `POST /api/auth/activate/complete`, and the same server rules in password reset. **Login must not apply this policy** (old passwords stay valid).

## 0. Agent rules

- Read only what you need: `src/Core/PasswordPolicy.php`, `src/Controller/ActivationController.php` (`complete`, `context`), `src/Controller/AuthController.php` (`resetPassword` and the login password handling), `public/activate.html`, `public/js/activate.js`. No audits of anything else.
- No database writes, migrations or seeds. No network calls in tests. Do not read or print `.env`. No `composer update`.
- Stage files **by name**. Never `git add .`: the working copy has line-ending noise and unrelated uncommitted files (`inactivity.js`, `tmp.cookies`). One commit per task.
- Final reply: max 10 lines (files changed, deviations, anything not done).

## 1. The policy

Server is authoritative. The client mirrors only the cheap rules.

| Rule | Requirement | Code | Client |
|---|---|---|---|
| Input | Must be a string and valid UTF-8 | `invalid_input` | no |
| Min length | **15** code points. One constant, `PasswordPolicy::MIN_LENGTH`. The school may set 12 | `too_short` | yes |
| Max length | 128 code points. Checked **first**, before any hashing or network call | `too_long` | no |
| Composition | **None.** No required uppercase, digit or symbol | n/a | no |
| Edge whitespace | No leading or trailing whitespace. Spaces inside are allowed | `whitespace_edges` | yes |
| Repetitive | Reject one repeated character, a block repeated through the whole value, or a plain ascending or descending run such as `abcdefghijklmno` or `123456789012345` | `repetitive` | no |
| Personal | Case-insensitive: must not contain the school ID, any name token of 4+ characters, the email local part (4+ characters), the first label of `ALLOWED_EMAIL_DOMAIN` (for example `bpu`), or `campusroom` | `contains_personal` | name and ID only |
| Common | Keep the existing built-in list. With a 15-character minimum it matters little. The breach check is the real blocklist | `common` | no |
| Breached | Have I Been Pwned range API, see section 2 T1 | `breached` | no |
| Confirmation | `password === password_confirm` | `mismatch` | yes |

Order of checks: input, length, edge whitespace, repetitive, personal, common, **then** breached (the only network call). Skip the network call if any earlier check failed. Return **all** failing codes from the cheap checks. Hash with Argon2id only after every check passes.

## 2. Tasks

### T1. `PasswordPolicy.php`
- Add `public static function validateAll(string $password, array $context = [], bool $checkBreached = true): array`, returning a list of codes (empty means valid). `$context` holds `school_id`, `full_name`, `email`.
- Keep `validate(string $password): ?string` as a thin wrapper that returns the first message, so existing callers still work.
- Count length with code points (the existing `preg_match_all('/./us', ...)` approach). Do **not** trim, normalize or truncate. (`intl` is not available, so no normalization. See section 6.)
- Check `isBreached`. It must: SHA-1 the password, send only the first 5 hex characters to `https://api.pwnedpasswords.com/range/{prefix}` over HTTPS, send header `Add-Padding: true`, use a 2 second timeout, and **treat a suffix as breached only if its count is greater than 0** (padded decoy rows have count 0). Fail open on any network or HTTP error: log with `error_log` **without** the password or hash, and continue. Keep this lookup server-side only.
- Do not lower the Argon2id defaults. Report if hashing takes over 1 second in your test.

### T2. `ActivationController::context`
Return `policy: { min_length, max_length }` taken from the `PasswordPolicy` constants, alongside the existing `name`. The page must not hardcode the numbers.

### T3. `ActivationController::complete` and `AuthController::resetPassword`
- Call `validateAll` with the roster context (`school_id`, `full_name`, `email`). In reset, use the user's own `name` and `email`.
- On failure return **422** through the existing response envelope: error `Password does not meet requirements.`, and `data: { codes: [...] }`.
- `complete` also compares the confirmation field server-side.
- Never log or echo the password. Hash with Argon2id as today.

### T4. Login guard
Do **not** call the policy at login. Only add this: if the submitted password is longer than 256 bytes, fail with the same generic failure (still padded and rate-limit counted) **without** hashing.

### T5. `activate.html` and `activate.js`
Follow section 4.

### T6. Test script
Create `scripts/test_password_policy.php`: runs the cases in section 5 against `validateAll(..., checkBreached: false)`, prints PASS or FAIL per case, exits non-zero on any failure. No network, no database.

### T7. Docs
Update the "Password rules" row in `ACTIVATION_CHANGES.md` (section 6) and the open-items list (min length is now 15, personal-info check added).

## 3. Error contract

| Situation | Status | Body |
|---|---|---|
| Policy failure | 422 | `error: "Password does not meet requirements."`, `data.codes: [...]` |
| Session expired | 401 | generic expired message |
| Rate limited | 429 | generic wait message |
| Success | 201 | as today. No auto-login |

## 4. Frontend checklist

**Fields**
- Two `type="password"` inputs, each with a `<label for>`, `autocomplete="new-password"`, `required`, `spellcheck="false"`, `autocapitalize="off"`, `autocorrect="off"`.
- A visually hidden username field before them: `autocomplete="username"`, `readonly`, `tabindex="-1"`, `aria-hidden="true"`, value = the school ID the person entered. This lets password managers save the login. Hide it with a CSS class, not `display:none`.
- **Never** `autocomplete="off"`, and no `onpaste`, `oncopy` or `oncut` handlers. Paste must work.
- No `maxlength` below 256. The server enforces 128.

**Show or hide**
- A real `<button type="button">` with `aria-controls` (both fields), `aria-pressed`, and a label that changes between "Show password" and "Hide password". It controls both fields.

**Guidance**
- Requirements visible before typing (not only after a failure), linked with `aria-describedby`:
  - "At least {min_length} characters"
  - "No spaces at the start or end"
  - "Doesn't include your name or student number"
  - "Both passwords match" (shown once the confirm field has been touched)
- Each item shows an icon **and** text, so meaning never depends on color.
- Tip text: "A few unrelated words, like a short sentence, is easy to remember and hard to guess."
- Strength meter, advisory only, based on length: below the minimum = "Too short", minimum to 19 = "Okay", 20 or more = "Strong". Show a text label, update it about 400 ms after typing stops, and put it in a polite `aria-live` region so screen readers are not spammed. No composition scoring. No external library or CDN.

**Submit**
- The button stays **enabled**, except while a request is in flight. Do not disable it until valid (a disabled button gives no feedback).
- On submit run the client checks. If any fail: set `aria-invalid="true"` on the field, show each message next to it (linked by `aria-describedby`), show an error summary container with `role="alert"`, and move focus to the summary or first invalid field.
- Messages:

| Code | Message |
|---|---|
| `too_short` | Use at least {min} characters. |
| `too_long` | Use {max} characters or fewer. |
| `whitespace_edges` | Remove spaces at the start or end. |
| `contains_personal` | Don't include your name, student number or email. |
| `repetitive` | Avoid repeated or sequential characters. |
| `common` | That password is too common. Choose a less predictable one. |
| `breached` | This password has appeared in a data breach. Choose a different one. |
| `mismatch` | The two passwords don't match. |
| `invalid_input` | Enter a valid password. |

**After the response**
- 422: show the mapped messages, **keep the typed values** (the person is correcting them), focus the summary.
- 401: clear both fields, return to stage 1 with the expired message.
- 429: generic wait message, keep the fields.
- Success: clear both fields, redirect to login.

**Never** put the password in a URL, `console`, `localStorage`, `sessionStorage` or a long-lived variable.

## 5. Test cases (T6)

Context: `school_id=20269999`, `full_name="Maria Santos"`, `email=maria.santos@bpu.edu.ph`. Passwords marked `{n}` mean a string of that many characters.

| Password | Expected |
|---|---|
| 14 characters of random letters | `too_short` |
| 15 random lowercase words with spaces inside | valid |
| 128 characters | valid |
| 129 characters | `too_long` |
| a valid password with a leading space | `whitespace_edges` |
| a valid password with a trailing tab | `whitespace_edges` |
| `aaaaaaaaaaaaaaa` | `repetitive` |
| `abcdefghijklmno` | `repetitive` |
| `abcabcabcabcabc` | `repetitive` |
| `my-20269999-passphrase` | `contains_personal` |
| `blue-santos-river-table` | `contains_personal` |
| `blue-bpu-river-table-xx` | `contains_personal` |
| `correcthorsebatterystaple` | `common` |
| 15 emoji | valid (counts as 15) |
| invalid UTF-8 bytes | `invalid_input` |
| empty string | `too_short` |
| `{"password": 123}` style non-string (at the controller) | 422 |

## 6. Accepted deviations and open items

- **No Unicode normalization.** `intl` is not available. The standard says to normalize (NFC) when Unicode is accepted. Revisit once `intl` is guaranteed on every environment, and apply it at activation, reset **and** login together.
- **Edge whitespace is rejected.** The standards allow spaces. This one restriction exists because login previously trimmed passwords.
- **Breach check fails open** if the service is unreachable.
- Existing users with shorter passwords are **not** forced to reset.
- The email code at login does not lower the minimum: email is not accepted as a second authenticator, so the password counts as the only factor.
- Not included: passkeys, forced rotation, password hints, security questions.

## 7. Research basis

- **NIST SP 800-63B-4** (final, August 2025): 15 characters minimum when the password is the only authenticator, 8 only when it is part of multi-factor; allow at least 64; count code points; no composition rules; screen against a blocklist; no hints or security questions; no periodic rotation.
- **OWASP ASVS** (v4.0.x V2.1 and 5.0 V6.2) and the **OWASP Authentication Cheat Sheet**: allow 64+ characters but cap at 128, never silently truncate, allow Unicode and spaces, check against breached passwords, provide a strength meter, permit paste and password managers, set a maximum length to avoid denial-of-service.
- **Have I Been Pwned Pwned Passwords API**: send only the first 5 characters of the SHA-1 hash, use the `Add-Padding` header, and ignore the padded zero-count rows.
- **WCAG 2.2 SC 3.3.8** (Accessible Authentication): do not block paste or autofill, allow a show-password toggle, associate error messages with their fields and move focus to the first error.
