<?php

declare(strict_types=1);

namespace CampusRoom\Repository;

use CampusRoom\Core\Database;
use PDO;
use Throwable;

final class ActivationRepository
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /**
     * Create/replace an activation OTP only for an eligible, unregistered roster entry.
     *
     * @return array{eligible: bool, email?: string, name?: string, person_type?: string}
     */
    public function requestOtp(
        string $schoolId,
        string $codeHash,
        int $ttlSeconds,
        string $allowedDomain
    ): array
    {
        $pdo = $this->db->getPdo();
        $pdo->beginTransaction();

        try {
            $rosterQuery = $pdo->prepare(
                'SELECT school_id, full_name, email, person_type
                   FROM public.school_directory
                  WHERE school_id = :school_id
                    AND is_current IS TRUE
                  FOR UPDATE'
            );
            $rosterQuery->execute([':school_id' => $schoolId]);
            $roster = $rosterQuery->fetch(PDO::FETCH_ASSOC);

            if (!$roster) {
                $pdo->commit();
                return ['eligible' => false];
            }

            $email = strtolower((string) $roster['email']);
            $at = strrpos($email, '@');
            if ($at === false || !hash_equals($allowedDomain, substr($email, $at + 1))) {
                $pdo->commit();
                return ['eligible' => false];
            }

            $existingQuery = $pdo->prepare(
                'SELECT EXISTS (
                    SELECT 1
                      FROM public.users
                     WHERE school_id = :school_id
                        OR lower(email) = lower(:email)
                 )'
            );
            $existingQuery->execute([
                ':school_id' => $schoolId,
                ':email' => $roster['email'],
            ]);
            if ($existingQuery->fetchColumn()) {
                $pdo->commit();
                return ['eligible' => false];
            }

            $this->replaceActiveOtp($pdo, $schoolId, $codeHash, $ttlSeconds);
            $pdo->commit();

            return [
                'eligible' => true,
                'email' => (string) $roster['email'],
                'name' => (string) $roster['full_name'],
                'person_type' => (string) $roster['person_type'],
            ];
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    /**
     * Consume a valid code and return its roster record; no user row is written here.
     *
     * @return array{verified: bool, exhausted?: bool, roster?: array}
     */
    public function verifyOtp(string $schoolId, string $code, int $maxAttempts): array
    {
        $pdo = $this->db->getPdo();
        $pdo->beginTransaction();

        try {
            $rosterQuery = $pdo->prepare(
                'SELECT school_id, full_name, email, person_type
                   FROM public.school_directory
                  WHERE school_id = :school_id
                    AND is_current IS TRUE
                  FOR UPDATE'
            );
            $rosterQuery->execute([':school_id' => $schoolId]);
            $roster = $rosterQuery->fetch(PDO::FETCH_ASSOC);

            if (!$roster) {
                $pdo->commit();
                return ['verified' => false];
            }

            $otpQuery = $pdo->prepare(
                'SELECT otp_id, code_hash, expires_at, attempts
                   FROM public.activation_otps
                  WHERE school_id = :school_id
                    AND purpose = \'activation\'
                    AND used_at IS NULL
                    AND invalidated_at IS NULL
                    AND expires_at > CURRENT_TIMESTAMP
                  ORDER BY created_at DESC
                  LIMIT 1
                  FOR UPDATE'
            );
            $otpQuery->execute([':school_id' => $schoolId]);
            $otp = $otpQuery->fetch(PDO::FETCH_ASSOC);

            if (!$otp) {
                $pdo->commit();
                return ['verified' => false];
            }

            if (!hash_equals((string) $otp['code_hash'], hash('sha256', $code))) {
                $attempts = (int) $otp['attempts'] + 1;
                $attemptQuery = $pdo->prepare(
                    'UPDATE public.activation_otps
                        SET attempts = attempts + 1,
                            invalidated_at = CASE
                              WHEN attempts + 1 >= :max_attempts THEN CURRENT_TIMESTAMP
                              ELSE invalidated_at
                            END
                      WHERE otp_id = :otp_id'
                );
                $attemptQuery->execute([
                    ':max_attempts' => $maxAttempts,
                    ':otp_id' => $otp['otp_id'],
                ]);
                $pdo->commit();
                return ['verified' => false, 'exhausted' => $attempts >= $maxAttempts];
            }

            $consumeQuery = $pdo->prepare(
                'UPDATE public.activation_otps
                    SET used_at = CURRENT_TIMESTAMP
                  WHERE otp_id = :otp_id'
            );
            $consumeQuery->execute([':otp_id' => $otp['otp_id']]);
            $pdo->commit();

            return ['verified' => true, 'roster' => $roster];
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    /**
     * Create an active Customer account only after a verified activation session.
     */
    public function complete(
        string $schoolId,
        string $passwordHash,
        string $personType,
        string $verifiedEmail
    ): array {
        $pdo = $this->db->getPdo();
        $pdo->beginTransaction();

        try {
            $rosterQuery = $pdo->prepare(
                'SELECT school_id, full_name, email, person_type
                   FROM public.school_directory
                  WHERE school_id = :school_id
                    AND is_current IS TRUE
                  FOR UPDATE'
            );
            $rosterQuery->execute([':school_id' => $schoolId]);
            $roster = $rosterQuery->fetch(PDO::FETCH_ASSOC);

            if (!$roster
                || strcasecmp((string) $roster['person_type'], $personType) !== 0
                || strcasecmp((string) $roster['email'], $verifiedEmail) !== 0) {
                $pdo->commit();
                return ['created' => false];
            }

            $insertQuery = $pdo->prepare(
                'INSERT INTO public.users
                    (name, email, password_hash, role, is_verified, account_type,
                     school_id, is_active, activated_at)
                 VALUES
                    (:name, :email, :password_hash, \'Customer\', TRUE, :person_type,
                     :school_id, TRUE, CURRENT_TIMESTAMP)
                 RETURNING user_id, name, email, role, account_type, school_id,
                           is_verified::int AS is_verified, is_active::int AS is_active, activated_at'
            );
            $insertQuery->execute([
                ':name' => $roster['full_name'],
                ':email' => $roster['email'],
                ':password_hash' => $passwordHash,
                ':person_type' => $roster['person_type'],
                ':school_id' => $schoolId,
            ]);
            $user = $insertQuery->fetch(PDO::FETCH_ASSOC);
            $pdo->commit();

            return ['created' => true, 'user' => $user];
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    private function replaceActiveOtp(PDO $pdo, string $schoolId, string $codeHash, int $ttlSeconds): void
    {
        $invalidateQuery = $pdo->prepare(
            'UPDATE public.activation_otps
                SET invalidated_at = CURRENT_TIMESTAMP
              WHERE school_id = :school_id
                AND purpose = \'activation\'
                AND used_at IS NULL
                AND invalidated_at IS NULL'
        );
        $invalidateQuery->execute([':school_id' => $schoolId]);

        $insertQuery = $pdo->prepare(
            'INSERT INTO public.activation_otps (school_id, purpose, code_hash, expires_at)
             VALUES (:school_id, \'activation\', :code_hash,
                     CURRENT_TIMESTAMP + (CAST(:ttl_seconds AS integer) * INTERVAL \'1 second\'))'
        );
        $insertQuery->execute([
            ':school_id' => $schoolId,
            ':code_hash' => $codeHash,
            ':ttl_seconds' => $ttlSeconds,
        ]);
    }
}
