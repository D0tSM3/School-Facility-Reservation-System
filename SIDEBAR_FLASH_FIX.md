# Sidebar Flash Fix

## Problem

The sidebar briefly showed links for the wrong role while pages were loading. The role-specific links were styled after page content began rendering, while each page separately requested the authenticated user. Using the `localStorage` role directly for the first paint was also unsafe for presentation because it could be stale.

## Fix

- Added a synchronous shared shell guard to authenticated pages. It reads a tab-scoped `sessionStorage` hint before the first paint, allowing a returning user to see the correct role-specific navigation immediately.
- The hint is seeded after successful login and refreshed after the server confirms the session with `/api/auth/me`.
- Added early role-based visibility rules so unrelated navigation links start hidden and are enabled for the role in the verified hint.
- Shared the guard's `/api/auth/me` request with the application shell to avoid making duplicate session requests.
- Corrected navigation when the server role differs from the cached hint, and clear the hint when the session is invalid or the user signs out.

The cached role is only a display hint. It does not authorize access; the server remains authoritative on every page.

## Files affected

- `public/js/shell-guard.js` — first-paint role styling, role hint, shared session request, and server reconciliation.
- `public/js/app.js` — reuse the guard's session result and clear stale role data.
- `public/js/auth.js` — seed the role hint after a successful login response.
- `public/dashboard.html`
- `public/rooms.html`
- `public/book-room.html`
- `public/my-reservations.html`
- `public/staff-dashboard.html`
- `public/admin-governance.html`
- `public/handbook.html`

The seven authenticated pages above load the guard early, before their styles and sidebar markup.

## Validation

- Checked JavaScript syntax for the shell guard and application/auth scripts.
- Checked the affected pages for early shell-guard loading and removed `localStorage`-based first-paint role detection.
- Simulated customer and staff navigation, including a stale cached role corrected by the server and an invalid session clearing the hint.
- Ran `git diff --check`.
