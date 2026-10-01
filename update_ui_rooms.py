import re

with open("public/rooms.html", "r", encoding="utf-8") as f:
    html = f.read()

# Replace the Reservation Type section and Date Section
old_booking_block = re.search(r'<div class="flex flex-col space-y-2">\s*<span class="text-sm font-bold text-gray-800">Reservation Type.*?<p id="dateError" class="hidden text-xs font-semibold text-red-600"></p>\s*</div>', html, re.DOTALL)
if old_booking_block:
    html = html.replace(old_booking_block.group(0), """
              <div class="flex flex-col mb-4">
                <span class="text-[10px] font-extrabold text-[#2a303c] uppercase tracking-widest mb-3 block">BOOKING TYPE</span>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label class="cursor-pointer relative">
                    <input type="radio" name="booking_mode" value="single" class="peer sr-only" checked>
                    <div class="h-full p-3 sm:p-4 border border-gray-300 rounded-xl transition-all peer-checked:border-[#7a1f2b] peer-checked:border-2 peer-checked:bg-[#faf5f6]">
                      <div class="font-bold text-[#1e293b] text-[13px] md:text-sm">One Day Booking</div>
                      <div class="text-[11px] md:text-xs text-gray-500 mt-1">Reserve a room for one specific date.</div>
                    </div>
                  </label>
                  <label class="cursor-pointer relative">
                    <input type="radio" name="booking_mode" value="range" class="peer sr-only">
                    <div class="h-full p-3 sm:p-4 border border-gray-300 rounded-xl transition-all peer-checked:border-[#7a1f2b] peer-checked:border-2 peer-checked:bg-[#faf5f6]">
                      <div class="font-bold text-[#1e293b] text-[13px] md:text-sm">Consecutive Range</div>
                      <div class="text-[11px] md:text-xs text-gray-500 mt-1">Reserve the same schedule across consecutive dates.</div>
                    </div>
                  </label>
                  <label class="cursor-pointer relative">
                    <input type="radio" name="booking_mode" value="specific" class="peer sr-only">
                    <div class="h-full p-3 sm:p-4 border border-gray-300 rounded-xl transition-all peer-checked:border-[#7a1f2b] peer-checked:border-2 peer-checked:bg-[#faf5f6]">
                      <div class="font-bold text-[#1e293b] text-[13px] md:text-sm">Specific Days</div>
                      <div class="text-[11px] md:text-xs text-gray-500 mt-1">Choose specific days within a date range.</div>
                    </div>
                  </label>
                </div>
              </div>

              <div class="flex flex-col mb-4 mt-6">
                <span class="text-[10px] font-extrabold text-[#2a303c] uppercase tracking-widest mb-3 block">DATE</span>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div class="flex flex-col space-y-1.5 w-full" id="resDateWrapper">
                    <label for="resDate" class="text-xs font-bold text-[#2a303c]" id="resDateLabel">Date</label>
                    <div class="relative">
                      <input id="resDate" type="date" class="w-full px-3.5 py-2.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-[#7a1f2b] focus:border-[#7a1f2b] appearance-none" required />
                    </div>
                  </div>
                  <div class="flex flex-col space-y-1.5 w-full hidden" id="resEndDateWrapper">
                    <label for="resEndDate" class="text-xs font-bold text-[#2a303c]">To</label>
                    <div class="relative">
                      <input id="resEndDate" type="date" class="w-full px-3.5 py-2.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-[#7a1f2b] focus:border-[#7a1f2b] appearance-none" />
                    </div>
                  </div>
                </div>
                
                <p id="dateRangeHint" class="text-xs text-gray-500 mt-2">Select one date for your reservation.</p>
                <p id="dateError" class="hidden text-xs font-semibold text-red-600 mt-1"></p>

                <div id="specificDaysWrapper" class="hidden flex-col mt-4">
                  <div class="border border-gray-200 rounded-xl bg-white overflow-hidden shadow-sm">
                    <div class="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-[#f8f9fb]">
                      <span class="text-sm font-bold text-[#1e293b]">Select specific days</span>
                      <span class="text-xs text-gray-500 font-medium" id="selectedDaysCount">0 selected</span>
                    </div>
                    <div class="p-4 sm:p-5">
                      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3" id="dayCheckboxes">
                        <!-- Populated by JS -->
                      </div>
                    </div>
                  </div>
                </div>
              </div>
""")

# Now replace the Time block
old_time_block = re.search(r'<!-- Time Selectors.*?</div>\s*</div>\s*</div>', html, re.DOTALL)
if old_time_block:
    html = html.replace(old_time_block.group(0), """
              <div class="flex flex-col mb-4 mt-6">
                <span class="text-[10px] font-extrabold text-[#2a303c] uppercase tracking-widest mb-3 block">TIME</span>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div class="flex flex-col space-y-1.5 w-full">
                    <label class="text-xs font-bold text-[#2a303c]" for="startTime">Start Time</label>
                    <div class="relative">
                      <select id="startTime" class="w-full px-3.5 py-2.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-[#7a1f2b] focus:border-[#7a1f2b] appearance-none" required>
                        <option value="">Select Start Time</option>
                      </select>
                      <span class="absolute right-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-[18px] text-gray-400 pointer-events-none">expand_more</span>
                    </div>
                  </div>
                  <div class="flex flex-col space-y-1.5 w-full">
                    <label class="text-xs font-bold text-[#2a303c]" for="endTime">End Time</label>
                    <div class="relative">
                      <select id="endTime" class="w-full px-3.5 py-2.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-[#7a1f2b] focus:border-[#7a1f2b] appearance-none" required disabled>
                        <option value="">Select End Time</option>
                      </select>
                      <span class="absolute right-3.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-[18px] text-gray-400 pointer-events-none">expand_more</span>
                    </div>
                  </div>
                </div>
              </div>
""")

with open("public/rooms.html", "w", encoding="utf-8") as f:
    f.write(html)
