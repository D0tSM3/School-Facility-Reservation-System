<?php
$content = file_get_contents("public/js/roomCalendar.js");

$content = preg_replace(
    '/(<span class="inline-flex items-center gap-1\.5 px-2\.5 py-1 rounded-full border border-blue-200 bg-blue-50 text-\[11px\] font-semibold text-blue-700">)/',
    '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-orange-200 bg-orange-50 text-[11px] font-semibold text-orange-700">
            <span class="w-2 h-2 rounded-full bg-orange-500 inline-block"></span>Conflict
          </span>
          $1',
    $content
);

file_put_contents("public/js/roomCalendar.js", $content);
echo "Done\n";
