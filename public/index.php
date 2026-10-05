<?php

declare(strict_types=1);

/**
 * public/index.php — CampusRoom front-controller / router
 *
 * Every HTTP request is routed here.  No framework is used; routing is a
 * plain method-match + preg_match pattern list.
 *
 * Architecture contract:
 *   Only controllers are instantiated here.
 *   Controllers call repository methods — never raw SQL.
 *   Repositories call Database::getInstance()->query() — never PDO directly.
 */

// -----------------------------------------------------------------------
// 1. Bootstrap
// -----------------------------------------------------------------------

define('BASE_DIR', dirname(__DIR__));

require BASE_DIR . '/vendor/autoload.php';

use Dotenv\Dotenv;
use CampusRoom\Core\Response;
use CampusRoom\Core\Auth;
use CampusRoom\Core\Settings;
use CampusRoom\Controller\AuthController;
use CampusRoom\Controller\RoomController;
use CampusRoom\Controller\ReservationController;
use CampusRoom\Controller\ClassScheduleController;
use CampusRoom\Controller\HolidayController;
use CampusRoom\Controller\UserController;
use CampusRoom\Controller\SettingsController;

// Load .env when it exists (local dev). On serverless hosts like Vercel there
// is no .env file — configuration comes from the platform's environment
// variables — so safeLoad() is used: load() throws on a missing file and would
// fatal every request (500s on /api/config, so the captcha never renders).
// Those platform variables may be visible only through getenv() when PHP's
// variables_order excludes 'E', so mirror them into $_ENV (which the rest of
// the app reads) without overwriting anything .env already provided.
$dotenv = Dotenv::createImmutable(BASE_DIR);
$dotenv->safeLoad();
foreach (getenv() as $envKey => $envVal) {
    if (!array_key_exists($envKey, $_ENV)) {
        $_ENV[$envKey] = $envVal;
    }
}
try {
    $dotenv->required(['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']);
} catch (\Throwable $e) {
    // Soft fallback if running in a partial/preview environment without full DB credentials
    error_log('[CampusRoom] Missing DB env vars: ' . $e->getMessage());
}

// One timezone for PHP date()/strtotime(), the MySQL session and the Manila-formatted UI.
date_default_timezone_set($_ENV['APP_TIMEZONE'] ?? 'Asia/Manila');

// Start session once here so every controller can rely on it.
Auth::startSession();

// CORS / common headers (adjust origins for production).
header('Content-Type: application/json; charset=utf-8');

// -----------------------------------------------------------------------
// 2. Parse request
// -----------------------------------------------------------------------

$method = $_SERVER['REQUEST_METHOD'];

// Strip query string.
$uri = strtok($_SERVER['REQUEST_URI'] ?? '/', '?');

// Strip the application's mount prefix so routes work both under a subdirectory
// (XAMPP: /Project/public/api/... -> /api/...) and at a domain root (Vercel).
// Only strip when SCRIPT_NAME actually points at the front controller; on
// Vercel SCRIPT_NAME can be set to the request path itself, and the old logic
// then ate a real route segment (e.g. /api), producing "Route not found".
$scriptName = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '');
if (basename($scriptName) === 'index.php') {
    $basePath = rtrim(dirname($scriptName), '/');
    if ($basePath !== '' && $basePath !== '/' && str_starts_with($uri, $basePath . '/')) {
        $uri = substr($uri, strlen($basePath));
    }
}

// A rewrite target can leave the front controller's own file path in the URI;
// treat that as the site root.
if (in_array($uri, ['/index.php', '/public/index.php', '/public'], true)) {
    $uri = '/';
}

$uri = rtrim($uri, '/') ?: '/';

// -----------------------------------------------------------------------
// 3. Route table
// -----------------------------------------------------------------------

// Each entry: [ HTTP_METHOD, regex_pattern, callable ]
// Named captures (?P<name>...) are passed to the callable as arguments.

