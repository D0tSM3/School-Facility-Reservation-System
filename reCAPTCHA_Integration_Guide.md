# CampusRoom — Google reCAPTCHA Integration Guide

**Status: IMPLEMENTED 2026-09-20.** v2 checkbox, live on login, register and
resend-otp. The sections below are the original plan; §10 records what was
actually built and the two things you must know to operate it.

> ### Read this first
>
> **1. Login now requires the checkbox.** If `localhost` and `127.0.0.1` are
> not both registered as domains for this site key in the reCAPTCHA console,
> the widget will refuse to render and **nobody will be able to sign in**.
> If that happens, the one-line escape is in `.env`:
> ```ini
> RECAPTCHA_ENABLED=false
> ```
> No restart needed — it is read per request.
>
> **2. The automated suites must run with it off.** They post to the auth
> routes without tokens. The test harness rewrites `RECAPTCHA_ENABLED=false`
> into the scratch `.env`; keep that when adding new suites.

---

## 1. Is it possible?

Yes. Nothing about this stack makes it awkward:

| Requirement | This project |
|---|---|
| A server that can make an outbound HTTPS call | PHP 8.2 under XAMPP; cURL is compiled in |
| A place to keep a secret out of the client | `.env` via `vlucas/phpdotenv`, already gitignored |
| Form submissions that go through one choke point | `AuthController` — every auth route lands there |
| A JSON error convention the widget can report into | `Response::error($msg, $code)`, already used everywhere |
| A public domain registered with Google | `localhost` is accepted by the reCAPTCHA console |

The work is roughly a day: one new `Core` class, three controller hooks, two
form changes, and the test-harness accommodation in §6.

---

## 2. Which version — v2 or v3?

**Use v2 "I'm not a robot" checkbox.**

| | v2 checkbox | v3 score |
|---|---|---|
| What the user sees | A checkbox they tick | Nothing |
| What the server gets | pass / fail | A score 0.0–1.0 you must threshold |
| Tuning needed | None | Yes — and a wrong threshold silently locks out real users |
| Demonstrable to a panel | Yes, visibly | No, it's invisible |
| Works on `localhost` | Yes | Yes |

For an academic project that has to be *shown working*, v3's invisibility is a
liability: you cannot demonstrate a defence nobody can see, and a bad threshold
fails closed on real students with no visible cause. v2 is also less code —
there is no score to interpret, only `success: true|false`.

Everything below assumes v2 checkbox.

---

## 3. Where it belongs — and where it does not

Protect the three **unauthenticated** endpoints. Everything else already sits
behind `Auth::requireRole()`, where a session is the gate and a CAPTCHA adds
friction without adding safety.

Ranked by how exposed they actually are today:

### 3.1 `POST /api/auth/resend-otp` — the sharpest need

`AuthController::resendOtp()` issues a fresh OTP and calls `Mailer::sendOtp()`,
which sends a **real email through SMTP**, with no limit of any kind. Anyone
who knows a classmate's address can send them unlimited mail from the
University's own SMTP account. That is the one endpoint where the absence of
protection is actively abusable right now.

### 3.2 `POST /api/auth/register`

Bot signups. Partially mitigated already by `ALLOWED_EMAIL_DOMAIN=bpu.edu.ph`
(added 2026-09-20), which means an attacker needs a `@bpu.edu.ph` address — but
that restricts *who*, not *how many*.

### 3.3 `POST /api/auth/login`

Credential stuffing and password brute force. `login()` will answer
`Invalid email or password.` as fast as you can ask it, indefinitely.

### Do NOT put it on

- Any `/api/reservations/*`, `/api/rooms/*`, `/api/classes`, `/api/logs` route —
  all authenticated; a CAPTCHA on "submit a booking" punishes real users.
- `POST /api/auth/verify-otp` — the six-digit code plus its expiry is already the
  challenge. Adding a second one makes the sign-up flow hostile.
- `POST /api/auth/logout`.

---

## 4. Two traps specific to this repo

