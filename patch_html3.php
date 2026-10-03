<?php
$content = file_get_contents("public/rooms.html");
$find = "if (!startTime || !startTime.value) return false;";
$replace = "const conflictBanner = document.getElementById('conflictBanner');\n          if (conflictBanner && !conflictBanner.classList.contains('hidden')) return false;\n\n          " . $find;
$content = str_replace($find, $replace, $content);
file_put_contents("public/rooms.html", $content);
echo "Done\n";
