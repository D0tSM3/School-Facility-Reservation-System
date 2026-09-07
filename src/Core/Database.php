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
            'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
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
