<?php

declare(strict_types=1);

namespace CampusRoom\Repository;

use CampusRoom\Core\Database;

/**
 * ArchiveRepository — handles data preservation for deleted records.
 *
 * Enforces an automated 30-day retention policy: all deleted class schedules,
 * holidays, reservations, and room records are kept in `archived_records`
 * with a `purge_at` timestamp set to 30 days after deletion.
 */
class ArchiveRepository
{
    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /**
     * Archive a record before deletion.
     *
     * @param string $tableName e.g. 'classschedules', 'holidays', 'reservations', 'rooms'
     * @param string $recordId
     * @param string $recordSummary Human-readable description
     * @param array<string, mixed> $data Full row data snapshot
     * @param string|null $userId Actor performing the deletion
     * @param string|null $reason Optional archival / deletion reason
     * @return string The generated archive_id (UUID)
     */
    public function archive(
        string $tableName,
        string $recordId,
        string $recordSummary,
        array $data,
        ?string $userId = null,
        ?string $reason = null
    ): string {
        $stmt = $this->db->query(
            "INSERT INTO archived_records (
                table_name,
                record_id,
                record_summary,
                record_data,
                reason,
                archived_by,
                archived_at,
                purge_at
             ) VALUES (
                :table_name,
                :record_id,
                :record_summary,
                :record_data::jsonb,
                :reason,
                :archived_by,
                NOW(),
                NOW() + INTERVAL '30 days'
             ) RETURNING archive_id",
            [
                ':table_name'     => $tableName,
                ':record_id'      => $recordId,
                ':record_summary' => $recordSummary,
                ':record_data'    => json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                ':reason'         => $reason,
                ':archived_by'    => $userId,
            ]
        );

        $row = $stmt->fetch();
        return (string) ($row['archive_id'] ?? '');
    }

    /**
     * List archived records with search, filter, and remaining retention days.
     *
     * @return array<int, array<string, mixed>>
     */
    public function findAll(?string $tableName = null, ?string $search = null, int $limit = 100, int $offset = 0): array
    {
        $sql = "
            SELECT
                a.archive_id,
                a.table_name,
                a.record_id,
                a.record_summary,
                a.record_data,
                a.reason,
                a.archived_by,
                u.name AS archived_by_name,
                u.email AS archived_by_email,
                TO_CHAR(a.archived_at, 'YYYY-MM-DD HH24:MI:SS') AS archived_at,
                TO_CHAR(a.purge_at, 'YYYY-MM-DD HH24:MI:SS') AS purge_at,
                GREATEST(0, CEIL(EXTRACT(EPOCH FROM (a.purge_at - NOW())) / 86400))::int AS days_remaining
            FROM archived_records a
            LEFT JOIN users u ON u.user_id = a.archived_by
            WHERE 1=1
        ";
        $params = [];

        if ($tableName !== null && $tableName !== '' && $tableName !== 'all') {
            $sql .= " AND a.table_name = :table_name";
            $params[':table_name'] = $tableName;
        }

        if ($search !== null && trim($search) !== '') {
            $sql .= " AND (a.record_summary ILIKE :search OR a.record_id ILIKE :search OR a.reason ILIKE :search)";
            $params[':search'] = '%' . trim($search) . '%';
        }

        $sql .= " ORDER BY a.archived_at DESC LIMIT :limit OFFSET :offset";

        $stmt = $this->db->getPdo()->prepare($sql);
        foreach ($params as $key => $val) {
            $stmt->bindValue($key, $val);
        }
        $stmt->bindValue(':limit', $limit, \PDO::PARAM_INT);
        $stmt->bindValue(':offset', $offset, \PDO::PARAM_INT);
        $stmt->execute();

        $rows = $stmt->fetchAll();
        foreach ($rows as &$row) {
            if (is_string($row['record_data'])) {
                $row['record_data'] = json_decode($row['record_data'], true) ?: [];
            }
        }
        unset($row);

        return $rows;
    }

    /**
     * Total count of archived records matching filters.
     */
    public function count(?string $tableName = null, ?string $search = null): int
    {
        $sql = "SELECT COUNT(*) FROM archived_records a WHERE 1=1";
        $params = [];

        if ($tableName !== null && $tableName !== '' && $tableName !== 'all') {
            $sql .= " AND a.table_name = :table_name";
            $params[':table_name'] = $tableName;
        }

        if ($search !== null && trim($search) !== '') {
            $sql .= " AND (a.record_summary ILIKE :search OR a.record_id ILIKE :search OR a.reason ILIKE :search)";
            $params[':search'] = '%' . trim($search) . '%';
        }

        $stmt = $this->db->getPdo()->prepare($sql);
        foreach ($params as $key => $val) {
            $stmt->bindValue($key, $val);
        }
        $stmt->execute();
        return (int) $stmt->fetchColumn();
    }

    /**
     * Find single archived record by ID.
     */
    public function findById(string $archiveId): ?array
    {
        $stmt = $this->db->query(
            "SELECT
                a.archive_id,
                a.table_name,
                a.record_id,
                a.record_summary,
                a.record_data,
                a.reason,
                a.archived_by,
                u.name AS archived_by_name,
                u.email AS archived_by_email,
                TO_CHAR(a.archived_at, 'YYYY-MM-DD HH24:MI:SS') AS archived_at,
                TO_CHAR(a.purge_at, 'YYYY-MM-DD HH24:MI:SS') AS purge_at,
                GREATEST(0, CEIL(EXTRACT(EPOCH FROM (a.purge_at - NOW())) / 86400))::int AS days_remaining
             FROM archived_records a
             LEFT JOIN users u ON u.user_id = a.archived_by
             WHERE a.archive_id = :id",
            [':id' => $archiveId]
        );

        $row = $stmt->fetch();
        if (!$row) return null;

        if (is_string($row['record_data'])) {
            $row['record_data'] = json_decode($row['record_data'], true) ?: [];
        }
        return $row;
    }

    /**
     * Aggregate statistics on archives for the governance dashboard.
     *
     * @return array<string, int>
     */
    public function getStats(): array
    {
        $stmt = $this->db->query(
            "SELECT table_name, COUNT(*) AS count
             FROM archived_records
             GROUP BY table_name"
        );
        $stats = [
            'total'          => 0,
            'classschedules' => 0,
            'holidays'       => 0,
            'reservations'   => 0,
            'rooms'          => 0,
        ];
        foreach ($stmt->fetchAll() as $row) {
            $tbl = $row['table_name'];
            $cnt = (int) $row['count'];
            $stats[$tbl] = $cnt;
            $stats['total'] += $cnt;
        }
        return $stats;
    }

    /**
     * Purge records that have exceeded their 30-day retention window.
     */
    public function purgeExpired(): int
    {
        $stmt = $this->db->query(
            "DELETE FROM archived_records WHERE purge_at <= NOW() RETURNING archive_id"
        );
        return count($stmt->fetchAll());
    }
}
