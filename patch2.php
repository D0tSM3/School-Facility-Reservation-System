<?php
$content = file_get_contents("public/js/booking.js");

$content = preg_replace(
    '/const validateTime = \(\) => \{(.*?)\};\s+if \(endTimeInput\)/s',
    'const validateTime = () => {
    if (startTimeInput && endTimeInput && startTimeInput.value) {
      const mode = getBookingMode();
      const start = startDateValue();
      const now = new Date();
      const todayStr = toYMD(now);
      const nowTimeStr = String(now.getHours()).padStart(2, \'0\') + \':\' + String(now.getMinutes()).padStart(2, \'0\');
      
      if (mode === \'single\' && start === todayStr && startTimeInput.value <= nowTimeStr) {
        showCollisionError(\'Reservations must start in the future.\', \'Invalid time\');
        return false;
      }

      if (endTimeInput.value && endTimeInput.value <= startTimeInput.value) {
        // Use the collision error banner already present in rooms.html
        showCollisionError(\'End time must be after the start time.\', \'Invalid time\');
        return false;
      } else {
        // Clear any time-related error if times are now valid
        hideCollisionError();
        return true;
      }
    }
    return true;
  };

  if (endTimeInput)',
    $content
);

$content = preg_replace(
    '/if \(\!validateTime\(\)\) \{\s*return showCollisionError\([^\)]+\);\s*\}/s',
    'if (!validateTime()) {
        return;
      }',
    $content
);

file_put_contents("public/js/booking.js", $content);
echo "Done\n";