### 4.1 The `.env` already has `GOOGLE_*` keys that are NOT reCAPTCHA keys

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=...
```

These are leftovers from the Google **OAuth sign-in** that was removed —
`AuthController`'s own header says *"Google OAuth has been removed in favour of a
native signup/login flow."* A grep confirms nothing in `src/` or `public/` uses
them.

Name the new keys unambiguously so nobody wires the wrong pair:

```ini
RECAPTCHA_SITE_KEY=
RECAPTCHA_SECRET_KEY=
```

While you are there, consider deleting the three dead `GOOGLE_*` lines and
dropping `league/oauth2-google` from `composer.json`. It is unused.

### 4.2 Do not build on Guzzle — it is only here by accident

`vendor/guzzlehttp/` exists, but it is a **transitive dependency of
`league/oauth2-google`**, not a direct requirement. `composer.json` requires
only `vlucas/phpdotenv`, `league/oauth2-google`, and `phpmailer/phpmailer`.
Remove the dead OAuth package (§4.1) and Guzzle vanishes with it, taking your
reCAPTCHA verification down.

Use **cURL**, which ships with XAMPP's PHP and adds no dependency. The project
makes no outbound HTTP calls today, so this is the first one either way.

---

## 5. Implementation plan

### Phase 1 — Get the keys (10 minutes, no code)

1. Sign in at <https://www.google.com/recaptcha/admin/create>.
2. Label: `CampusRoom`. Type: **reCAPTCHA v2 → "I'm not a robot" Checkbox**.
3. Domains: add `localhost` **and** `127.0.0.1`. Add the real hostname too if
   this is ever deployed.
4. You get a **Site key** (public, goes in HTML) and a **Secret key**
   (server-only, never leaves `.env`).

### Phase 2 — Configuration

Add to `.env` (gitignored — confirm with `git check-ignore .env`):

```ini
RECAPTCHA_SITE_KEY=<site key>
RECAPTCHA_SECRET_KEY=<secret key>
RECAPTCHA_ENABLED=true
```

Add the same three keys to `env.example` with **empty values**, so the next
person knows they exist. `env.example` is committed; `.env` is not.

Do **not** add them to `$dotenv->required([...])` in `public/index.php` — that
list is `DB_*` only, and making reCAPTCHA required would hard-fail the whole app
for anyone who has not set it up yet.

### Phase 3 — A verifier class

New file `src/Core/Recaptcha.php`, following the shape of the existing `Core`
helpers (`Mailer`, `DateTimeHelper` — small, static, no state):

```php
<?php
declare(strict_types=1);

namespace CampusRoom\Core;

/**
 * Recaptcha — server-side verification of a v2 checkbox token.
 *
 * The secret key never leaves this class. A token is single-use and expires
 * about two minutes after the user ticks the box.
 */
final class Recaptcha
{
    private const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

    /** Off in test/CI so the suite can post to the auth routes (see the guide, §6). */
    public static function enabled(): bool
    {
        return filter_var($_ENV['RECAPTCHA_ENABLED'] ?? 'false', FILTER_VALIDATE_BOOLEAN)
            && !empty($_ENV['RECAPTCHA_SECRET_KEY']);
    }

    /**
     * @return string|null null when the token is good; otherwise the reason to
     *                     show the user.
     */
    public static function check(?string $token, ?string $remoteIp = null): ?string
    {
        if (!self::enabled()) {
            return null;
        }
        $token = trim((string) $token);
        if ($token === '') {
            return 'Please confirm you are not a robot.';
        }

        $post = [
            'secret'   => (string) $_ENV['RECAPTCHA_SECRET_KEY'],
            'response' => $token,
        ];
        if ($remoteIp) {
            $post['remoteip'] = $remoteIp;
        }

        $ch = curl_init(self::VERIFY_URL);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => http_build_query($post),
            CURLOPT_TIMEOUT        => 5,
            CURLOPT_CONNECTTIMEOUT => 3,
        ]);
        $raw  = curl_exec($ch);
        $err  = curl_error($ch);
        curl_close($ch);

        // Google unreachable. FAIL CLOSED — see the guide, §7.
        if ($raw === false) {
            error_log('[CampusRoom] reCAPTCHA unreachable: ' . $err);
            return 'Verification is temporarily unavailable. Please try again shortly.';
        }

        $body = json_decode((string) $raw, true);
        if (!is_array($body) || empty($body['success'])) {
            $codes = is_array($body['error-codes'] ?? null) ? implode(',', $body['error-codes']) : 'unknown';
            error_log('[CampusRoom] reCAPTCHA rejected: ' . $codes);
            // Deliberately generic: the error codes are for the log, not the user.
            return 'Verification failed. Please tick the box and try again.';
        }

        return null;
    }
}
```

### Phase 4 — Controller hooks

In `AuthController`, add the check **before any expensive or side-effecting
work** — before `password_hash()`, before `password_verify()`, and above all
before `Mailer::sendOtp()`. The point is to reject the bot *cheaply*.

`register()` — insert immediately after `$body = $this->jsonBody();`, ahead of
the field validation:

```php
$captchaError = Recaptcha::check($body['recaptcha_token'] ?? null, $_SERVER['REMOTE_ADDR'] ?? null);
if ($captchaError !== null) {
    Response::error($captchaError, 400);
}
```

Repeat the same three lines in `login()` and `resendOtp()`. Add
`use CampusRoom\Core\Recaptcha;` to the imports.

Use **400**, not 422 — 422 in this codebase means "your fields are wrong", and
the frontend maps it to per-field messages. A failed CAPTCHA is not a field
error.

### Phase 5 — Frontend

`public/index.html` carries both forms: `#loginForm` (around line 249) and
`#registerForm`. In `<head>`, once:

