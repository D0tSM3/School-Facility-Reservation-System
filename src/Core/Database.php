<?php

declare(strict_types=1);

namespace CampusRoom\Core;

use PDO;
use PDOException;
use RuntimeException;

/**
 * Database — thin PDO wrapper.
 *
 * All SQL lives here (connection) or in repository classes.
 * Controllers/handlers NEVER touch PDO directly.
 */
class Database
{
    private static ?Database $instance = null;
    private PDO $pdo;

    private function __construct()
    {
        $dsn = sprintf(
            'pgsql:host=%s;port=%s;dbname=%s;sslmode=require',
            $_ENV['DB_HOST'],
            $_ENV['DB_PORT'],
            $_ENV['DB_NAME']
        );

        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];

        try {
            $this->pdo = new PDO($dsn, $_ENV['DB_USER'], $_ENV['DB_PASSWORD'], $options);
        } catch (PDOException $e) {
            // Never leak connection details to the caller.
            throw new RuntimeException('Database connection failed: ' . $e->getMessage());
        }

        // Put PostgreSQL's clock on the same zone as PHP's date_default_timezone_set()
        // (done in index.php before this connection is opened). NOW() drives
        // live_status, getNextAvailableSlots() and the maintenance warning, and
        // compares against wall-clock TIMESTAMP columns, so the two clocks must
        // agree.
        //
        // IMPORTANT: pass the named IANA zone, not a computed numeric UTC
        // offset. A bare offset string (e.g. "+08:00") is ambiguous in
        // PostgreSQL's SET TIME ZONE — it can be parsed under the older
        // SQL-standard/POSIX sign convention (positive = WEST of Greenwich),
        // the opposite of the ISO-8601 convention PHP's format('P') produces.
        // That silently turned "+08:00" (intended UTC+8 / Manila) into an
        // effective UTC-8, an 8-hour flip (16-hour swing from the intended
        // value) — the root cause of processed_at/created_at landing a day
        // early. Named zones like 'Asia/Manila' have no such ambiguity.
        $this->pdo->exec("SET TIME ZONE '" . ($_ENV['APP_TIMEZONE'] ?? 'Asia/Manila') . "'");
    }

    /** Singleton — one PDO connection per PHP process lifetime. */
    public static function getInstance(): self
    {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function getPdo(): PDO
    {
        return $this->pdo;
    }

    /**
     * Convenience: prepare + execute, return the PDOStatement.
     *
     * @param array<string, mixed> $params
     */
    public function query(string $sql, array $params = []): \PDOStatement
    {
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }
}
