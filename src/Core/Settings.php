<?php

declare(strict_types=1);

namespace CampusRoom\Core;

use CampusRoom\Repository\SettingsRepository;

/**
 * Settings — the Admin-configurable booking rules, typed and with defaults.
 *
 * Read once per request (the values cannot change mid-request). A missing
 * row, or a database that predates the system_settings migration, falls back
 * to the defaults below, which are the rules the app has always enforced.
 */
final class Settings
{
    public const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

    public const DEFAULT_EQUIPMENT = [
        [
            'id'          => 'lapel_mic',
            'name'        => 'Wireless Lapel Mic',
            'description' => '2 Transmitters & fresh batteries',
            'is_default'  => true,
        ],
        [
            'id'          => 'hdmi_kit',
            'name'        => 'HDMI Cable Kit',
            'description' => '4K Ultra-HD 5m shielded cable',
            'is_default'  => true,
        ],
        [
            'id'          => 'recording_pod',
            'name'        => 'Archival Recording Pod',
            'description' => 'Dual-camera fixed lecture capture',
            'is_default'  => false,
        ],
    ];

    private const DEFAULTS = [
        'business_hours_start' => '06:00',
        'business_hours_end'   => '21:00',
        'closed_days'          => '',
        'class_periods'        => '',
        // Current academic semester (Admin-configured). '' = not configured yet.
        // Classes are stamped with these dates at creation and only apply within
        // the window, so last term's classes expire on their own.
        'semester_start'       => '',
        'semester_end'         => '',
        'equipment_list'       => '',
    ];

    /** @var array<string, string>|null */
    private static ?array $values = null;

    /** 'HH:MM' the building opens. */
    public static function businessHoursStart(): string
    {
        return self::get('business_hours_start');
    }

    /** 'HH:MM' the building closes. */
    public static function businessHoursEnd(): string
    {
        return self::get('business_hours_end');
    }

    /** @return string[] weekday names (date('l') spelling) the building is closed. */
    public static function closedDays(): array
    {
        return self::parseDays(self::get('closed_days'));
    }

    /**
     * Master Calendar snap periods from the 'class_periods' setting
     * ('07:30-09:00,09:00-10:30,...') as [['07:30','09:00'], ...].
     * Anything malformed, overlapping or out of order yields [] so the
     * calendar falls back to its half-hour grid instead of breaking.
     *
     * @return array<int, array{0: string, 1: string}>
     */
    public static function periods(): array
    {
        $out  = [];
        $prev = '';
        foreach (explode(',', self::get('class_periods')) as $chunk) {
            $chunk = trim($chunk);
            if ($chunk === '') {
                continue;
            }
            if (preg_match('/^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/', $chunk, $m) !== 1) {
                return [];
            }
            $from = $m[1] . ':' . $m[2];
            $to   = $m[3] . ':' . $m[4];
            if ($to <= $from || $from < $prev) {
                return [];
            }
            $out[] = [$from, $to];
            $prev  = $to;
        }
        return $out;
    }

    /** 'YYYY-MM-DD' the current semester starts, or '' if not configured. */
    public static function semesterStart(): string
    {
        return self::get('semester_start');
    }

    /** 'YYYY-MM-DD' the current semester ends, or '' if not configured. */
    public static function semesterEnd(): string
    {
        return self::get('semester_end');
    }

    /** True once both current-semester dates are set. */
    public static function hasSemester(): bool
    {
        return self::semesterStart() !== '' && self::semesterEnd() !== '';
    }

    /** @return array<int, array{id: string, name: string, description: string, is_default: bool}> */
    public static function equipmentList(): array
    {
        $raw = self::get('equipment_list');
        if ($raw === '') {
            return self::DEFAULT_EQUIPMENT;
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            return self::DEFAULT_EQUIPMENT;
        }
        return $decoded;
    }

    /** Everything, typed, for the API. */
    public static function toArray(): array
    {
        return [
            'business_hours_start' => self::businessHoursStart(),
            'business_hours_end'   => self::businessHoursEnd(),
            'closed_days'          => self::closedDays(),
            'semester_start'       => self::semesterStart(),
            'semester_end'         => self::semesterEnd(),
            'equipment_list'       => self::equipmentList(),
        ];
    }

    /** 'Saturday, Sunday' -> ['Saturday', 'Sunday'], keeping only real weekday names. */
    public static function parseDays(string $value): array
    {
        $days = array_map('trim', explode(',', $value));
        return array_values(array_filter(self::WEEKDAYS, static fn(string $d): bool => in_array($d, $days, true)));
    }

    /** Drop the cached values (after an Admin saves new ones). */
    public static function reset(): void
    {
        self::$values = null;
    }

    private static function get(string $key): string
    {
        if (self::$values === null) {
            try {
                self::$values = (new SettingsRepository())->all() + self::DEFAULTS;
            } catch (\PDOException $e) {
                // Table not created yet: keep enforcing the long-standing rules.
                error_log('[CampusRoom] system_settings unavailable, using defaults: ' . $e->getMessage());
                self::$values = self::DEFAULTS;
            }
        }
        return self::$values[$key] ?? self::DEFAULTS[$key];
    }
}
