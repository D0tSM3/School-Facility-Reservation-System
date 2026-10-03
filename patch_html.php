<?php
$content = file_get_contents("public/rooms.html");

// Add Conflict Banner
$content = preg_replace(
    '/(<div id="rebookNoticeBanner")/',
    '<!-- New Conflict Banner -->
            <div id="conflictBanner" class="hidden items-start gap-3 p-4 bg-orange-50 border border-orange-200 text-orange-800 rounded-xl">
              <span class="material-symbols-outlined text-orange-600 mt-0.5">warning</span>
              <div class="flex flex-col">
                <span id="conflictTitle" class="text-sm font-bold">Conflict detected</span>
                <p id="conflictText" class="text-xs mt-0.5">This selected time overlaps with an existing reservation. You may submit a Request Slip for staff review.</p>
              </div>
            </div>

            $1',
    $content
);

// Add Request Slip button
$content = preg_replace(
    '/(<button id="bookingSubmitBtn")/',
    '<!-- Request Slip Button -->
              <button id="requestSlipBtn" type="button" class="hidden w-full sm:w-auto px-6 py-2.5 bg-yellow-500 text-white font-medium text-sm rounded-xl flex items-center justify-center gap-2 transition-all shadow-sm hover:bg-yellow-600">
                <span class="material-symbols-outlined text-[18px]">assignment_add</span>
                Request Slip
              </button>
              $1',
    $content
);

file_put_contents("public/rooms.html", $content);
echo "Done\n";
