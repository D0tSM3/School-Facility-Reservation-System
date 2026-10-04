<?php
$content = file_get_contents("public/js/booking.js");
$content = str_replace(
    "return true;\n        }",
    "const evt = new Event('change'); document.getElementById('roomReservationForm')?.dispatchEvent(evt);\n          return true;\n        }",
    $content
);
$content = str_replace(
    "return false; // blocks normal submit",
    "const evt = new Event('change'); document.getElementById('roomReservationForm')?.dispatchEvent(evt);\n          return false; // blocks normal submit",
    $content
);
file_put_contents("public/js/booking.js", $content);
echo "Done\n";
