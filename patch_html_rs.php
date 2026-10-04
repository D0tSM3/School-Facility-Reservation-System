<?php
$content = file_get_contents("public/rooms.html");

$html = <<< 'EOD'
      <!-- Request Slip Modal Overlay -->
      <div id="requestSlipModalOverlay" class="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-[200] hidden items-center justify-center p-4 sm:p-8 overflow-y-auto">
        <div class="relative w-full max-w-[700px] my-auto bg-white rounded-2xl shadow-xl flex flex-col overflow-hidden">
          
          <!-- Close Button -->
          <button id="closeRequestSlipModalBtn" class="absolute top-4 right-4 text-gray-400 hover:text-gray-700 p-2 rounded-lg bg-white shadow-sm border border-gray-100 z-10 transition-colors cursor-pointer" type="button">
             <span class="material-symbols-outlined text-[20px]">close</span>
          </button>
          
          <!-- Modal Header (Consistent with main booking modal) -->
          <div class="bg-[#f8f9fb] px-6 py-5 flex items-center gap-4 border-b border-gray-200 shrink-0">
            <div class="w-10 h-10 rounded-xl bg-orange-500 flex items-center justify-center text-white shadow-sm shrink-0">
              <span class="material-symbols-outlined text-[20px]">assignment_add</span>
            </div>
            <div>
              <h2 class="text-lg font-bold text-gray-900 leading-tight">Request Slip</h2>
              <div class="flex items-center gap-3 mt-1 text-xs font-semibold text-gray-500">
                <span class="flex items-center gap-1"><span class="w-2 h-2 rounded-full bg-orange-500"></span>Conflict Override Request</span>
              </div>
            </div>
          </div>
          
          <div class="overflow-y-auto p-6 max-h-[75vh]">
            <!-- Read-only Summary -->
            <div class="bg-orange-50 border border-orange-200 rounded-xl p-5 mb-6 text-sm text-orange-900">
              <h3 class="text-sm font-bold mb-3 flex items-center gap-2">
                <span class="material-symbols-outlined text-orange-600 text-[18px]">warning</span>
                Overlapping Reservation Details
              </h3>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-4">
                <div><span class="font-bold text-orange-800 text-xs uppercase tracking-widest block mb-0.5">Facility</span> <span id="rsFacility" class="font-medium"></span></div>
                <div><span class="font-bold text-orange-800 text-xs uppercase tracking-widest block mb-0.5">Date</span> <span id="rsDate" class="font-medium"></span></div>
                <div><span class="font-bold text-orange-800 text-xs uppercase tracking-widest block mb-0.5">Requested Time</span> <span id="rsTime" class="font-medium"></span></div>
                <div><span class="font-bold text-orange-800 text-xs uppercase tracking-widest block mb-0.5">Status</span> <span class="font-bold">Conflict</span></div>
                <div class="col-span-1 sm:col-span-2"><span class="font-bold text-orange-800 text-xs uppercase tracking-widest block mb-0.5">Existing Conflict</span> <span id="rsConflictInfo" class="font-medium text-orange-800/80 bg-orange-100/50 px-2 py-1 rounded inline-block"></span></div>
              </div>
            </div>
  
            <form id="requestSlipForm" class="space-y-5">
              
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label class="text-[10px] font-extrabold text-[#2a303c] uppercase tracking-widest mb-3 block">Request Type <span class="text-red-500">*</span></label>
                  <select name="request_type" class="w-full p-3.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-[#7a1f2b] focus:border-[#7a1f2b] shadow-sm" required>
                    <option value="" disabled selected>Select Request Type</option>
                    <option value="Schedule Conflict">Schedule Conflict</option>
                    <option value="Academic Requirement">Academic Requirement</option>
                    <option value="Faculty-Directed Activity">Faculty-Directed Activity</option>
                    <option value="Special Event">Special Event</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label class="text-[10px] font-extrabold text-[#2a303c] uppercase tracking-widest mb-3 block">Alternative Schedule?</label>
                  <select id="rsAltSchedule" class="w-full p-3.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-[#7a1f2b] focus:border-[#7a1f2b] shadow-sm">
                    <option value="No" selected>No, I need this specific time</option>
                    <option value="Yes">Yes, I can reschedule</option>
                  </select>
                </div>
              </div>

              <div id="rsAltScheduleFields" class="hidden grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-gray-50 border border-gray-200 rounded-xl">
                <div>
                  <label class="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest block mb-2">Alternative Date</label>
                  <input type="date" name="alt_date" class="w-full p-3 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400">
                </div>
                <div>
                  <label class="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest block mb-2">Alternative Start</label>
                  <input type="time" name="alt_start" class="w-full p-3 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400">
                </div>
                <div>
                  <label class="text-[10px] font-extrabold text-gray-600 uppercase tracking-widest block mb-2">Alternative End</label>
                  <input type="time" name="alt_end" class="w-full p-3 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400">
                </div>
              </div>
  
              <div class="flex flex-col space-y-2">
                <span class="text-[10px] font-extrabold text-[#2a303c] uppercase tracking-widest mb-3 block">JUSTIFICATION / REASON <span class="text-red-500">*</span></span>
                <textarea name="reason" rows="3" maxlength="300" class="w-full p-3.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-[#7a1f2b] focus:border-[#7a1f2b] shadow-sm" placeholder="Why do you need this facility despite the conflict? Be specific." required></textarea>
              </div>
  
              <div class="flex flex-col space-y-2">
                <span class="text-[10px] font-extrabold text-[#2a303c] uppercase tracking-widest mb-3 block">ADDITIONAL INFORMATION</span>
                <textarea name="additional_info" rows="2" maxlength="200" class="w-full p-3.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-[#7a1f2b] focus:border-[#7a1f2b] shadow-sm" placeholder="Any other logistical requirements or context..."></textarea>
              </div>
  
              <div class="p-5 bg-amber-50 rounded-xl border border-amber-200 mt-6">
                <label class="flex items-start gap-3 cursor-pointer">
                  <input id="rsAcknowledgement" class="mt-0.5 rounded text-[#7a1f2b] focus:ring-[#7a1f2b] w-4 h-4 shrink-0" type="checkbox" required />
                  <div class="flex flex-col">
                    <span class="text-sm font-bold text-amber-900">Request Slip Acknowledgement</span>
                    <p class="text-xs text-amber-800 mt-1 leading-relaxed">
                      I understand that submitting this request does not guarantee approval. The requested time remains unavailable until staff explicitly overrides the conflict and approves the request.
                    </p>
                  </div>
                </label>
              </div>
            </form>
          </div>
          
          <!-- Form Footer Actions -->
          <div class="bg-gray-50 px-6 py-5 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-end gap-4 shrink-0 mt-auto">
            <div class="flex items-center gap-3 w-full sm:w-auto">
              <button type="button" id="cancelRequestSlipBtn" class="w-full sm:w-auto px-5 py-2.5 bg-white border border-gray-200 text-gray-700 font-medium text-sm rounded-xl hover:bg-gray-50 transition-colors shadow-sm">
                Cancel
              </button>
              <button type="submit" form="requestSlipForm" class="w-full sm:w-auto px-6 py-2.5 bg-[#7a1f2b] text-white font-medium text-sm rounded-xl flex items-center justify-center gap-2 transition-all shadow-sm hover:bg-[#5b0617]">
                <span class="material-symbols-outlined text-[18px]">send</span>
                Submit Request Slip
              </button>
            </div>
          </div>
          
        </div>
      </div>
EOD;

$find = '/\s*<!-- Request Slip Modal Overlay -->.*<\/div>\s*<\/div>\s*<\/div>/s';
$content = preg_replace($find, "\n" . $html, $content);
file_put_contents("public/rooms.html", $content);
echo "Done\n";
