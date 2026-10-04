<?php
$content = file_get_contents("public/js/booking.js");

// 1. Remove textContent modifications in syncEndOptions
$content = preg_replace(
    '/(const clash = rangeConflicts\(start, o\.value\);\s*if \(clash\.length\) \{)[^\}]+\}/s',
    '$1
              // The UI is now handled by validateTime() on selection.
            }',
    $content
);

// 2. Remove textContent modifications in markTakenSlots
$content = preg_replace(
    '/(const clash = window\.CampusSchedule\.findRangeConflicts\(data, dates, bs, be\);)[^\}]+(\}\);)/s',
    '$1
      // The UI is now handled by validateTime() on selection.
    $2',
    $content
);

file_put_contents("public/js/booking.js", $content);
echo "Done\n";
