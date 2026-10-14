<?php

declare(strict_types=1);

namespace CampusRoom\Repository;

use CampusRoom\Core\Database;
use PDO;

final class VisitorDayRepository
{
    private const NEW_ROW_DAILY_CAP = 10000;
    private const REPEAT_MIN_HITS = 5;

    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    public function record(string $day, string $visitorHash, string $page, string $browserFamily): void
    {
        $updated = $this->db->query(
            'UPDATE public.visitor_days
                SET hits = hits + 1,
                    last_seen = CURRENT_TIMESTAMP,
                    browser_family = :browser_family
              WHERE day = :day
                AND visitor_hash = :visitor_hash
                AND page = :page
          RETURNING visitor_hash',
            [
                ':browser_family' => $browserFamily,
                ':day' => $day,
                ':visitor_hash' => $visitorHash,
                ':page' => $page,
            ]
        );
        if ($updated->fetchColumn() !== false) {
            return;
        }

        $rateKey = 'visitor_cap:' . $day;
        $reservation = $this->db->query(
            "INSERT INTO auth_rate_limits
                (rate_key, action, identifier, failed_attempts, locked_until, updated_at)
             VALUES
                (:rate_key, 'visitor_daily_cap', :identifier, 1,
                 CURRENT_TIMESTAMP + INTERVAL '31 days', CURRENT_TIMESTAMP)
             ON CONFLICT (rate_key) DO UPDATE
               SET failed_attempts = auth_rate_limits.failed_attempts + 1,
                   locked_until = CURRENT_TIMESTAMP + INTERVAL '31 days',
                   updated_at = CURRENT_TIMESTAMP
             WHERE auth_rate_limits.failed_attempts < :row_cap
             RETURNING failed_attempts",
            [
                ':rate_key' => $rateKey,
                ':identifier' => $rateKey,
                ':row_cap' => self::NEW_ROW_DAILY_CAP,
            ]
        );
        if ($reservation->fetchColumn() === false) {
            return;
        }

        $insert = $this->db->query(
            'INSERT INTO public.visitor_days
                (day, visitor_hash, page, hits, first_seen, last_seen, browser_family)
             VALUES
                (:day, :visitor_hash, :page, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, :browser_family)
             ON CONFLICT (day, visitor_hash, page) DO UPDATE
               SET hits = public.visitor_days.hits + 1,
                   last_seen = CURRENT_TIMESTAMP,
                   browser_family = EXCLUDED.browser_family
             RETURNING (xmax = 0)::int AS inserted',
            [
                ':day' => $day,
                ':visitor_hash' => $visitorHash,
                ':page' => $page,
                ':browser_family' => $browserFamily,
            ]
        );
        $inserted = (int) $insert->fetchColumn() === 1;
        if (!$inserted) {
            $this->db->query(
                'UPDATE auth_rate_limits
                    SET failed_attempts = GREATEST(0, failed_attempts - 1),
                        updated_at = CURRENT_TIMESTAMP
                  WHERE rate_key = :rate_key',
                [':rate_key' => $rateKey]
            );
        }
    }

    public function purgeBefore(string $cutoffDay): void
    {
        $this->db->query(
            'DELETE FROM public.visitor_days WHERE day < :cutoff_day',
            [':cutoff_day' => $cutoffDay]
        );
        $this->db->query(
            "DELETE FROM auth_rate_limits
              WHERE action = 'visitor_daily_cap'
                AND identifier < :cutoff_key",
            [':cutoff_key' => 'visitor_cap:' . $cutoffDay]
        );
    }

    /** @return array{page_loads:int, distinct_visitors:int, pages:array<int, array{page:string, hits:int}>, repeat_visitors:array<int, array{visitor_hash:string, hits:int, pages:int}>} */
    public function todaySummary(string $day): array
    {
        $totals = $this->db->query(
            'SELECT COALESCE(SUM(hits), 0)::int AS page_loads,
                    COUNT(DISTINCT visitor_hash)::int AS distinct_visitors
               FROM public.visitor_days
              WHERE day = :day',
            [':day' => $day]
        )->fetch(PDO::FETCH_ASSOC) ?: [];

        $pageRows = $this->db->query(
            'SELECT page, SUM(hits)::int AS hits
               FROM public.visitor_days
              WHERE day = :day
           GROUP BY page
           ORDER BY page',
            [':day' => $day]
        )->fetchAll(PDO::FETCH_ASSOC);

        $repeatRows = $this->db->query(
            'SELECT visitor_hash, SUM(hits)::int AS hits,
                    COUNT(DISTINCT page)::int AS pages
               FROM public.visitor_days
              WHERE day = :day
           GROUP BY visitor_hash
             HAVING SUM(hits) >= :repeat_min_hits
           ORDER BY SUM(hits) DESC, visitor_hash
              LIMIT 5',
            [':day' => $day, ':repeat_min_hits' => self::REPEAT_MIN_HITS]
        )->fetchAll(PDO::FETCH_ASSOC);

        return [
            'page_loads' => (int) ($totals['page_loads'] ?? 0),
            'distinct_visitors' => (int) ($totals['distinct_visitors'] ?? 0),
            'pages' => array_map(
                static fn(array $row): array => [
                    'page' => (string) $row['page'],
                    'hits' => (int) $row['hits'],
                ],
                $pageRows
            ),
            'repeat_visitors' => array_map(
                static fn(array $row): array => [
                    'visitor_hash' => (string) $row['visitor_hash'],
                    'hits' => (int) $row['hits'],
                    'pages' => (int) $row['pages'],
                ],
                $repeatRows
            ),
        ];
    }

    /**
     * @param array<string, string> $hashesByDay
     * @return array<int, array<string, mixed>>
     */
    public function findMatchingDays(array $hashesByDay): array
    {
        if ($hashesByDay === []) {
            return [];
        }

        $conditions = [];
        $params = [];
        $index = 0;
        foreach ($hashesByDay as $day => $hash) {
            $dayParam = ':day_' . $index;
            $hashParam = ':hash_' . $index;
            $conditions[] = "(day = {$dayParam} AND visitor_hash = {$hashParam})";
            $params[$dayParam] = $day;
            $params[$hashParam] = $hash;
            $index++;
        }

        return $this->db->query(
            'SELECT day, visitor_hash, page, hits, first_seen, last_seen, browser_family
               FROM public.visitor_days
              WHERE ' . implode(' OR ', $conditions) . '
           ORDER BY day DESC, page',
            $params
        )->fetchAll(PDO::FETCH_ASSOC);
    }
}
