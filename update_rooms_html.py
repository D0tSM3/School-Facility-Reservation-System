import re

with open("public/rooms.html", "r", encoding="utf-8") as f:
    html = f.read()

# Replace the Reservation Dates section
old_dates = """              <div class="flex flex-col space-y-2">
                <span class="text-sm font-bold text-gray-800">Reservation Dates <span class="text-red-500">*</span></span>
                <div class="grid grid-cols-2 gap-2">
                  <div class="relative">
                    <label for="resDate" class="sr-only">Start date</label>
                    <span class="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-wider text-gray-400">From</span>
                    <input id="resDate" type="date" class="w-full pl-12 pr-2 py-2.5 bg-[#f8f9fb] border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-[#7a1f2b] focus:border-[#7a1f2b]" required />
                  </div>
                  <div class="relative">
                    <label for="resEndDate" class="sr-only">End date</label>
                    <span class="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-wider text-gray-400">To</span>
                    <input id="resEndDate" type="date" class="w-full pl-12 pr-2 py-2.5 bg-[#f8f9fb] border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-[#7a1f2b] focus:border-[#7a1f2b]" required />
                  </div>
                </div>
                <p id="dateRangeHint" class="text-xs text-gray-500">For one day, use the same date twice. The start and end times below apply to every day in the range.</p>
                <p id="dateError" class="hidden text-xs font-semibold text-red-600"></p>
              </div>"""

new_dates = """              <div class="flex flex-col space-y-2">
                <span class="text-sm font-bold text-gray-800">Reservation Type <span class="text-red-500">*</span></span>
                
                <div class="flex flex-col gap-2 mb-2">
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="booking_mode" value="single" class="accent-[#7a1f2b]" checked>
                    <span class="text-sm text-gray-700">One Day Booking</span>
                  </label>
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="booking_mode" value="range" class="accent-[#7a1f2b]">
                    <span class="text-sm text-gray-700">Multiple Days (Consecutive Range)</span>
                  </label>
                  <label class="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="booking_mode" value="specific" class="accent-[#7a1f2b]">
                    <span class="text-sm text-gray-700">Multiple Days (Specific Days)</span>
                  </label>
                </div>

                <div class="grid grid-cols-2 gap-2" id="dateInputContainer">
                  <div class="relative w-full" id="resDateWrapper">
                    <label for="resDate" class="sr-only">Date</label>
                    <span class="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-wider text-gray-400" id="resDateLabel">Date</span>
                    <input id="resDate" type="date" class="w-full pl-12 pr-2 py-2.5 bg-[#f8f9fb] border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-[#7a1f2b] focus:border-[#7a1f2b]" required />
                  </div>
                  <div class="relative w-full hidden" id="resEndDateWrapper">
                    <label for="resEndDate" class="sr-only">End date</label>
                    <span class="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-wider text-gray-400">To</span>
                    <input id="resEndDate" type="date" class="w-full pl-12 pr-2 py-2.5 bg-[#f8f9fb] border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-[#7a1f2b] focus:border-[#7a1f2b]" />
                  </div>
                </div>

                <div id="specificDaysWrapper" class="hidden flex-col gap-2 mt-2">
                  <span class="text-xs font-bold text-gray-600 uppercase tracking-wider">Select Days within Range (Max 7 Days)</span>
                  <div class="flex flex-wrap gap-2" id="dayCheckboxes">
                    <!-- Populated by JS based on date range -->
                  </div>
                </div>

                <p id="dateRangeHint" class="text-xs text-gray-500">Select a single date.</p>
                <p id="dateError" class="hidden text-xs font-semibold text-red-600"></p>
              </div>"""

html = html.replace(old_dates, new_dates)

with open("public/rooms.html", "w", encoding="utf-8") as f:
    f.write(html)
