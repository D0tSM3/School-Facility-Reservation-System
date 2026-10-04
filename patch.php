<?php
$content = file_get_contents("public/js/booking.js");

// 1. Update validateTime
$validateTimeFind = <<<'EOD'
  const validateTime = () => {
    if (startTimeInput && endTimeInput && startTimeInput.value && endTimeInput.value) {
      if (endTimeInput.value <= startTimeInput.value) {
EOD;

$validateTimeReplace = <<<'EOD'
  const validateTime = () => {
    if (startTimeInput && endTimeInput && startTimeInput.value) {
      const mode = getBookingMode();
      const start = startDateValue();
      const now = new Date();
      const todayStr = toYMD(now);
      const nowTimeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      
      if (mode === 'single' && start === todayStr && startTimeInput.value <= nowTimeStr) {
        showCollisionError('Reservations must start in the future.', 'Invalid time');
        return false;
      }

      if (endTimeInput.value && endTimeInput.value <= startTimeInput.value) {
EOD;

$content = str_replace($validateTimeFind, $validateTimeReplace, $content);

// 2. Update submit handler to not override validateTime
$submitFind = <<<'EOD'
      if (!validateTime()) {
        return showCollisionError('End time must be after the start time.', 'Invalid time');
      }
EOD;

$submitReplace = <<<'EOD'
      if (!validateTime()) {
        return;
      }
EOD;

$content = str_replace($submitFind, $submitReplace, $content);

file_put_contents("public/js/booking.js", $content);
echo "Done\n";