$routes = [
    // Public bootstrap — the login screen reads the reCAPTCHA site key from
    // here so .env stays the single source for it. No auth: it must answer
    // before anyone can log in, and it returns only public values.
    ['GET', '#^/api/config$#', function () {
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }

        $enabled = filter_var($_ENV['RECAPTCHA_ENABLED'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $siteKey = $enabled ? ($_ENV['RECAPTCHA_SITE_KEY'] ?? '') : '';

        // The booking rules the Admin sets on System Configuration, so the
        // booking form and room calendar offer only what the server accepts.
        try {
            $settings = Settings::toArray();
        } catch (\Throwable $e) {
            error_log('[CampusRoom] Settings unavailable in /api/config: ' . $e->getMessage());
            $settings = [];
        }

        Response::json([
            'recaptcha_enabled'  => $enabled,
            'recaptcha_site_key' => $siteKey,
        ] + $settings);
    }],

    // Auth — login & recovery
    ['POST', '#^/api/auth/register$#',        fn() => (new AuthController())->register()],
    ['POST', '#^/api/auth/login$#',           fn() => (new AuthController())->login()],
    ['POST', '#^/api/auth/forgot-password$#', fn() => (new AuthController())->forgotPassword()],
    ['POST', '#^/api/auth/reset-password$#',  fn() => (new AuthController())->resetPassword()],
    ['POST', '#^/api/auth/verify-otp$#',      fn() => (new AuthController())->verifyOtp()],
    ['POST', '#^/api/auth/resend-otp$#',      fn() => (new AuthController())->resendOtp()],
    // Auth — session
    ['GET',  '#^/api/auth/me$#',          fn() => (new AuthController())->me()],
    ['POST', '#^/api/auth/logout$#',      fn() => (new AuthController())->logout()],

    // Rooms — Customer (GET) + Admin (POST / PATCH)
    ['GET',   '#^/api/rooms$#',                    fn() => (new RoomController())->index()],
    ['GET',   '#^/api/rooms/(?P<id>[^/]+)/calendar$#', fn(string $id) => (new RoomController())->getCalendar($id)],
    ['POST',  '#^/api/rooms$#',                    fn() => (new RoomController())->store()],
    ['PATCH', '#^/api/rooms/(?P<id>[^/]+)$#',        fn(string $id) => (new RoomController())->update($id)],
    ['DELETE', '#^/api/rooms/(?P<id>[^/]+)$#',       fn(string $id) => (new RoomController())->destroy($id)],

    // Reservations
    // NOTE: the literal GET routes /mine and /move-requests MUST stay above GET /{id},
    // or the {id} pattern swallows them (this router is a linear first-match list).
    ['GET',   '#^/api/reservations/mine$#',          fn() => (new ReservationController())->mine()],
    ['GET',   '#^/api/reservations/move-requests$#', fn() => (new ReservationController())->getMoveRequests()],
    ['GET',   '#^/api/reservations/cancel-requests$#', fn() => (new ReservationController())->getCancelRequests()],
    ['GET',   '#^/api/reservations/cancellations$#', fn() => (new ReservationController())->getUserCancellations()],
    ['GET',   '#^/api/reservations/(?P<id>[^/]+)$#', fn(string $id) => (new ReservationController())->show($id)],
    ['GET',   '#^/api/reservations$#',               fn() => (new ReservationController())->index()],
    ['POST',  '#^/api/reservations$#',               fn() => (new ReservationController())->store()],
    ['PATCH', '#^/api/reservations/(?P<id>[^/]+)/cancel$#', fn(string $id) => (new ReservationController())->cancel($id)],
    ['PATCH', '#^/api/reservations/(?P<id>[^/]+)$#', fn(string $id) => (new ReservationController())->update($id)],
    // Customer "Remove" — a soft hide, not a DELETE of the row.
    ['DELETE', '#^/api/reservations/(?P<id>[^/]+)$#', fn(string $id) => (new ReservationController())->remove($id)],

    // Move Requests
    ['POST',  '#^/api/reservations/(?P<id>[^/]+)/rebook$#', fn(string $id) => (new ReservationController())->rebook($id)],
    // Two path segments after /reservations/, so it cannot collide with the single-segment GET /{id} above.
    ['GET',   '#^/api/reservations/(?P<id>[^/]+)/logs$#', fn(string $id) => (new ReservationController())->logs($id)],
    ['POST',  '#^/api/reservations/(?P<id>[^/]+)/move-request$#', fn(string $id) => (new ReservationController())->requestMove($id)],
    ['PATCH', '#^/api/reservations/move-requests/(?P<id>[^/]+)$#', fn(string $id) => (new ReservationController())->resolveMoveRequest($id)],

    // Cancellation Requests (approved bookings)
    // Customers no longer file cancellation requests: they cancel directly via PATCH /{id}/cancel.
    ['PATCH', '#^/api/reservations/cancel-requests/(?P<id>[^/]+)$#', fn(string $id) => (new ReservationController())->resolveCancelRequest($id)],

    // Users (Admin)
    ['GET',   '#^/api/users$#',                      fn() => (new UserController())->index()],
    ['PATCH', '#^/api/users/(?P<id>[^/]+)/role$#',   fn(string $id) => (new UserController())->updateRole($id)],

    // Class Schedules (Staff + Admin)
    ['GET',    '#^/api/classes$#',                   fn() => (new ClassScheduleController())->index()],
    ['POST',   '#^/api/classes$#',                   fn() => (new ClassScheduleController())->store()],
    ['PATCH',  '#^/api/classes/(?P<id>[^/]+)$#',     fn(string $id) => (new ClassScheduleController())->relocate($id)],
    ['DELETE', '#^/api/classes/(?P<id>[^/]+)$#',     fn(string $id) => (new ClassScheduleController())->destroy($id)],

    // Holidays (Staff + Admin)
    ['GET',    '#^/api/holidays$#',                  fn() => (new HolidayController())->index()],
    ['POST',   '#^/api/holidays$#',                  fn() => (new HolidayController())->store()],
    ['DELETE', '#^/api/holidays/(?P<id>[^/]+)$#',    fn(string $id) => (new HolidayController())->destroy($id)],

    // Conflict override requests (Customer)
    ['GET',    '#^/api/conflict-override-requests/mine$#', fn() => (new ReservationController())->myOverrides()],
    ['POST',   '#^/api/conflict-override-requests$#',      fn() => (new ReservationController())->requestOverride()],
    ['DELETE', '#^/api/conflict-override-requests/(?P<id>[^/]+)$#', fn(string $id) => (new ReservationController())->cancelOverride($id)],
    // Conflict override requests (Staff/Admin)
    ['GET',    '#^/api/conflict-override-requests$#',      fn() => (new ReservationController())->overrideIndex()],
    ['PATCH',  '#^/api/conflict-override-requests/(?P<id>[^/]+)$#', fn(string $id) => (new ReservationController())->resolveOverride($id)],

    // System settings (Admin)
    ['GET',   '#^/api/settings$#',                   fn() => (new SettingsController())->show()],
    ['PATCH', '#^/api/settings$#',                   fn() => (new SettingsController())->update()],

    // Logs (Admin)
    ['GET',   '#^/api/logs$#',                       fn() => (new UserController())->logs()],

    // Data Archives (Admin - 30-day retention governance)
    ['GET',   '#^/api/archives$#',                   fn() => (new \CampusRoom\Controller\ArchiveController())->index()],
    ['GET',   '#^/api/archives/(?P<id>[^/]+)$#',     fn(string $id) => (new \CampusRoom\Controller\ArchiveController())->show($id)],
    ['POST',  '#^/api/archives/purge$#',             fn() => (new \CampusRoom\Controller\ArchiveController())->purge()],
];

// -----------------------------------------------------------------------
// 4. Dispatch
// -----------------------------------------------------------------------

foreach ($routes as [$routeMethod, $pattern, $handler]) {
    if ($routeMethod !== $method && !($routeMethod === 'GET' && $method === 'HEAD')) {
        continue;
    }

    if (!preg_match($pattern, $uri, $matches)) {
        continue;
    }

    // Extract named captures (e.g., "id") and pass them as positional args.
    $args = array_filter(
        $matches,
        fn($key) => is_string($key),
        ARRAY_FILTER_USE_KEY
    );

    try {
        $handler(...array_values($args));
    } catch (\PDOException $e) {
        // Unhandled DB error — log internally, return generic 500.
        error_log('[CampusRoom] PDOException: ' . $e->getMessage());
        Response::error('A database error occurred: ' . $e->getMessage(), 500);
    } catch (\Throwable $e) {
        error_log('[CampusRoom] Uncaught exception: ' . $e->getMessage());
        Response::error('An unexpected error occurred: ' . $e->getMessage(), 500);
    }

    // If we reach here the handler returned without calling Response (shouldn't
    // happen since all controller methods use `never` return type, but just in
    // case the dispatcher itself is modified later).
    exit;
}

// No route matched.
Response::error('Route not found.', 404);
