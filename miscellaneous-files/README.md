# Miscellaneous files

Nothing here is used by the running app. Kept instead of deleted in case
anyone wants to double check before it's gone for good. Safe to delete
this whole folder once the team's confirmed that.

| File | Why it's here |
|---|---|
| `testdb.php`, `testdb2.php`, `testdb3.php`, `testdb4.php` | One-off scratch scripts from debugging the DB connection. Superseded by `test-connection.php` in the project root — use that one instead. |
| `form-chunk.txt`, `temp_form.txt`, `temp_form_full.txt` | Scratch text dumps, not referenced by any code. |
| `server.log` | Leftover from a session where the app was accidentally run with PHP's built-in dev server (`php -S`). The real setup is Apache/XAMPP, so this file was never meaningful — see `router.php` below. |
| `router.php` | Written for `php -S`'s front-controller requirement, back when it looked like that was the dev server in use. It wasn't — this project actually runs under Apache/XAMPP via `.htaccess`, so this file is unused. `README.md` in the project root still documents running the app via `php -S ... router.php`; that instruction is stale now — use Apache instead. |
| `htaccess` | Byte-for-byte duplicate of the real `.htaccess` in the project root (just missing the leading dot, so Apache never reads it). |
| `gitignore` | Stale duplicate of `.gitignore` — missing the newer `/captcha.txt` line. `.gitignore` (the real dotfile) is current. |
| `.env.example` | Duplicate template for `.env`. The project root keeps `env.example` (no leading dot) instead, since it has the fuller comments explaining Supabase's direct-connection vs. session-pooler host options. This one is sparser (DB vars only, no explanation) — kept here for reference, but use the root one when setting up your `.env`. |
| `legacy-mysql/` | Everything left over from before the Supabase/Postgres migration — see below. |

## `legacy-mysql/`

The project used to run on MySQL; these all target that old setup and
don't apply to the current Postgres/Supabase database:

| File | What it was for |
|---|---|
| `database_schema_mysql.sql` | The original MySQL schema, before the Postgres migration. Kept for historical reference only — the live schema now lives in Supabase itself plus the `migrations/` folder at the project root. |
| `import_db.php` | One-line script that imported `database_schema_mysql.sql` into a local MySQL database (`mysql:host=127.0.0.1;...`). No Postgres equivalent needed — Supabase is already provisioned. |
| `run_all_migrations.sql` | A combined MySQL migration runner (references `mysqldump`, phpMyAdmin). Superseded by the individual, Postgres-native `.sql` files in `migrations/` at the project root. |
| `.env.test` | Local MySQL test credentials (`127.0.0.1:3306`, `root`/`root`). Not referenced anywhere in the codebase — grepped for it and found nothing importing it. |