```html
<script src="https://www.google.com/recaptcha/api.js" async defer></script>
```

Inside each form, above the submit button:

```html
<div class="g-recaptcha" data-sitekey="YOUR_SITE_KEY"></div>
```

> The site key is public by design, but hardcoding it in HTML means changing it
> in two files. Cleaner: render it into a `<meta name="recaptcha-site-key">` tag
> or expose it from a tiny `GET /api/config` endpoint, and have `auth.js` create
> the widget. Either is fine; pick one and be consistent.

In `public/js/auth.js`, both handlers already build a JSON body. Add the token:

```js
// register — currently: body: JSON.stringify({ name: fullName, email, password })
body: JSON.stringify({
  name: fullName, email, password,
  recaptcha_token: window.grecaptcha ? grecaptcha.getResponse() : ''
})
```

**Reset the widget after every failed submit.** A token is single-use; if you do
not reset, the user's second attempt fails with a confusing message even when
they fixed the real problem:

```js
.then(({ status, json }) => {
  if (status === 201) { /* … existing success path … */ }
  else {
    if (window.grecaptcha) grecaptcha.reset();   // ← add this
    showRegisterError(json.error || '…');
  }
})
```

Do the same in the login handler, which resets to widget index `1` if both
widgets are on the page — `grecaptcha.reset(1)`. Simpler alternative: put the
two forms' widgets in explicit render mode with named IDs.

---

## 6. This will break the test suite — plan for it

**This is the most likely thing to go wrong.** The project has ~238 automated
checks, and a large number of them authenticate:

```js
fetch(API + '/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
```

Every one of those posts **without a token**. The moment reCAPTCHA is mandatory,
they all fail at login and cascade into hundreds of false failures that look
like application bugs.

Two mitigations — use **both**:

**a) `RECAPTCHA_ENABLED=false` in the test environment.** The suites already
generate their own `.env` with `DB_NAME` rewritten to `campusroom_scratch`.
Extend that rewrite to also force `RECAPTCHA_ENABLED=false`. The `enabled()`
guard above then short-circuits `check()` to `null`.

**b) Google's official always-pass test keys**, for when you *do* want the full
path exercised end to end:

```
Site key:   6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI
Secret key: 6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe
```

These always return `success: true` for any token and show a "this is for
testing only" banner on the widget. **Never ship them** — they accept
everything, which is worse than no CAPTCHA because it looks protected.

Then add one new suite that verifies the feature itself:

- with `RECAPTCHA_ENABLED=false` → login succeeds with no token (regression guard)
- with it enabled and no token → 400, and the message mentions the robot check
- with it enabled and a garbage token → 400
- with the test keys and any token → 200
- `resend-otp` with no token → 400 **and no email is sent** (assert `Mailer` was
  not reached — this is the whole point of §3.1)

---

## 7. Decisions to make before writing code

**Fail open or fail closed when Google is unreachable?** The sketch in Phase 3
fails **closed**: no verification, no signup. On a campus network or a flaky
connection that means legitimate students are blocked by an outage on Google's
side. Failing open means an attacker who can block your server's egress turns
the CAPTCHA off. There is no free answer. A reasonable split: fail **closed** on
`register` and `resend-otp` (abuse is costly there), fail **open** on `login`
(the password is still required). Decide deliberately and write it down.

**reCAPTCHA is not rate limiting.** The project currently has **none** — a grep
for rate/throttle/attempt logic across `src/` returns nothing. A CAPTCHA raises
the cost of the *first* request; it does not stop someone who solves one from
hammering afterwards, and it does nothing against a distributed attempt. If the
real goal is "stop brute force on login", the higher-value fix is a per-account
and per-IP attempt counter with backoff, with the CAPTCHA appearing only after
N failures. That also spares every normal user the checkbox.

