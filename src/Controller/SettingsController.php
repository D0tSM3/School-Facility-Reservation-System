<?php

declare(strict_types=1);

namespace CampusRoom\Controller;

use CampusRoom\Core\Auth;
use CampusRoom\Core\Response;
use CampusRoom\Core\Settings;
use CampusRoom\Repository\ReservationRepository;
use CampusRoom\Repository\SettingsRepository;

/**
 * SettingsController — Admin-only System Configuration endpoints.
 */
class SettingsController
{
    // ---------------------------------------------------------------
    // Admin: GET /api/settings
    // ---------------------------------------------------------------

    public function show(): never
    {
        Auth::requireRole(['Admin']);
        Response::json(Settings::toArray());
    }

    // ---------------------------------------------------------------
    // Admin: PATCH /api/settings
    //   business_hours_start 'HH:MM', business_hours_end 'HH:MM',
    //   closed_days ['Sunday', ...]. Any subset may be sent.
    // ---------------------------------------------------------------

    public function update(): never
    {
        Auth::requireRole(['Admin']);

        $raw  = file_get_contents('php://input');
        $body = json_decode($raw ?: '{}', true);
        if (!is_array($body)) {
            Response::error('Request body must be valid JSON.', 400);
        }

        $current = Settings::toArray();
        $values  = [];

        foreach (['business_hours_start', 'business_hours_end'] as $key) {
            if (!array_key_exists($key, $body)) {
                continue;
            }
            $time = self::normaliseTime((string) $body[$key]);
            if ($time === null) {
                Response::error("{$key} must be a time of day (HH:MM).", 422);
            }
            $values[$key] = $time;
        }

        $start = $values['business_hours_start'] ?? $current['business_hours_start'];
        $end   = $values['business_hours_end']   ?? $current['business_hours_end'];
        if ($end <= $start) {   // zero-padded 'HH:MM' compares correctly as text
            Response::error('Business hours must end after they start.', 422);
        }

        if (array_key_exists('closed_days', $body)) {
            if (!is_array($body['closed_days'])) {
                Response::error('closed_days must be a list of weekday names.', 422);
            }
            $unknown = array_diff($body['closed_days'], Settings::WEEKDAYS);
            if ($unknown !== []) {
                Response::error('closed_days may only contain: ' . implode(', ', Settings::WEEKDAYS) . '.', 422);
            }
            $days = Settings::parseDays(implode(',', $body['closed_days']));
            if (count($days) === count(Settings::WEEKDAYS)) {
                Response::error('At least one day must stay open.', 422);
            }
            $values['closed_days'] = implode(',', $days);
        }

        if ($values === []) {
            Response::error('Nothing to update.', 422);
        }

        (new SettingsRepository())->save($values, Auth::userId());
        Settings::reset();
        $saved = Settings::toArray();

        // One audit line naming what actually changed.
        $changes = [];
        foreach ($saved as $key => $value) {
            $before = is_array($current[$key]) ? implode(', ', $current[$key]) ?: 'none' : $current[$key];
            $after  = is_array($value) ? implode(', ', $value) ?: 'none' : $value;
            if ($before !== $after) {
                $changes[] = "{$key} {$before} → {$after}";
            }
        }
        if ($changes !== []) {
            (new ReservationRepository())->insertLog(Auth::userId(), 'Admin changed system settings: ' . implode('; ', $changes));
        }

        Response::json($saved);
    }

    /** 'H:MM' / 'HH:MM' / 'HH:MM:SS' -> 'HH:MM', or null. */
    private static function normaliseTime(string $value): ?string
    {
        if (preg_match('/^(\d{1,2}):(\d{2})(?::\d{2})?$/', trim($value), $m) !== 1) {
            return null;
        }
        [$h, $i] = [(int) $m[1], (int) $m[2]];
        if ($h > 23 || $i > 59) {
            return null;
        }
        return sprintf('%02d:%02d', $h, $i);
    }
}
