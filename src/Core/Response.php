<?php

declare(strict_types=1);

namespace CampusRoom\Core;

/**
 * Response — standardised JSON envelope.
 *
 * Every endpoint returns: { "success": bool, "data": ..., "error": ... }
 */
class Response
{
    public static function json(mixed $data = null, int $status = 200): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'success' => $status >= 200 && $status < 300,
            'data'    => $data,
            'error'   => null,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    /** $data carries machine-readable detail about the error, when a client needs it. */
    public static function error(string $message, int $status = 400, mixed $data = null): never
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'success' => false,
            'data'    => $data,
            'error'   => $message,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }
}
