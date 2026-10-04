<?php
$content = file_get_contents("public/js/roomCalendar.js");

// 1. Calculate hasConflict and update baseBg
$findBaseBg = <<<'EOD'
        const overlapsSelected = isSelected && this.selectedStartTime && this.selectedEndTime &&
                                 overlaps(this.selectedStartTime, this.selectedEndTime);

        let baseBg = isSelected
          ? (overlapsSelected ? 'bg-rose-100 shadow-[inset_0_0_0_2px_#7a1f2b] relative z-10' : 'bg-[#fdf5f6]')
          : beforeOpen ? 'bg-gray-50' : 'bg-white';
EOD;

$replaceBaseBg = <<<'EOD'
        const overlapsSelected = isSelected && this.selectedStartTime && this.selectedEndTime &&
                                 overlaps(this.selectedStartTime, this.selectedEndTime);
                                 
        const hasClass = (data.class_schedules || []).some(c => c.day_of_week === dayName && overlaps(c.start_time.slice(0, 5), c.end_time.slice(0, 5)));
        const hasReservation = (data.reservations || []).some(r => r.start_time.startsWith(dateYMD) && overlaps(r.start_time.slice(11, 16), r.end_time.slice(11, 16)));
        const isConflict = overlapsSelected && (hasClass || hasReservation);

        let baseBg = isSelected
          ? (isConflict ? 'bg-orange-50 shadow-[inset_0_0_0_2px_#f97316] relative z-10' : (overlapsSelected ? 'bg-rose-100 shadow-[inset_0_0_0_2px_#7a1f2b] relative z-10' : 'bg-[#fdf5f6]'))
          : beforeOpen ? 'bg-gray-50' : 'bg-white';
EOD;
$content = str_replace($findBaseBg, $replaceBaseBg, $content);

// 2. Class bg replacement
$findClassBg = <<<'EOD'
            .forEach(c => {
              td.className = td.className.replace(/bg-\S+/g, '') + ' bg-blue-50 p-0.5';
EOD;

$replaceClassBg = <<<'EOD'
            .forEach(c => {
              td.className = td.className.replace(/bg-\S+/g, '') + (isConflict ? ' bg-orange-50' : ' bg-blue-50') + ' p-0.5';
EOD;
$content = str_replace($findClassBg, $replaceClassBg, $content);

// 3. Reservation bg replacement
$findResBg = <<<'EOD'
            .forEach(r => {
              const pending = r.status === 'Pending';
              td.className = td.className.replace(/bg-\S+/g, '') + (pending ? ' bg-amber-50 p-0.5' : ' bg-emerald-50 p-0.5');
EOD;

$replaceResBg = <<<'EOD'
            .forEach(r => {
              const pending = r.status === 'Pending';
              td.className = td.className.replace(/bg-\S+/g, '') + (isConflict ? ' bg-orange-50 p-0.5' : (pending ? ' bg-amber-50 p-0.5' : ' bg-emerald-50 p-0.5'));
EOD;
$content = str_replace($findResBg, $replaceResBg, $content);

file_put_contents("public/js/roomCalendar.js", $content);
echo "Done\n";
