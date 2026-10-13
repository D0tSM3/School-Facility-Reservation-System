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
