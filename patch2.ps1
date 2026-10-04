$file = Get-Content public\js\reservations.js -Raw

$find = <<<'EOD'
      return `<div data-status="${escapeHtml(filterStatus)}" class="reservation-card bg-white px-5 py-4 rounded-xl border border-gray-200 shadow-sm mb-3 transition-all hover:border-gray-300 hover:shadow">
        <div class="flex items-center gap-5">

          <!-- Date block: month + year on same header line, large day below -->
          <div class="border border-gray-200 rounded-lg overflow-hidden text-center min-w-[68px] shrink-0 flex flex-col bg-white">
            <div class="bg-[#7a1f2b] text-white text-[9px] font-bold py-1 px-1 uppercase tracking-widest whitespace-nowrap">${date.month} ${date.year}</div>
            <div class="text-2xl font-bold text-gray-900 py-2 leading-none">${date.day}</div>
          </div>
EOD

$replace = <<<'EOD'
      return `<div data-status="${escapeHtml(filterStatus)}" class="reservation-card bg-white px-5 py-4 rounded-xl border border-gray-200 shadow-sm mb-3 transition-all hover:border-gray-300 hover:shadow">
        <div class="flex items-center gap-5">

          ${dateBlockHtml}
EOD

$find = $find -replace '\r\n', "`n"
$replace = $replace -replace '\r\n', "`n"
$file = $file -replace '\r\n', "`n"
$file = $file.Replace($find, $replace)

Set-Content public\js\reservations.js $file
