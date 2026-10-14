# CampusRoom — PHP Backend

A framework-free PHP 8+ REST API for the CampusRoom campus room-reservation
system.  It connects to an existing Supabase-hosted PostgreSQL database via
PDO and exposes JSON endpoints for three roles: **Customer**, **Staff**, and
**Admin**.

---

## Project structure

```
campusroom/
├── public/
│   └── index.php          ← Front-controller / router (only entry point)
├── src/
│   ├── Core/
│   │   ├── Database.php   ← Singleton PDO wrapper
│   │   ├── Auth.php       ← Session helpers + requireRole()
│   │   └── Response.php   ← Standardised JSON envelope
│   ├── Repository/
│   │   ├── UserRepository.php
│   │   ├── RoomRepository.php
│   │   └── ReservationRepository.php  ← also owns System_Logs queries
│   └── Controller/
│       ├── AuthController.php
│       ├── RoomController.php
│       ├── ReservationController.php
│       └── UserController.php
├── composer.json
├── .env.example
└── .gitignore
```

---

## 1 — Prerequisites

| Tool | Minimum version |
|------|----------------|
| PHP  | 8.0            |
| Composer | 2.x       |
| PHP `pdo_pgsql` extension | enabled |

Verify with:
```bash
php -m | grep pdo_pgsql
```

---

## 2 — Install dependencies

```bash
cd path/to/campusroom
composer install
```

Composer will install `vlucas/phpdotenv` and generate the autoloader under
`vendor/`.

---

## 3 — Configure the environment

Copy the example file and fill in your Supabase credentials:

```bash
cp .env.example .env
```

For a local database connection, set:

```ini
DB_HOST=db.<your-project-ref>.supabase.co
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=<your-supabase-db-password>
```

> **Supabase tip:** credentials are in  
> Supabase Dashboard → Project Settings → Database → Connection info.  
> Use port **5432** (direct) or **6543** (Supabase pooler — pgBouncer).

