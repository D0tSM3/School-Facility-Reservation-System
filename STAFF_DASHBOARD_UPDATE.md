# Staff Dashboard — Admin-style access (update)

Builds on `STAFF_DASHBOARD_FIX.md`. Package: `School-Facility-Reservation-System_STAFF_V2.zip`.

## Part A — Verification of the previous .md

| Claim | Result |
|---|---|
| Header hooks (`header-name/role/initials`), neutral defaults | Confirmed |
| Sidebar, `switchView`, hash routing + aliases | Confirmed |
| Search only on queues; batch button only on Approval Queue | Confirmed |
| Dead "All Requests" tab removed | Confirmed |
| Approve-all handler removed | Confirmed |
| Toast element present | Confirmed |
| 6.3 stray comma fixed | **Partly**: fixed in `.btn-toggle-facility`, but the same bug remained in the `alertBtn` handler (dormant; element not in HTML). That handler is now removed. |
| "Exactly one PATCH" for batch approve | **Not true at web root**: the handler called `api('/api/reservations/..')`; with `BASE='/'` that becomes `//api/...`. Fixed (leading slash removed). |

## Part B — What changed

**Sidebar (matches the Admin screenshot):** Dashboard / All Reservations, Approval Queue, Move Requests, Cancellations, Overrides / Rooms Directory, Class Schedules, Holidays & Closures / Policy Handbook.

| View | Hash | Staff can |
|---|---|---|
| All Reservations | `#reservations` | Filter by status/search/classification; approve/reject pending; ⋮ menu (details, slip, log archive, cancel, re-book) |
| Rooms Directory | `#rooms` (`#facility-grid` still works) | View all rooms; set Available / Maintenance. Add/edit/decommission/delete stay **Admin-only** |
| Class Schedules | `#classes` | View, add, delete (delete = 30-day archive) |
| Holidays & Closures | `#holidays` | View, declare, delete (30-day archive) |

The old Facility Grid view was replaced by the Rooms Directory; the Dashboard "Facility Status Grid" card opens it.

**Backend (`ClassScheduleController.php`, `HolidayController.php`):**
- `index/store/destroy` now allow `Staff` and `Admin` (were Admin-only).
- Audit-log and archive text hard-coded "Admin"; now uses the real actor role.
- Rooms policy untouched (Staff: status only).

**Files:** `public/staff-dashboard.html`, `public/js/staff-dashboard.js`, `src/Controller/ClassScheduleController.php`, `src/Controller/HolidayController.php`.

## Part C — Verification

Real page + JS in headless Chromium with a mocked API: **50/50 checks pass** (sidebar order and groups, header, counts, all four new views, filters, request bodies, inline server errors, hash routing, toolbar/batch visibility). Also: batch approve = 1 PATCH (Staff and Admin); Customer sees the access notice.

**Not verified:** PHP edits were not executed (no PHP in the test environment); visual styling (Tailwind CDN blocked); real database; mocked API only.

## Part D — Manual check
1. Ctrl+F5, log in as Staff: sidebar matches the screenshot.
2. Class Schedules → add a block, then delete it. Holidays → declare, then delete.
3. Audit logs (as Admin): the entries should say **Staff added class…**, not Admin.
4. Rooms Directory: no Add/Edit/Delete buttons; toggle a room's status.
5. Log in as Admin: Admin pages unchanged.
