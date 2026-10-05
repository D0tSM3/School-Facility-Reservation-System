<?php

declare(strict_types=1);

namespace CampusRoom\Core;

use SessionHandlerInterface;
use Throwable;

/**
 * DbSessionHandler — stores PHP sessions in the database instead of the local
 * filesystem.
 *
 * Serverless hosts (Vercel) run each request in a fresh container whose /tmp is
 * wiped between invocations, so the default files handler loses the session the
 * moment the next request lands — the user is "logged out" right after login.
 * Persisting the session row in PostgreSQL (the same approach used for the OTP
 * code) fixes that. Registered by Auth::startSession() before session_start().
 */
final class DbSessionHandler implements SessionHandlerInterface
{
    /** Idle lifetime (seconds) before a session is eligible for garbage collection. */
    private int $ttl;

    public function __construct(int $ttl = 86400)
    {
        $this->ttl = $ttl;
    }

    public function open(string $path, string $name): bool
    {
        return true;
    }

    public function close(): bool
    {
        return true;
    }

    #[\ReturnTypeWillChange]
    public function read(string $id): string|false
    {
        try {
            $stmt = Database::getInstance()->query(
                "SELECT data FROM Sessions
                  WHERE session_id = :id
                    AND last_active > (NOW() - (:ttl || ' seconds')::interval)",
                [':id' => $id, ':ttl' => (string) $this->ttl]
            );
            $row = $stmt->fetch();
            return $row ? (string) $row['data'] : '';
        } catch (Throwable $e) {
            error_log('[CampusRoom] session read failed: ' . $e->getMessage());
            return '';
        }
    }

    public function write(string $id, string $data): bool
    {
        try {
            Database::getInstance()->query(
                "INSERT INTO Sessions (session_id, data, last_active)
                 VALUES (:id, :data, NOW())
                 ON CONFLICT (session_id)
                 DO UPDATE SET data = EXCLUDED.data, last_active = NOW()",
                [':id' => $id, ':data' => $data]
            );
            return true;
        } catch (Throwable $e) {
            error_log('[CampusRoom] session write failed: ' . $e->getMessage());
            return false;
        }
    }

    public function destroy(string $id): bool
    {
        try {
            Database::getInstance()->query(
                "DELETE FROM Sessions WHERE session_id = :id",
                [':id' => $id]
            );
            return true;
        } catch (Throwable $e) {
            error_log('[CampusRoom] session destroy failed: ' . $e->getMessage());
            return false;
        }
    }

    #[\ReturnTypeWillChange]
    public function gc(int $max_lifetime): int|false
    {
        try {
            $stmt = Database::getInstance()->query(
                "DELETE FROM Sessions
                  WHERE last_active < (NOW() - (:ttl || ' seconds')::interval)",
                [':ttl' => (string) max($max_lifetime, $this->ttl)]
            );
            return $stmt->rowCount();
        } catch (Throwable $e) {
            error_log('[CampusRoom] session gc failed: ' . $e->getMessage());
            return false;
        }
    }
}
