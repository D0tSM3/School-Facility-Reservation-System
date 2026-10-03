<?php
$content = file_get_contents("public/rooms.html");
$content = str_replace(
    '<div id="rsAltScheduleFields" class="hidden grid-cols-1 sm:grid-cols-3',
    '<div id="rsAltScheduleFields" class="hidden grid grid-cols-1 sm:grid-cols-3',
    $content
);
file_put_contents("public/rooms.html", $content);
echo "Done\n";
