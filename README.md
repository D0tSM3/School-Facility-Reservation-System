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

Open `.env` and set:

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

---

## 4 — Run locally

```bash
php -S localhost:8000 -t public
```

The `-t public` flag tells the built-in server to use `public/` as its
document root, so `public/index.php` handles every request.

---

## 5 — API endpoints & curl examples

All responses follow the envelope:
```json
{ "success": true, "data": ..., "error": null }
```

### Auth

#### Register
```bash
curl -s -X POST http://localhost:8000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@uni.edu","password":"Secret123"}' | jq
```

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

---

## 6 — Security notes

* Passwords are hashed with **bcrypt** (`PASSWORD_BCRYPT`).
* Every SQL statement uses **PDO prepared statements** — no string
  interpolation ever reaches the database.
* Session IDs are **regenerated** on login to prevent session fixation.
* `requireRole()` is called at the very top of each protected controller
  method; there is no way to bypass it by guessing a URL.
* The Postgres `prevent_double_booking` trigger is the **authoritative**
  concurrency guard; the PHP layer returns a clean `409` when it fires.
* `.env` is never committed (listed in `.gitignore`).

---

## 7 — Architecture decision: repository pattern

All SQL lives in three repository classes (`UserRepository`,
`RoomRepository`, `ReservationRepository`) accessed through the `Database`
singleton.  Controllers never call PDO directly.  This means:

* If the database schema changes, only repository methods need updating.
* If the backend is re-implemented in another language, the HTTP contract
  (URL, method, request/response shape) stays identical.
* Prepared statements are centralised and easy to audit.
