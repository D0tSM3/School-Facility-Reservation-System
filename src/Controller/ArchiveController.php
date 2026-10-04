<?php

declare(strict_types=1);

namespace CampusRoom\Controller;

use CampusRoom\Core\Auth;
use CampusRoom\Core\Response;
use CampusRoom\Repository\ArchiveRepository;

/**
 * ArchiveController — Admin-only governance over archived records.
 *
 * Provides visibility into soft-deleted and archived records adhering
 * to the institutional 30-day retention and purge policy.
 */
class ArchiveController
{
    private ArchiveRepository $repo;

    public function __construct()
    {
        $this->repo = new ArchiveRepository();
    }

    /**
     * GET /api/archives
     * Query parameters:
     *   table_name: string ('all', 'classschedules', 'holidays', 'reservations', 'rooms')
     *   q: string search query
     *   limit: int (default 100)
     *   offset: int (default 0)
     */
    public function index(): never
    {
        Auth::requireRole(['Admin']);

        $tableName = isset($_GET['table_name']) ? trim((string) $_GET['table_name']) : null;
        $q         = isset($_GET['q']) ? trim((string) $_GET['q']) : null;
        $limit     = isset($_GET['limit']) && ctype_digit((string) $_GET['limit']) ? (int) $_GET['limit'] : 100;
        $offset    = isset($_GET['offset']) && ctype_digit((string) $_GET['offset']) ? (int) $_GET['offset'] : 0;
        $limit     = max(1, min(200, $limit));

        $items = $this->repo->findAll($tableName, $q, $limit, $offset);
        $total = $this->repo->count($tableName, $q);
        $stats = $this->repo->getStats();

        Response::json([
            'success' => true,
            'data'    => [
                'items'  => $items,
                'total'  => $total,
                'stats'  => $stats,
                'limit'  => $limit,
                'offset' => $offset,
            ],
        ]);
    }

    /**
     * GET /api/archives/{id}
     */
    public function show(string $archiveId): never
    {
        Auth::requireRole(['Admin']);

        $archive = $this->repo->findById($archiveId);
        if ($archive === null) {
            Response::error('Archived record not found.', 404);
        }

        Response::json([
            'success' => true,
            'data'    => $archive,
        ]);
    }

    /**
     * POST /api/archives/purge (Optional admin maintenance trigger)
     */
    public function purge(): never
    {
        Auth::requireRole(['Admin']);

        $purgedCount = $this->repo->purgeExpired();
        Response::json([
            'success' => true,
            'purged'  => $purgedCount,
            'message' => "Purged {$purgedCount} expired archived record(s) older than 30 days.",
        ]);
    }
}
