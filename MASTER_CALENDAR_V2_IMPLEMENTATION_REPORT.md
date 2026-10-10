# CampusRoom Master Calendar V2 — Implementation Report

## Decisions applied

- D8: same-origin iframe embeds for the customer, staff, and admin dashboards.
- D9: staff/admin calendar access is read-only and uses a separate detailed repository query. Customer responses remain on the existing privacy-filtered query.
- D10: Week defaults to the all-rooms overview; choosing a room switches to the single-room booking week.
- D11: Day has Rooms and Timeline modes, plus a week strip and booking-count drawer.
- D12c: a 30-minute server-side minimum was added to the shared validator, along with the business-rules handbook text.

## Phase status

- **A — 30-minute grid:** implemented half-hour units, duration guidance, class-period guide bands, repeat-mode minimums, and the shared server validator rule.
- **B — Responsive core:** added variable vertical scale, a resize observer that re-lays out cached data, fluid columns, internal horizontal scrolling, and mobile sizing. Full browser/resolution verification remains pending.
- **C — Day view:** added week strip and booking dots, day booking count/list drawer, Rooms/Timeline toggle, and overlap lanes.
- **D — Week overview:** added all-room weekly overview, class visibility toggle, overlap lanes, `+N more` popover, and mobile chip-stack layout. Per-room colored filter chips and the free-slot-to-room chooser from the original plan are not implemented in this pass.
- **E — Booking types:** added one-day, consecutive-day, and specific-day repeat controls, a 7-day UI cap, client-side per-day checks, skip-blocked-days conversion, API payload shaping, and the >3-day approval hint. Server validation remains authoritative.
- **F — Dashboard integration:** added iframe panels/navigation for all three dashboards, deep-link slot handoff from customer embeds, read-only staff/admin UI, role-gated endpoint access, and `masterDetailed()`.
- **G — Regression:** automated pure-JS tests and PHP/JS syntax checks passed. Live API/database tests, cross-role privacy tests, and browser-based resize/booking regressions have not been run in this environment.

## Checks run

- `node --test tests/master-calendar-v2.test.js` — 8 tests passed.
- `node --check` across `public/js/**/*.js` — passed.
- `php -l` across `src/**/*.php` — passed.
- Duplicate-ID checks on the four modified HTML pages — no duplicate IDs found.

## Required pre-deployment blocker

The new validator rule must not be deployed to a live/local database until the following read-only query has been run and any existing short reservations have been reviewed:

```sql
SELECT reservation_id, start_time, end_time
FROM reservations
WHERE end_time - start_time < interval '30 minutes';
```

No database connection was used during this pass, so the query has **not** been run against your data. After reviewing the results, test Move, Override, single bookings, and series approvals against the actual database.

## Local setup note

The delivered ZIP intentionally excludes `.env` and `.git` so it does not redistribute credentials or repository history. Copy `env.example` to `.env` locally and enter your own database/configuration values. Do not paste real secrets into chat.
