<?php

declare(strict_types=1);

namespace CampusRoom\Core;

final class Timing
{
    public static function pad(int $startedAt, int $floorMilliseconds): void
    {
        $floorNanoseconds = $floorMilliseconds * 1_000_000;
        $elapsedNanoseconds = hrtime(true) - $startedAt;
        $remainingNanoseconds = $floorNanoseconds - $elapsedNanoseconds;

        if ($remainingNanoseconds > 0) {
            usleep((int) ceil($remainingNanoseconds / 1_000));
        }
    }
}
