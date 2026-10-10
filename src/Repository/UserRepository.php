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
            'SELECT user_id, name, email, password_hash, role, account_type, is_verified::int AS is_verified,
                    otp_code, otp_expires_at, school_id, is_active::int AS is_active, activated_at, created_at
               FROM Users
              WHERE lower(email) = lower(:email)
              LIMIT 1',
            [':email' => $email]
        );
        $row = $stmt->fetch();
        return $row ?: null;
    }

    public function emailBySchoolId(string $schoolId): ?string
    {
        $stmt = $this->db->query(
            'SELECT email
               FROM public.users
              WHERE school_id = :school_id
                AND is_active IS TRUE
              LIMIT 1',
            [':school_id' => $schoolId]
        );
        $email = $stmt->fetchColumn();
        return $email === false ? null : (string) $email;
    }

    public function updatePasswordHash(string $userId, string $passwordHash): void
    {
        $this->db->query(
            'UPDATE public.users SET password_hash = :hash WHERE user_id = :user_id',
            [':hash' => $passwordHash, ':user_id' => $userId]
        );
    }

    public function isActiveIdentity(string $userId, string $role): bool
    {
        $stmt = $this->db->query(
            'SELECT EXISTS (
                SELECT 1
                  FROM public.users
                 WHERE user_id = :user_id
                   AND role = :role
                   AND is_active IS TRUE
                   AND (
                       role <> \'Customer\'
                       OR (school_id IS NOT NULL AND activated_at IS NOT NULL)
                   )
            )',
            [':user_id' => $userId, ':role' => $role]
        );
        return (bool) $stmt->fetchColumn();
    }

    /** Find a user by email (public fields only — no password or OTP). */
    public function findByEmail(string $email): ?array
    {
        $stmt = $this->db->query(
            'SELECT user_id, name, email, role, account_type, is_verified::int AS is_verified,
                    school_id, is_active::int AS is_active, activated_at, created_at
               FROM Users
              WHERE lower(email) = lower(:email)
              LIMIT 1',
            [':email' => $email]
        );
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /** Find a user by primary key (public fields — no password/OTP). */
    public function findById(string $userId): ?array
    {
        $stmt = $this->db->query(
            'SELECT user_id, name, email, role, account_type, is_verified::int AS is_verified,
                    school_id, is_active::int AS is_active, activated_at, created_at
               FROM Users
              WHERE user_id = :user_id
              LIMIT 1',
            [':user_id' => $userId]
        );
        $row = $stmt->fetch();
        return $row ?: null;
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
            'UPDATE Users SET is_verified = true, otp_code = NULL, otp_expires_at = NULL WHERE user_id = :uid',
            [':uid' => $userId]
        );
    }

    /** Return all users (Admin-only). */
    public function findAll(): array
    {
        $stmt = $this->db->query(
            'SELECT user_id, name, email, role, account_type, is_verified::int AS is_verified,
                    school_id, is_active::int AS is_active, activated_at, created_at
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

    /**
     * Update a user's password and clear OTP fields.
     */
    public function updatePassword(string $userId, string $passwordHash): void
    {
        $this->db->query(
            'UPDATE Users
                SET password_hash = :hash,
                    otp_code = NULL,
                    otp_expires_at = NULL
              WHERE user_id = :user_id',
            [
                ':hash'    => $passwordHash,
                ':user_id' => $userId,
            ]
        );
    }
}
