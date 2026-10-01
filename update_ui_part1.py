import re

with open("public/rooms.html", "r", encoding="utf-8") as f:
    html = f.read()

# I need to locate the existing Reservation Type and Dates sections
# Let's completely replace everything inside the container that holds dates.
# Actually, it's easier to find the old block and replace it.

old_block = r'<div class="flex flex-col space-y-2">\s*<span class="text-sm font-bold text-gray-800">Reservation Type.*?<p id="dateError" class="hidden text-xs font-semibold text-red-600"></p>\s*</div>'

new_block = """
              <div class="flex flex-col mb-4">
                <span class="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 block">BOOKING TYPE</span>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label class="cursor-pointer relative">
                    <input type="radio" name="booking_mode" value="single" class="peer sr-only" checked>
                    <div class="h-full p-3 sm:p-4 border border-gray-200 rounded-xl transition-all peer-checked:border-[#7a1f2b] peer-checked:border-2 peer-checked:bg-[#faf5f6]">
                      <div class="font-bold text-gray-900 text-[13px] md:text-sm">One Day Booking</div>
                      <div class="text-[11px] md:text-xs text-gray-500 mt-1">Reserve a room for one specific date.</div>
                    </div>
                  </label>
                  <label class="cursor-pointer relative">
                    <input type="radio" name="booking_mode" value="range" class="peer sr-only">
                    <div class="h-full p-3 sm:p-4 border border-gray-200 rounded-xl transition-all peer-checked:border-[#7a1f2b] peer-checked:border-2 peer-checked:bg-[#faf5f6]">
                      <div class="font-bold text-gray-900 text-[13px] md:text-sm">Consecutive Range</div>
                      <div class="text-[11px] md:text-xs text-gray-500 mt-1">Reserve the same schedule across consecutive dates.</div>
                    </div>
                  </label>
                  <label class="cursor-pointer relative">
                    <input type="radio" name="booking_mode" value="specific" class="peer sr-only">
                    <div class="h-full p-3 sm:p-4 border border-gray-200 rounded-xl transition-all peer-checked:border-[#7a1f2b] peer-checked:border-2 peer-checked:bg-[#faf5f6]">
                      <div class="font-bold text-gray-900 text-[13px] md:text-sm">Specific Days</div>
                      <div class="text-[11px] md:text-xs text-gray-500 mt-1">Choose specific days within a date range.</div>
                    </div>
                  </label>
                </div>
              </div>

              <div class="flex flex-col mb-4">
                <span class="text-xs font-bold text-gray-600 uppercase tracking-wider mb-2 block">DATE</span>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div class="flex flex-col space-y-1 w-full" id="resDateWrapper">
                    <label for="resDate" class="text-[11px] font-semibold text-gray-700" id="resDateLabel">Date</label>
                    <div class="relative">
                      <input id="resDate" type="date" class="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-[#7a1f2b] focus:border-[#7a1f2b]" required />
                    </div>
                  </div>
                  <div class="flex flex-col space-y-1 w-full hidden" id="resEndDateWrapper">
                    <label for="resEndDate" class="text-[11px] font-semibold text-gray-700">To</label>
                    <div class="relative">
                      <input id="resEndDate" type="date" class="w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-[#7a1f2b] focus:border-[#7a1f2b]" />
                    </div>
                  </div>
                </div>
                
                <p id="dateRangeHint" class="text-xs text-gray-500 mt-2">Select one date for your reservation.</p>
                <p id="dateError" class="hidden text-xs font-semibold text-red-600 mt-1"></p>

                <div id="specificDaysWrapper" class="hidden flex-col mt-4">
                  <div class="border border-gray-200 rounded-xl bg-[#fafbfc] overflow-hidden">
                    <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
                      <span class="text-sm font-bold text-gray-800">Select specific days</span>
                      <span class="text-xs text-gray-500 font-medium" id="selectedDaysCount">0 selected</span>
                    </div>
                    <div class="p-4">
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3" id="dayCheckboxes">
                        <!-- Populated by JS -->
                      </div>
                    </div>
                  </div>
                </div>
              </div>
"""

html = re.sub(old_block, new_block, html, flags=re.DOTALL)

# Let's also add the "TIME" header above start time and end time.
old_time_block = r'<div class="flex flex-col space-y-2">\s*<span class="text-sm font-bold text-gray-800">Reservation Time <span class="text-red-500">\*</span></span>'
# Wait, in the actual file, what does the time block look like?
# Let's check using python regex.
