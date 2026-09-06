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
use CampusRoom\Controller\UserController;

// Load .env (immutable so it never overwrites real server env vars).
$dotenv = Dotenv::createImmutable(BASE_DIR);
$dotenv->load();
$dotenv->required(['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']);

// Start session once here so every controller can rely on it.
Auth::startSession();

// CORS / common headers (adjust origins for production).
header('Content-Type: application/json; charset=utf-8');

// -----------------------------------------------------------------------
// 2. Parse request
// -----------------------------------------------------------------------

$method = $_SERVER['REQUEST_METHOD'];

// Strip query string and normalise trailing slash.
$uri = strtok($_SERVER['REQUEST_URI'], '?');
$uri = rtrim($uri, '/') ?: '/';

// -----------------------------------------------------------------------
// 3. Route table
// -----------------------------------------------------------------------

// Each entry: [ HTTP_METHOD, regex_pattern, callable ]
// Named captures (?P<name>...) are passed to the callable as arguments.

$routes = [
    // Auth
    ['POST',  '#^/api/auth/register$#',              fn() => (new AuthController())->register()],
    ['POST',  '#^/api/auth/login$#',                 fn() => (new AuthController())->login()],
    ['POST',  '#^/api/auth/logout$#',                fn() => (new AuthController())->logout()],

    // Rooms — Customer (GET) + Admin (POST / PATCH)
    ['GET',   '#^/api/rooms$#',                      fn() => (new RoomController())->index()],
    ['POST',  '#^/api/rooms$#',                      fn() => (new RoomController())->store()],
    ['PATCH', '#^/api/rooms/(?P<id>[^/]+)$#',        fn(string $id) => (new RoomController())->update($id)],

    // Reservations
    // NOTE: /mine must be listed BEFORE /{id} so it is tested first.
    ['GET',   '#^/api/reservations/mine$#',          fn() => (new ReservationController())->mine()],
    ['GET',   '#^/api/reservations$#',               fn() => (new ReservationController())->index()],
    ['POST',  '#^/api/reservations$#',               fn() => (new ReservationController())->store()],
    ['PATCH', '#^/api/reservations/(?P<id>[^/]+)$#', fn(string $id) => (new ReservationController())->update($id)],

    // Users (Admin)
    ['GET',   '#^/api/users$#',                      fn() => (new UserController())->index()],
    ['PATCH', '#^/api/users/(?P<id>[^/]+)/role$#',   fn(string $id) => (new UserController())->updateRole($id)],

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