**Privacy.** reCAPTCHA sends visitor data to Google and sets cookies. For a
university system handling student accounts, that may need a line in whatever
privacy notice the project carries, and is worth a sentence to your adviser.

---

## 8. Pre-flight checklist

- [ ] Keys obtained; `localhost` **and** `127.0.0.1` both registered
- [ ] `RECAPTCHA_SITE_KEY` / `RECAPTCHA_SECRET_KEY` / `RECAPTCHA_ENABLED` in `.env`
- [ ] Same three keys, empty, in `env.example`
- [ ] `git check-ignore .env` confirms `.env` is ignored
- [ ] Secret key appears in **no** file under `public/`
- [ ] Not added to `$dotenv->required([...])`
- [ ] Dead `GOOGLE_*` keys removed, `league/oauth2-google` dropped (optional but advised)
- [ ] Verification uses cURL, not the transitive Guzzle
- [ ] Check runs before `password_hash` / `password_verify` / `Mailer::sendOtp`
- [ ] Test env forces `RECAPTCHA_ENABLED=false`
- [ ] Widget resets on every failed submit
- [ ] Fail-open vs fail-closed decided per endpoint and written down
- [ ] New suite covers enabled/disabled, missing token, bad token, and "no email sent"

---

## 9. Files this will touch

| File | Change |
|---|---|
| `.env` / `env.example` | three new keys |
| `src/Core/Recaptcha.php` | **new** — the verifier |
| `src/Controller/AuthController.php` | three hooks + one `use` |
| `public/index.html` | script tag + two widget divs |
| `public/js/auth.js` | token in both payloads + reset on failure |
| test harness | force `RECAPTCHA_ENABLED=false`; new suite |

No database migration. No schema change. Nothing in the reservation, room,
class-schedule or handbook code is affected.

---

## 10. What was actually built

### Deviations from the plan above

**A `GET /api/config` endpoint was added.** The plan floated hardcoding the
site key in markup or rendering a meta tag. Neither works here: `index.html` is
static and served by Apache, so there is no server-side render step, and
hardcoding would put the key in two files. `AuthController::config()` returns
`{recaptcha_enabled, recaptcha_site_key}` — public values only — and the
frontend renders the widget from that. `.env` stays the single source.

**Widgets render explicitly, not automatically.** Because the key arrives
asynchronously, `auth.js` injects the reCAPTCHA script with
`?onload=…&render=explicit` and calls `grecaptcha.render()` per container,
keeping the widget ids for a precise `reset()`. With reCAPTCHA disabled nothing
is injected at all and the forms are byte-for-byte as they were.

**`verify.html` got its own copy of that logic.** It has an inline script and
does not load `auth.js`, so the resend path is wired separately.

### Fail-open / fail-closed, as decided

| Route | Behaviour when **Google is unreachable** |
|---|---|
| `register` | **Closed** — refuses. Creating accounts is costly enough to lose |
| `resend-otp` | **Closed** — refuses. It sends real mail |
| `login` | **Open** — allowed through; the password is still required, and one outage should not lock out the university |

A token that is *present and rejected* always fails, on every route, regardless.

### Discovered while integrating

**There is no registration UI.** No page in `public/` contains `#registerForm`
— the whole registration block in `auth.js` is dead code, and it still
references `department` and `idNumber` fields the README says were cut. The
`POST /api/auth/register` endpoint works and is now protected, but nothing in
the interface calls it. The token wiring is in place for when that page is
built; until then, registration happens only by direct API call or seeding.

**`verify.html`'s 30-second resend cooldown is client-side only.** It is a
courtesy, not a control — anyone calling the endpoint directly skips it
entirely. That is why `resend-otp` is bot-checked server-side.

### Still true, and still not solved

**There is no rate limiting.** §7 said it; it remains the case. reCAPTCHA
raises the cost of the first request, not the thousandth from whoever solved
one. If the goal is stopping brute force on login, an attempt counter with
backoff is the higher-value fix, and it would let you show the checkbox only
after N failures instead of to every user on every sign-in.

### Verification performed

31 automated checks across three live server configurations — off, on with the
real keys, and on with Google's always-pass test keys — including real round
trips to `siteverify` proving a bad token is rejected and a good one accepted,
that no account is created and no OTP issued on a failed check, and that the
secret key appears in none of the 28 files under `public/`. The other 238
checks in the project were re-run against the disabled config and all pass.
