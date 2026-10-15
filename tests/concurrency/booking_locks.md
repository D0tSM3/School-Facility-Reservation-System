# Booking / class-schedule concurrency — test plan (NOT RUN here)

These tests exercise the advisory-lock protection added to the reservation and
class-schedule write paths. They **require a disposable local PostgreSQL** with
the CampusRoom schema seeded. They were **NOT run** in the session that wrote
this file because:

- production Supabase must never be used for tests (data-protection rule), and
- no local throwaway PostgreSQL instance was available at the time.

Run them only against a local DB. **Never point these at the production host**
`aws-0-ap-northeast-2.pooler.supabase.com` — every harness below must assert the
`DB_HOST` is `localhost`/`127.0.0.1` and abort otherwise.

## What to exercise

1. **Two concurrent single reservations, same room + overlapping slot**
   Open two DB connections. In each: `BEGIN`; `SELECT pg_advisory_xact_lock(hashtext('room:'||:id))`;
   re-run the overlap check; insert; `COMMIT`. Expect exactly **one** success and
   one 409/"Scheduling Collision" — never two approved rows. Without the lock,
   both selects see a free slot and both insert (the bug this fixes).

2. **Two concurrent class-schedule writes, same room + overlapping interval**
   Same protocol via `ClassScheduleController::store`. Expect one insert, one 409.

3. **Class vs. reservation cannot bypass each other**
   Concurrently: one thread books a slot, another adds a class over the same
   room/weekday/time. The shared key `hashtext('room:'||room_id)` serializes
   them; expect exactly one to win, the other to get the applicable conflict
   response. A new class must NOT silently override an already-approved booking
   (ClassScheduleController returns 409 listing the booking to move first).

4. **Relocation lock ordering (deadlock-free)**
   Thread A relocates class X from room R1→R2 while thread B relocates class Y
   from R2→R1. `lockRooms()` sorts the room ids before locking, so both acquire
   {R1,R2} in the same order — no deadlock. Expect both to finish (serially),
   never a deadlock error.

5. **Rollback after failed validation**
   Force the under-lock re-validation to fail (pre-insert a conflicting row on
   the other connection, commit it, then let the first proceed). Expect the
   first transaction to return `['error'=>...]` / raise, roll back, write
   nothing, and release the advisory lock (verify `pg_locks` has no leftover
   `advisory` lock for that key after the request).

6. **Repeated seed is idempotent (no production seed)**
   Against the local DB, run `migrations/.../seed_live_hardened.sql` twice.
   Expect the second run to insert 0 rows (NOT EXISTS dedup) and the final
   assertion to still read 14 — proving re-run safety without touching prod.

## Key-hashing invariant (holds without a DB)

PHP never computes the lock key: `lockRooms()` sends
`SELECT pg_advisory_xact_lock(hashtext('room:' || ?))` with the raw room id, so
the 32-bit key is derived in SQL. Any other writer — PHP or hand-written SQL —
that uses the same `hashtext('room:'||room_id)` expression locks the same key.
This is the single room-lock convention; do not introduce a second scheme.
