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

    /** Find a user by email for login — includes OTP and verification fields. */
    public function findByEmailFull(string $email): ?array
    {
        $stmt = $this->db->query(
            'SELECT user_id, name, email, password_hash, role, is_verified,
                    otp_code, otp_expires_at, created_at
               FROM Users
              WHERE email = :email
              LIMIT 1',
            [':email' => $email]
        );
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /** Find a user by email (public fields only — no password or OTP). */
    public function findByEmail(string $email): ?array
    {
        $stmt = $this->db->query(
            'SELECT user_id, name, email, role, is_verified, created_at
               FROM Users
              WHERE email = :email
              LIMIT 1',
            [':email' => $email]
        );
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /** Find a user by their Google sub (unique Google ID). */
    public function findByGoogleId(string $googleId): ?array
    {
        $stmt = $this->db->query(
            'SELECT user_id, name, email, google_id, role, created_at
               FROM Users
              WHERE google_id = :google_id
              LIMIT 1',
            [':google_id' => $googleId]
        );
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /** Find a user by primary key (public fields — no password/OTP). */
    public function findById(string $userId): ?array
    {
        $stmt = $this->db->query(
            'SELECT user_id, name, email, role, is_verified, created_at
               FROM Users
              WHERE user_id = :user_id
              LIMIT 1',
            [':user_id' => $userId]
        );
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /**
     * Create a new user (email+password path). Account starts unverified.
     *
     * @return array The newly created user row.
     */
    public function create(string $name, string $email, string $passwordHash, string $role = 'Customer'): array
    {
        $this->db->query(
            'INSERT INTO Users (name, email, password_hash, role, is_verified)
             VALUES (:name, :email, :password_hash, :role, 0)',
            [
                ':name'          => $name,
                ':email'         => $email,
                ':password_hash' => $passwordHash,
                ':role'          => $role,
            ]
        );
        return $this->findByEmail($email) ?? [];
    }

    /** Persist a new OTP for a user, replacing any previous one. */
    public function saveOtp(string $userId, string $otp, string $expiresAt): void
    {
        $this->db->query(
            'UPDATE Users SET otp_code = :otp, otp_expires_at = :exp WHERE user_id = :uid',
            [':otp' => $otp, ':exp' => $expiresAt, ':uid' => $userId]
        );
    }

    /** Mark a user account as verified and clear the OTP. */
    public function markVerified(string $userId): void
    {
        $this->db->query(
            'UPDATE Users SET is_verified = 1, otp_code = NULL, otp_expires_at = NULL WHERE user_id = :uid',
            [':uid' => $userId]
        );
    }

    /**
     * Create a new user from Google OAuth (no password).
     * If a user already exists with this email, links their google_id instead.
     */
    public function createFromGoogle(string $googleId, string $email, string $name): array
    {
        // If email already exists (old password account), just link google_id
        $existing = $this->findByEmail($email);
        if ($existing !== null) {
            $this->db->query(
                'UPDATE Users SET google_id = :google_id WHERE email = :email',
                [':google_id' => $googleId, ':email' => $email]
            );
            return $this->findByEmail($email) ?? [];
        }

        $this->db->query(
            'INSERT INTO Users (name, email, google_id, role)
             VALUES (:name, :email, :google_id, :role)',
            [
                ':name'      => $name,
                ':email'     => $email,
                ':google_id' => $googleId,
                ':role'      => 'Customer',
            ]
        );
        return $this->findByEmail($email) ?? [];
    }

    /** Return all users (Admin-only). */
    public function findAll(): array
    {
        $stmt = $this->db->query(
            'SELECT user_id, name, email, role, is_verified, created_at
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
