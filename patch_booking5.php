<?php
$content = file_get_contents("public/js/booking.js");
$find = "if (mode === 'single' && start === todayStr && startTimeInput.value <= nowTimeStr) {";
$replace = "if (mode === 'single' && start === todayStr && startTimeInput.value <= nowTimeStr) {
          const conflictBanner = document.getElementById('conflictBanner');
          const requestSlipBtn = document.getElementById('requestSlipBtn');
          if (conflictBanner) conflictBanner.classList.add('hidden');
          if (requestSlipBtn) requestSlipBtn.classList.add('hidden');";
$content = str_replace($find, $replace, $content);
file_put_contents("public/js/booking.js", $content);
echo "Done\n";
