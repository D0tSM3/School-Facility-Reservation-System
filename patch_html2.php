<?php
$html = <<< 'EOD'
    <!-- Request Slip Modal Overlay -->
    <div id="requestSlipModalOverlay" class="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-[200] hidden items-center justify-center p-4 sm:p-8 overflow-y-auto">
      <div class="relative w-full max-w-[700px] my-auto bg-white rounded-2xl shadow-xl flex flex-col">
        <!-- Close Button -->
        <button id="closeRequestSlipModalBtn" class="absolute top-4 right-4 text-gray-400 hover:text-gray-700 p-2 rounded-lg bg-white shadow-sm border border-gray-100 z-10 transition-colors cursor-pointer" type="button">
           <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
        <div class="max-h-[85vh] overflow-y-auto rounded-2xl relative p-6">
          <h2 class="text-xl font-bold text-gray-900 mb-4">Request Slip</h2>
          
          <!-- Read-only Summary -->
          <div class="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-6 text-sm text-gray-700">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-4">
              <div><span class="font-semibold text-gray-500">Facility:</span> <span id="rsFacility"></span></div>
              <div><span class="font-semibold text-gray-500">Date:</span> <span id="rsDate"></span></div>
              <div><span class="font-semibold text-gray-500">Requested Time:</span> <span id="rsTime"></span></div>
              <div><span class="font-semibold text-gray-500">Status:</span> <span class="text-orange-600 font-bold">Conflict</span></div>
              <div class="col-span-1 sm:col-span-2"><span class="font-semibold text-gray-500">Existing Conflict:</span> <span id="rsConflictInfo"></span></div>
            </div>
          </div>

          <form id="requestSlipForm" class="space-y-5">
            <div>
              <label class="text-[10px] font-extrabold text-[#2a303c] uppercase tracking-widest mb-2 block">Request Type <span class="text-red-500">*</span></label>
              <select name="request_type" class="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-[#7a1f2b] focus:border-[#7a1f2b]" required>
                <option value="">Select Type</option>
                <option value="Schedule Conflict">Schedule Conflict</option>
                <option value="Academic Requirement">Academic Requirement</option>
                <option value="Faculty-Directed Activity">Faculty-Directed Activity</option>
                <option value="Special Event">Special Event</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label class="text-[10px] font-extrabold text-[#2a303c] uppercase tracking-widest mb-2 block">Reason <span class="text-red-500">*</span></label>
              <textarea name="reason" rows="3" class="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-[#7a1f2b] focus:border-[#7a1f2b]" placeholder="Why do you need this facility despite the conflict?" required></textarea>
            </div>

            <div>
              <label class="text-[10px] font-extrabold text-[#2a303c] uppercase tracking-widest mb-2 block">Additional Information</label>
              <textarea name="additional_info" rows="2" class="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-[#7a1f2b] focus:border-[#7a1f2b]" placeholder="Optional"></textarea>
            </div>

            <div>
              <label class="text-[10px] font-extrabold text-[#2a303c] uppercase tracking-widest mb-2 block">Alternative Schedule?</label>
              <select id="rsAltSchedule" class="w-full p-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:ring-[#7a1f2b] focus:border-[#7a1f2b]">
                <option value="No">No</option>
                <option value="Yes">Yes</option>
              </select>
            </div>

            <div id="rsAltScheduleFields" class="hidden grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label class="text-xs font-semibold text-gray-600 block mb-1">Alternative Date</label>
                <input type="date" name="alt_date" class="w-full p-2 border border-gray-300 rounded-md text-sm">
              </div>
              <div>
                <label class="text-xs font-semibold text-gray-600 block mb-1">Alternative Start</label>
                <input type="time" name="alt_start" class="w-full p-2 border border-gray-300 rounded-md text-sm">
              </div>
              <div>
                <label class="text-xs font-semibold text-gray-600 block mb-1">Alternative End</label>
                <input type="time" name="alt_end" class="w-full p-2 border border-gray-300 rounded-md text-sm">
              </div>
            </div>

            <div class="flex items-start gap-3 p-4 bg-gray-50 border border-gray-100 rounded-xl mt-4">
              <input type="checkbox" id="rsAcknowledgement" class="mt-1 w-4 h-4 text-[#7A1F2B] border-gray-300 rounded focus:ring-[#7A1F2B]" required>
              <label for="rsAcknowledgement" class="text-xs text-gray-600 leading-relaxed cursor-pointer select-none">
                I understand that submitting this request does not guarantee approval. The requested time remains unavailable until staff approves the request.
              </label>
            </div>

            <div class="flex justify-end gap-3 mt-6">
              <button type="button" id="cancelRequestSlipBtn" class="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 font-medium text-sm rounded-xl hover:bg-gray-50 transition-colors shadow-sm">Cancel</button>
              <button type="submit" class="px-6 py-2.5 bg-[#7a1f2b] hover:bg-[#5b0617] text-white font-medium text-sm rounded-xl transition-all shadow-sm">Submit Request Slip</button>
            </div>
          </form>
        </div>
      </div>
    </div>
EOD;
$content = file_get_contents("public/rooms.html");
$content = str_replace("</body>", $html . "\n</body>", $content);
file_put_contents("public/rooms.html", $content);
echo "Done\n";
