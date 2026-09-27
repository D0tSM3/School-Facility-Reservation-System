<?php
// Router for PHP's built-in dev server only (php -S). Not used by Apache —
// public/.htaccess handles that case instead.
//
// WHY THIS EXISTS: public/index.php is a front-controller — every route
// (/api/rooms, /api/auth/me, etc.) is matched against a routing table
// inside it, not served from real files. PHP's built-in server only falls
// back to index.php for the exact document-root path ("/"); any other
// non-file path (like /api/rooms) 404s directly without this script,
// which breaks every API call — and therefore every role's dashboard —
// identically.
//
// Run with:  php -S localhost:8000 -t public router.php

$path = urldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));

// Root path: serve the actual login/landing page, not the API front
// controller. index.php has no route for "/" (only /api/...), so without
// this explicit check the root URL would 404 with a raw JSON error instead
// of showing the site.
if ($path === '/' || $path === '') {
    $indexHtml = __DIR__ . '/public/index.html';
    if (file_exists($indexHtml)) {
        header('Content-Type: text/html; charset=utf-8');
        readfile($indexHtml);
        return true; // handled — don't fall through to index.php
    }
}

// Serve real static files (css, js, images, other .html pages) as-is.
if ($path !== '/' && file_exists(__DIR__ . '/public' . $path) && !is_dir(__DIR__ . '/public' . $path)) {
    return false;
}

// Everything else (including all /api/... routes) goes through the
// front controller, same as Apache's rewrite rule does.
chdir(__DIR__ . '/public');
require __DIR__ . '/public/index.php';
