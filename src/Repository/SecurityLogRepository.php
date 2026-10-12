<?php

declare(strict_types=1);

namespace CampusRoom\Repository;

use CampusRoom\Core\Database;

final class SecurityLogRepository
{
    private const ALERT_LIMIT = 20;

    private const R1_THRESHOLD = 10;
    private const R1_WINDOW_MINUTES = 15;
    private const R2_THRESHOLD = 5;
    private const R2_WINDOW_MINUTES = 15;
    private const R3_DISTINCT_IP_THRESHOLD = 5;
    private const R3_WINDOW_MINUTES = 60;
    private const R4_THRESHOLD = 3;
    private const R4_WINDOW_MINUTES = 15;
    private const R5_THRESHOLD = 3;
    private const R5_WINDOW_MINUTES = 60;
    private const R6_THRESHOLD = 10;
    private const R6_WINDOW_MINUTES = 15;
    private const R7_THRESHOLD = 5;
    private const R7_WINDOW_MINUTES = 15;
    private const R8_THRESHOLD = 3;
    private const R8_WINDOW_MINUTES = 15;

    private Database $db;

    public function __construct()
    {
        $this->db = Database::getInstance();
    }

    /** @return array<int, array<string, mixed>> */
    public function findAlerts(): array
    {
        $stmt = $this->db->query(
            "WITH security_events AS (
                SELECT log_id, event_type, user_id, identifier_hash, ip_address, user_agent, \"timestamp\"
                  FROM System_Logs
                 WHERE event_type IS NOT NULL
                   AND \"timestamp\" >= CURRENT_TIMESTAMP - INTERVAL '" . self::R3_WINDOW_MINUTES . " minutes'
            ),
            account_events AS (
                SELECT e.event_type,
                       COALESCE('u:' || e.user_id::text, 'h:' || e.identifier_hash) AS account_key,
                       e.user_id::text AS user_id,
                       e.identifier_hash,
                       u.name AS actor_name,
                       e.ip_address,
                       e.\"timestamp\"
                  FROM security_events e
             LEFT JOIN Users u ON u.user_id = e.user_id
                 WHERE (e.user_id IS NOT NULL OR e.identifier_hash IS NOT NULL)
            ),
            success_after_failures AS (
                SELECT s.user_id::text AS user_id,
                       s.identifier_hash,
                       COALESCE('u:' || s.user_id::text, 'h:' || s.identifier_hash) AS account_key,
                       COALESCE(
                           u.name,
                           'Unknown account ' || LEFT(COALESCE(s.identifier_hash, s.user_id::text), 8)
                       ) AS subject,
                       COUNT(f.log_id)::int AS failed_count,
                       MIN(f.\"timestamp\") AS first_seen,
                       s.\"timestamp\" AS last_seen
                  FROM security_events s
             LEFT JOIN Users u ON u.user_id = s.user_id
                  JOIN security_events f
                    ON f.event_type = 'login_failed'
                   AND f.\"timestamp\" >= s.\"timestamp\" - INTERVAL '" . self::R4_WINDOW_MINUTES . " minutes'
                   AND f.\"timestamp\" < s.\"timestamp\"
                   AND (
                       (s.user_id IS NOT NULL AND f.user_id = s.user_id)
                       OR (s.identifier_hash IS NOT NULL AND f.identifier_hash = s.identifier_hash)
                   )
                 WHERE s.event_type = 'login_success'
                   AND s.\"timestamp\" >= CURRENT_TIMESTAMP - INTERVAL '" . self::R4_WINDOW_MINUTES . " minutes'
                 GROUP BY s.user_id, s.identifier_hash, s.\"timestamp\", u.name
                HAVING COUNT(f.log_id) >= " . self::R4_THRESHOLD . "
            ),
            alerts AS (
                SELECT 'R1'::text AS rule,
                       'Many failed sign-ins from one address'::text AS title,
                       'Medium'::text AS severity,
                       'ip'::text AS subject_type,
                       e.ip_address::text AS subject,
                       COUNT(*)::int AS count,
                       NULL::int AS distinct_count,
                       MIN(e.\"timestamp\") AS first_seen,
                       MAX(e.\"timestamp\") AS last_seen,
                       e.ip_address::text AS ip,
                       NULL::text AS user_id
                  FROM security_events e
                 WHERE e.event_type = 'login_failed'
                   AND e.ip_address IS NOT NULL
                   AND e.\"timestamp\" >= CURRENT_TIMESTAMP - INTERVAL '" . self::R1_WINDOW_MINUTES . " minutes'
              GROUP BY e.ip_address
                HAVING COUNT(*) >= " . self::R1_THRESHOLD . "

                UNION ALL

                SELECT 'R2', 'One address tried many accounts', 'High', 'ip',
                       e.ip_address::text, COUNT(*)::int,
                       COUNT(DISTINCT e.identifier_hash)::int,
                       MIN(e.\"timestamp\"), MAX(e.\"timestamp\"),
                       e.ip_address::text, NULL::text
                  FROM security_events e
                 WHERE e.event_type IN ('login_failed', 'activation_no_match')
                   AND e.ip_address IS NOT NULL
                   AND e.identifier_hash IS NOT NULL
                   AND e.\"timestamp\" >= CURRENT_TIMESTAMP - INTERVAL '" . self::R2_WINDOW_MINUTES . " minutes'
              GROUP BY e.ip_address
                HAVING COUNT(DISTINCT e.identifier_hash) >= " . self::R2_THRESHOLD . "

                UNION ALL

                SELECT 'R3', 'One account received failures from many addresses', 'High', 'account',
                       COALESCE(
                           MAX(a.actor_name),
                           'Unknown account ' || LEFT(COALESCE(MAX(a.identifier_hash), MAX(a.user_id)), 8)
                       ),
                       COUNT(*)::int, COUNT(DISTINCT a.ip_address)::int,
                       MIN(a.\"timestamp\"), MAX(a.\"timestamp\"), NULL::text, MAX(a.user_id)
                  FROM account_events a
                 WHERE a.event_type = 'login_failed'
                   AND a.ip_address IS NOT NULL
                   AND a.\"timestamp\" >= CURRENT_TIMESTAMP - INTERVAL '" . self::R3_WINDOW_MINUTES . " minutes'
              GROUP BY a.account_key
                HAVING COUNT(DISTINCT a.ip_address) >= " . self::R3_DISTINCT_IP_THRESHOLD . "

                UNION ALL

                SELECT 'R4', 'Sign-in succeeded after repeated failures', 'High', 'account',
                       MAX(s.subject), MAX(s.failed_count)::int, NULL::int,
                       MIN(s.first_seen), MAX(s.last_seen), NULL::text, MAX(s.user_id)
                  FROM success_after_failures s
              GROUP BY s.account_key

                UNION ALL

                SELECT 'R5', 'Several sign-in lockouts from one address', 'Medium', 'ip',
                       e.ip_address::text, COUNT(*)::int, NULL::int,
                       MIN(e.\"timestamp\"), MAX(e.\"timestamp\"), e.ip_address::text, NULL::text
                  FROM security_events e
                 WHERE e.event_type = 'login_locked'
                   AND e.ip_address IS NOT NULL
                   AND e.\"timestamp\" >= CURRENT_TIMESTAMP - INTERVAL '" . self::R5_WINDOW_MINUTES . " minutes'
              GROUP BY e.ip_address
                HAVING COUNT(*) >= " . self::R5_THRESHOLD . "

                UNION ALL

                SELECT 'R6', 'Many activation requests found no matching account', 'High', 'ip',
                       e.ip_address::text, COUNT(*)::int, NULL::int,
                       MIN(e.\"timestamp\"), MAX(e.\"timestamp\"), e.ip_address::text, NULL::text
                  FROM security_events e
                 WHERE e.event_type = 'activation_no_match'
                   AND e.ip_address IS NOT NULL
                   AND e.\"timestamp\" >= CURRENT_TIMESTAMP - INTERVAL '" . self::R6_WINDOW_MINUTES . " minutes'
              GROUP BY e.ip_address
                HAVING COUNT(*) >= " . self::R6_THRESHOLD . "

                UNION ALL

                SELECT 'R7', 'Repeated verification failures for an account', 'Medium', 'account',
                       COALESCE(
                           MAX(a.actor_name),
                           'Unknown account ' || LEFT(COALESCE(MAX(a.identifier_hash), MAX(a.user_id)), 8)
                       ),
                       COUNT(*)::int, NULL::int,
                       MIN(a.\"timestamp\"), MAX(a.\"timestamp\"), NULL::text, MAX(a.user_id)
                  FROM account_events a
                 WHERE a.event_type IN ('otp_failed', 'activation_verify_failed')
                   AND a.\"timestamp\" >= CURRENT_TIMESTAMP - INTERVAL '" . self::R7_WINDOW_MINUTES . " minutes'
              GROUP BY a.account_key
                HAVING COUNT(*) >= " . self::R7_THRESHOLD . "

                UNION ALL

                SELECT 'R8', 'Repeated failed sign-ins used an automated client', 'Low', 'ip',
                       e.ip_address::text, COUNT(*)::int, NULL::int,
                       MIN(e.\"timestamp\"), MAX(e.\"timestamp\"), e.ip_address::text, NULL::text
                  FROM security_events e
                 WHERE e.event_type = 'login_failed'
                   AND e.ip_address IS NOT NULL
                   AND e.\"timestamp\" >= CURRENT_TIMESTAMP - INTERVAL '" . self::R8_WINDOW_MINUTES . " minutes'
                   AND (
                       NULLIF(BTRIM(e.user_agent), '') IS NULL
                       OR LOWER(e.user_agent) ~ '(curl|python|go-http|java|okhttp|axios|node)'
                   )
              GROUP BY e.ip_address
                HAVING COUNT(*) >= " . self::R8_THRESHOLD . "
            )
            SELECT rule, title, severity, subject_type, subject, count,
                   distinct_count, first_seen, last_seen, ip, user_id
              FROM alerts
          ORDER BY CASE severity WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END,
                   last_seen DESC
             LIMIT " . self::ALERT_LIMIT
        );

        $items = $stmt->fetchAll();
        foreach ($items as &$item) {
            $item['count'] = (int) $item['count'];
            $item['distinct'] = $item['distinct_count'] === null
                ? null
                : (int) $item['distinct_count'];
            unset($item['distinct_count']);
        }
        unset($item);

        return $items;
    }
}