Production also requires `APP_ENV`, `APP_ORIGIN`, `APP_SECRET`, and
`ALLOWED_EMAIL_DOMAIN`. Email-based activation and login verification require
`SMTP_HOST`, `SMTP_USER`, and one of `SMTP_PASS` or `SMTP_PASSWORD`.
`APP_SECRET` must have at least 32 characters. The complete list of runtime
environment variable names, optional settings, and production requirements is
in [ACTIVATION_CHANGES.md](./ACTIVATION_CHANGES.md#environment-variables-read-by-application-and-utility-php-code).

---

## 4 — Run locally

```bash
php -S 127.0.0.1:8000 -t public public/index.php
```

`public/index.php` is the built-in server router and passes real static files
through to PHP's development server.

---

## 5 — API endpoints & curl examples

All responses follow the envelope:
```json
{ "success": true, "data": ..., "error": null }
```

### Auth

#### Activate an account

Open `http://127.0.0.1:8000/activate.html` and verify the 8-digit school ID
against a current `school_directory` row. An eligible person receives a
six-digit code at the email on that roster row, then chooses and confirms a
password. The account is created as a `Customer` only after code verification;
activation does not sign the person in. Responses do not reveal whether a
submitted ID matched. Activation requests do not use reCAPTCHA.

| Method and path | Purpose |
|---|---|
| `GET /api/auth/csrf` | Starts the protected form flow and returns a CSRF token. |
| `POST /api/auth/activate/request` | Requests a code using `student_id`. |
| `POST /api/auth/activate/verify` | Verifies `student_id` and `otp`. |
| `GET /api/auth/activate/context` | Returns name, masked email, person type, and password bounds after verification. |
| `POST /api/auth/activate/complete` | Creates the account using `password` and `password_confirm`. |

#### Login (session cookie saved to `cookies.txt`)
```bash
curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"email":"alice@uni.edu","password":"Secret123"}' | jq
```

#### Logout
```bash
curl -s -X POST http://localhost:8000/api/auth/logout \
  -b cookies.txt | jq
```

---

### Rooms (Customer)

#### List active rooms
```bash
curl -s http://localhost:8000/api/rooms \
  -b cookies.txt | jq
```

---

### Reservations (Customer)

#### Create a reservation
```bash
curl -s -X POST http://localhost:8000/api/reservations \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "room_id":    "<uuid>",
    "start_time": "2026-09-10 09:00:00",
    "end_time":   "2026-09-10 11:00:00"
  }' | jq
```

> A scheduling collision returns **HTTP 409**:
> ```json
> { "success": false, "data": null, "error": "Scheduling Collision: Room is already booked..." }
> ```

#### My reservations
```bash
curl -s http://localhost:8000/api/reservations/mine \
  -b cookies.txt | jq
```

---

### Reservations (Staff)

#### List all Pending reservations
```bash
curl -s "http://localhost:8000/api/reservations?status=Pending" \
  -b cookies.txt | jq
```

#### Approve / Reject / Complete a reservation
```bash
# Approve
curl -s -X PATCH http://localhost:8000/api/reservations/<uuid> \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"status":"Approved"}' | jq

# Reject
curl -s -X PATCH http://localhost:8000/api/reservations/<uuid> \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"status":"Rejected"}' | jq

# Complete
curl -s -X PATCH http://localhost:8000/api/reservations/<uuid> \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"status":"Completed"}' | jq
```

---

### Rooms (Admin)

#### Create a room
```bash
curl -s -X POST http://localhost:8000/api/rooms \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"name":"Lab 404","capacity":30,"status":"Available"}' | jq
```

#### Update room status / active flag
```bash
curl -s -X PATCH http://localhost:8000/api/rooms/<uuid> \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"status":"Maintenance","is_active":false}' | jq
```

---

### Users (Admin)

#### List all users
```bash
curl -s http://localhost:8000/api/users \
  -b cookies.txt | jq
```

#### Change a user's role
```bash
curl -s -X PATCH http://localhost:8000/api/users/<uuid>/role \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"role":"Staff"}' | jq
```

---

### Audit Logs (Admin)

#### View all system logs
```bash
curl -s http://localhost:8000/api/logs \
  -b cookies.txt | jq
```

#### Security alerts and visitor summaries

`GET /api/logs/alerts` returns the nine computed security alert rules.
`GET /api/logs/visitors` returns today's approximate public-page load summary.
To look up visitor summary rows, send an Admin-only
`POST /api/logs/visitors/lookup` with a JSON IPv4/IPv6 `ip`; the service
recomputes daily IP hashes for the last 30 days and returns any matches.
`POST /api/visit?page=landing|login|activate` is the public no-session
collector. Its per-day IP HMACs are stored instead of raw visitor IPs.

See [ACTIVATION_CHANGES.md](./ACTIVATION_CHANGES.md) for the alert thresholds,
event types, migration inventory, privacy/retention details, and complete
endpoint behavior.

---

## 6 — Security notes

* New passwords are hashed with **Argon2id**. Activation and reset passwords
  use the 15–128 Unicode-code-point policy and breach lookup documented above.
* Every SQL statement uses **PDO prepared statements** — no string
  interpolation ever reaches the database.
* Session IDs are **regenerated** on login to prevent session fixation.
* `requireRole()` is called at the very top of each protected controller
  method; there is no way to bypass it by guessing a URL.
* The Postgres `prevent_double_booking` trigger is the **authoritative**
  concurrency guard; the PHP layer returns a clean `409` when it fires.
* `.env` is never committed (listed in `.gitignore`).
* The browser signs a user out after 15 minutes without activity, with a
  one-minute warning. This is a client-side timeout.
* The landing and activation pages disclose aggregate visitor collection.
  Visitor summaries are retained for 30 days; security-event data is deleted
  or partially anonymized after 90 days.

---

## 7 — Architecture decision: repository pattern

All SQL lives in three repository classes (`UserRepository`,
`RoomRepository`, `ReservationRepository`) accessed through the `Database`
singleton.  Controllers never call PDO directly.  This means:

* If the database schema changes, only repository methods need updating.
* If the backend is re-implemented in another language, the HTTP contract
  (URL, method, request/response shape) stays identical.
* Prepared statements are centralised and easy to audit.

## 8 — UI Cut Features & Rationale

The front-end templates provided by the Stitch export contained several mock UI elements that did not map to the provided `database_schema_mysql.sql`. As per the requirements, these features were removed or simplified to match the DB schema strictly:

*   **Campus Capacity Utilization SVG Chart:** Removed from Customer Dashboard (no historical tracking/capacity tables in the DB).
*   **Building/Floor/Wing labels & Building Filter Dropdown:** Removed from Room Cards and Dashboard because the `Rooms` table only has `name` and `capacity`, and does not support complex geography (e.g. Building, Floor, Wing) or filtering by them.
*   **Room Photos:** Removed from room cards (no image paths or binary storage columns in DB).
*   **Equipment/Amenity Tags:** Removed from room cards and booking flow (no equipment or amenities columns in DB).
*   **Department / ID Number:** Removed from the Register page (Users table only contains `email`, `password_hash`, `role`, and `name`).
*   **Expected Attendees / Assets:** Removed from the booking flow since the schema only accepts `room_id`, `start_time`, `end_time`, and `purpose`.
*   **Notification Bell & Advanced Filters:** Removed due to lack of corresponding backend tables (No `Notifications` or `Saved Filters` tables).

## Master Calendar Plan V2 implementation notes

The V2 calendar implementation adds a half-hour selection grid, class-period guide bands, flexible grid sizing, day strip/count drawer, room/timeline day layouts, an all-rooms week overview, overlap lanes with a `+N more` popover, repeat-booking controls, and iframe embeds on the customer/staff/admin dashboards. Staff/admin calendar reads use a separate `CalendarRepository::masterDetailed()` query; customer reads continue through the privacy-filtered `master()` query.

### Decisions recorded

- Dashboard integration uses same-origin iframe embedding (`?embed=1`).
- Staff/admin calendar is read-only and may show requester display name, purpose, category, and status. It does not expose requester email or account credentials.
- Week view defaults to the all-rooms overview; choosing a room in the selector switches to the bookable single-room week.
- Day view offers Rooms and Timeline layouts.
- The calendar UI uses 30-minute units and repeat bookings are capped at 7 days in the UI.
- The server validator now rejects windows shorter than 30 minutes.

### Before enabling the server minimum in a live database

Run this read-only check against the target PostgreSQL database and inspect any returned rows before deploying the validator change. It identifies existing reservations shorter than the new rule:

```sql
SELECT reservation_id, start_time, end_time
FROM reservations
WHERE end_time - start_time < interval '30 minutes';
```

The database was not connected during this implementation pass, so this check has **not** been run against your live/local database. Do not deploy the validator change until you review its result and confirm how any affected records should be handled.

### Local checks

Run the pure JavaScript tests from the project root:

```bash
node --test tests/master-calendar-v2.test.js
```

PHP and JavaScript syntax checks can be run with `php -l` over `src/**/*.php` and `node --check` over `public/js/**/*.js`. Browser-level checks still need to be completed in your local app with a working PostgreSQL/Supabase connection and test accounts for Customer, Staff, and Admin.
