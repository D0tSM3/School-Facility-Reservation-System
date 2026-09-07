<?php

declare(strict_types=1);

namespace CampusRoom\Repository;

use CampusRoom\Core\Database;

/**
 * UserRepository — all SQL that touches the Users table.
 */
class UserRepository
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /** Find a user by email for login. */
    public function findByEmail(string $email): ?array
    {
        $stmt = $this->db->query(
            'SELECT user_id, email, password_hash, role, created_at
               FROM Users
              WHERE email = :email
              LIMIT 1',
            [':email' => $email]
        );
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /** Find a user by primary key. */
    public function findById(string $userId): ?array
    {
        $stmt = $this->db->query(
            'SELECT user_id, email, role, created_at
               FROM Users
              WHERE user_id = :user_id
              LIMIT 1',
            [':user_id' => $userId]
        );
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /**
     * Create a new user.
     *
     * @return array The newly created user row (without password_hash).
     */
    public function create(string $email, string $passwordHash, string $role = 'Customer'): array
    {
        $pdo = $this->db->getPdo();
        $stmt = $this->db->query(
            'INSERT INTO Users (email, password_hash, role)
             VALUES (:email, :password_hash, :role)',
            [
                ':email'         => $email,
                ':password_hash' => $passwordHash,
                ':role'          => $role,
            ]
        );
        // MySQL does not support RETURNING — fetch the inserted row by last insert ID.
        $newId = $pdo->lastInsertId();
        // UUID primary keys: lastInsertId() is empty for non-auto-increment PKs;
        // re-fetch by email instead.
        return $this->findByEmail($email) ?? [];
    }

    /** Return all users (Admin-only). */
    public function findAll(): array
    {
        $stmt = $this->db->query(
            'SELECT user_id, email, role, created_at
               FROM Users
           ORDER BY created_at DESC'
        );
        return $stmt->fetchAll();
    }

    /**
     * Update a user's role (Admin-only).
     *
     * @return array|null Updated user row, or null if not found.
     */
    public function updateRole(string $userId, string $role): ?array
    {
        $this->db->query(
            'UPDATE Users
                SET role = :role
              WHERE user_id = :user_id',
            [
                ':role'    => $role,
                ':user_id' => $userId,
            ]
        );
        return $this->findById($userId);
    }
}
