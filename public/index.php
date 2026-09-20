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
use CampusRoom\Controller\AuthController;
use CampusRoom\Controller\RoomController;
use CampusRoom\Controller\ReservationController;
use CampusRoom\Controller\ClassScheduleController;
use CampusRoom\Controller\HolidayController;
use CampusRoom\Controller\UserController;

// Load .env (immutable so it never overwrites real server env vars).
$dotenv = Dotenv::createImmutable(BASE_DIR);
$dotenv->load();
$dotenv->required(['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']);

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
$uri = strtok($_SERVER['REQUEST_URI'], '?');

// Strip the application base path so routes work under a subdirectory
// (e.g. /Project/public/api/... → /api/...).
// SCRIPT_NAME is something like /Project/public/index.php.
$basePath = rtrim(dirname($_SERVER['SCRIPT_NAME']), '/\\');
if ($basePath !== '' && str_starts_with($uri, $basePath)) {
    $uri = substr($uri, strlen($basePath));
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
    ['GET',  '#^/api/config$#',           fn() => (new AuthController())->config()],

    // Auth — login
    ['POST', '#^/api/auth/register$#',    fn() => (new AuthController())->register()],
    ['POST', '#^/api/auth/login$#',       fn() => (new AuthController())->login()],
    ['POST', '#^/api/auth/verify-otp$#',  fn() => (new AuthController())->verifyOtp()],
    ['POST', '#^/api/auth/resend-otp$#',  fn() => (new AuthController())->resendOtp()],
    // Auth — session
    ['GET',  '#^/api/auth/me$#',          fn() => (new AuthController())->me()],
    ['POST', '#^/api/auth/logout$#',      fn() => (new AuthController())->logout()],

    // Rooms — Customer (GET) + Admin (POST / PATCH)
    ['GET',   '#^/api/rooms$#',                    fn() => (new RoomController())->index()],
    ['GET',   '#^/api/rooms/(?P<id>[^/]+)/calendar$#', fn(string $id) => (new RoomController())->getCalendar($id)],
    ['POST',  '#^/api/rooms$#',                    fn() => (new RoomController())->store()],
    ['PATCH', '#^/api/rooms/(?P<id>[^/]+)$#',        fn(string $id) => (new RoomController())->update($id)],

    // Reservations
    // NOTE: the literal GET routes /mine and /move-requests MUST stay above GET /{id},
    // or the {id} pattern swallows them (this router is a linear first-match list).
    ['GET',   '#^/api/reservations/mine$#',          fn() => (new ReservationController())->mine()],
    ['GET',   '#^/api/reservations/move-requests$#', fn() => (new ReservationController())->getMoveRequests()],
    ['GET',   '#^/api/reservations/cancel-requests$#', fn() => (new ReservationController())->getCancelRequests()],
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
    ['PATCH', '#^/api/reservations/move-requests/(?P<id>[^/]+)$#',fn(string $id) => (new ReservationController())->resolveMoveRequest($id)],

    // Cancellation Requests (approved bookings)
    ['POST',  '#^/api/reservations/(?P<id>[^/]+)/cancel-request$#', fn(string $id) => (new ReservationController())->requestCancel($id)],
    ['PATCH', '#^/api/reservations/cancel-requests/(?P<id>[^/]+)$#', fn(string $id) => (new ReservationController())->resolveCancelRequest($id)],

    // Users (Admin)
    ['GET',   '#^/api/users$#',                      fn() => (new UserController())->index()],
    ['PATCH', '#^/api/users/(?P<id>[^/]+)/role$#',   fn(string $id) => (new UserController())->updateRole($id)],

    // Class Schedules (Admin)
    ['GET',    '#^/api/classes$#',                   fn() => (new ClassScheduleController())->index()],
    ['POST',   '#^/api/classes$#',                   fn() => (new ClassScheduleController())->store()],
    ['DELETE', '#^/api/classes/(?P<id>[^/]+)$#',     fn(string $id) => (new ClassScheduleController())->destroy($id)],

    // Holidays (Admin)
    ['GET',    '#^/api/holidays$#',                  fn() => (new HolidayController())->index()],
    ['POST',   '#^/api/holidays$#',                  fn() => (new HolidayController())->store()],
    ['DELETE', '#^/api/holidays/(?P<id>[^/]+)$#',    fn(string $id) => (new HolidayController())->destroy($id)],

    // Logs (Admin)
    ['GET',   '#^/api/logs$#',                       fn() => (new UserController())->logs()],
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
        Response::error('A database error occurred. Please try again later.', 500);
    } catch (\Throwable $e) {
        error_log('[CampusRoom] Uncaught exception: ' . $e->getMessage());
        Response::error('An unexpected error occurred.', 500);
    }

    // If we reach here the handler returned without calling Response (shouldn't
    // happen since all controller methods use `never` return type, but just in
    // case the dispatcher itself is modified later).
    exit;
}

// No route matched.
Response::error('Route not found.', 404);
