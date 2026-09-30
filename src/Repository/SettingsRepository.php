<?php

declare(strict_types=1);

namespace CampusRoom\Repository;

use CampusRoom\Core\Database;

/**
 * SettingsRepository — the system_settings key/value table.
 */
class SettingsRepository
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /** @return array<string, string> setting_key => setting_value */
    public function all(): array
    {
        $stmt = $this->db->query('SELECT setting_key, setting_value FROM system_settings');
        $out  = [];
        foreach ($stmt->fetchAll() as $row) {
            $out[$row['setting_key']] = $row['setting_value'];
        }
        return $out;
    }

    /**
     * Write several settings at once, recording who changed them.
     *
     * @param array<string, string> $values
     */
    public function save(array $values, string $updatedBy): void
    {
        $pdo = $this->db->getPdo();
        $pdo->beginTransaction();
        try {
            foreach ($values as $key => $value) {
                $this->db->query(
                    'INSERT INTO system_settings (setting_key, setting_value, updated_by, updated_at)
                     VALUES (:key, :value, :updated_by, NOW())
                     ON CONFLICT (setting_key) DO UPDATE
                        SET setting_value = EXCLUDED.setting_value,
                            updated_by    = EXCLUDED.updated_by,
                            updated_at    = EXCLUDED.updated_at',
                    [':key' => $key, ':value' => $value, ':updated_by' => $updatedBy]
                );
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }
}
