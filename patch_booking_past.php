<?php
$content = file_get_contents("public/js/booking.js");
$find = "// ---- Grey out start-time blocks that are taken on every day of the range ----\n    Array.from(startTimeInput.options).forEach(opt => {\n      if (!opt.value) return;";
$replace = "const now = new Date();\n    const isToday = mode === 'single' && start === toYMD(now);\n    const nowTimeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');\n\n    // ---- Grey out start-time blocks that are taken on every day of the range ----\n    Array.from(startTimeInput.options).forEach(opt => {\n      if (!opt.value) return;\n      if (isToday && opt.value <= nowTimeStr) {\n        opt.disabled = true;\n        opt.hidden = true;\n        return;\n      } else {\n        opt.disabled = false;\n        opt.hidden = false;\n      }";
$content = str_replace($find, $replace, $content);
file_put_contents("public/js/booking.js", $content);
echo "Done\n";
