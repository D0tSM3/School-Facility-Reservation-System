import re

def build_staff_html():
    with open("public/dashboard.html", "r", encoding="utf-8") as f:
        dashboard = f.read()

    # Extract everything before <main
    header_part = dashboard.split('<main')[0]

    # Change the title
    header_part = header_part.replace("<title>CampusRoom — Dashboard | BPU Facility Gateway</title>", "<title>CampusRoom — Staff Queue | BPU Facility Gateway</title>")

    main_content = """<main class="w-full pt-20 px-8 pb-12 max-w-[1400px] mx-auto">
        
        <div class="flex items-center justify-between mb-7">
          <div>
            <h1 class="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">Staff Approval Queue</h1>
            <p class="text-sm text-gray-500 mt-1.5 leading-relaxed">Review incoming facility applications and manage space maintenance.</p>
          </div>
          <div class="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-gray-200 shadow-sm">
             <div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" id="sync-indicator"></div>
             <span class="text-xs font-semibold text-gray-700" id="sync-timestamp">Connected</span>
          </div>
        </div>

        <!-- Toolbar Bar -->
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-6 flex flex-wrap items-center justify-between gap-3">
          <!-- Status Filter Pills -->
          <div class="flex flex-wrap items-center gap-3 flex-1">
            <div class="flex bg-[#f8f9fb] border border-gray-200/80 rounded-xl p-1 gap-1 flex-wrap">
              <button type="button" id="tab-pending" class="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white shadow-sm text-gray-800 transition-all flex items-center gap-1.5">
                <span>Pending Approvals</span>
                <span id="pending-badge-count" class="bg-[#F59E0B] text-white text-[10px] px-1.5 rounded-md">-</span>
              </button>
              <button type="button" id="tab-moves" class="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-700 transition-all flex items-center gap-1.5">
                <span>Move Requests</span>
                <span id="move-badge-count" class="bg-gray-200 text-gray-600 text-[10px] px-1.5 rounded-md">-</span>
              </button>
              <button type="button" id="tab-cancels" class="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-700 transition-all flex items-center gap-1.5">
                <span>Cancellations</span>
                <span id="cancel-badge-count" class="bg-gray-200 text-gray-600 text-[10px] px-1.5 rounded-md">-</span>
              </button>
              <button type="button" id="tab-all" class="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-700 transition-all flex items-center gap-1.5">
                <span>All Requests</span>
                <span id="all-badge-count" class="bg-gray-200 text-gray-600 text-[10px] px-1.5 rounded-md">-</span>
              </button>
              <button type="button" id="tab-maintenance" class="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-700 transition-all flex items-center gap-1.5">
                <span>Maintenance</span>
                <span id="maintenance-badge-count" class="bg-gray-200 text-gray-600 text-[10px] px-1.5 rounded-md">-</span>
              </button>
            </div>
          </div>

          <!-- Right: Actions -->
          <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="flex items-center gap-1 px-4 py-1.5 rounded-lg bg-[#7a1f2b] hover:bg-[#5b0617] text-white font-semibold text-xs transition-all shadow-sm disabled:opacity-50 disabled:pointer-events-none"
                id="btn-batch-approve"
              >
                <span class="material-symbols-outlined text-[16px]">done_all</span>
                <span id="batch-approve-label">Batch Approve</span>
              </button>
              <button
                type="button"
                class="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 font-semibold text-xs transition-all shadow-sm"
                id="btn-refresh-queue"
              >
                <span class="material-symbols-outlined text-[16px]">refresh</span>
                <span>Refresh</span>
              </button>
          </div>
        </div>

        <!-- Viewports -->
        <div id="view-pending" class="space-y-4 mb-8">
            <div class="p-8 text-center text-gray-500 bg-white border border-gray-100 rounded-2xl shadow-sm text-sm">Loading pending applications...</div>
        </div>
        
        <div id="view-moves" class="hidden space-y-4 mb-8">
            <div class="p-8 text-center text-gray-500 bg-white border border-gray-100 rounded-2xl shadow-sm text-sm">Loading move requests...</div>
        </div>
        
        <div id="view-cancels" class="hidden space-y-4 mb-8">
            <div class="p-8 text-center text-gray-500 bg-white border border-gray-100 rounded-2xl shadow-sm text-sm">Loading cancellations...</div>
        </div>
        
        <div id="view-all" class="hidden space-y-4 mb-8">
            <div class="flex items-center justify-end gap-2 mb-2">
              <label class="text-xs font-semibold text-gray-500 uppercase tracking-wider" for="all-status-filter">Filter:</label>
              <select id="all-status-filter" class="bg-white border border-gray-200 px-2 py-1 rounded text-xs text-gray-800 focus:outline-none focus:border-[#7a1f2b]">
                <option value="all">All Statuses</option>
                <option value="Pending">Pending</option>
                <option value="Approved">Approved</option>
                <option value="Rejected">Rejected</option>
                <option value="Cancelled">Cancelled</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
            <div id="view-all-list" class="space-y-4">
              <div class="p-8 text-center text-gray-500 bg-white border border-gray-100 rounded-2xl shadow-sm text-sm">Loading...</div>
            </div>
        </div>
        
        <div id="view-maintenance" class="hidden space-y-6 mb-8">
            <div class="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
               <div class="flex items-center justify-between mb-4">
                  <div>
                    <h3 class="font-bold text-gray-900 text-lg">Facility State Grid</h3>
                    <p class="text-xs text-gray-500 mt-0.5">Toggle spaces between operational, maintenance, and locked.</p>
                  </div>
                  <div class="flex items-center gap-2">
                    <label class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Filter:</label>
                    <select id="facility-filter" class="bg-[#f8f9fb] border border-gray-200 px-2.5 py-1.5 rounded-lg text-xs text-gray-800 focus:outline-none focus:border-[#7a1f2b]">
                      <option value="all">All Locations</option>
                      <!-- populated via JS -->
                    </select>
                  </div>
               </div>
               
               <div id="maintenance-alert-container" class="hidden mb-4"></div>
               
               <div id="view-maintenance-list" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                 <div class="p-8 text-center text-gray-500 bg-white border border-gray-100 rounded-2xl shadow-sm text-sm lg:col-span-2">Loading facilities...</div>
               </div>
            </div>
        </div>

      </main>
    </div>
    
    <!-- Action Menu (moved from staff-queue.js injection to make it clean) -->
    <div id="action-menu" class="hidden fixed z-[100] w-48 bg-white border border-gray-100 shadow-xl rounded-xl py-1 transform scale-95 opacity-0 transition-all origin-top-right">
      <ul id="action-menu-items" class="flex flex-col"></ul>
    </div>
"""
    
    # We also need modals: Action Details, Cancel Confirmation, Move Review, Cancel Request Review
    modals = """
    <!-- Reservation Details Modal -->
    <div id="actionModal" class="fixed inset-0 z-[100] hidden">
      <div class="absolute inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity"></div>
      <div class="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
        <div class="relative bg-white rounded-2xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:max-w-2xl w-full border border-gray-100 flex flex-col max-h-[90vh]">
          
          <div class="px-6 py-5 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between shrink-0">
            <h3 class="text-lg font-bold text-gray-900 leading-tight">Reservation Details</h3>
            <button type="button" id="closeActionModalBtn" class="text-gray-400 hover:text-gray-600 bg-white hover:bg-gray-100 rounded-lg p-1.5 transition-colors border border-gray-200 shadow-sm">
              <span class="material-symbols-outlined text-[18px] block">close</span>
            </button>
          </div>

          <div class="px-6 py-5 overflow-y-auto" id="actionModalContent">
            <!-- Details injected here -->
          </div>

          <div class="px-6 py-4 border-t border-gray-100 bg-gray-50 flex flex-wrap items-center justify-between gap-3 shrink-0" id="actionModalFooter">
             <!-- Action buttons injected here -->
          </div>
        </div>
      </div>
    </div>
    
    <!-- Staff Cancellation Modal -->
    <div id="staffCancelModal" class="fixed inset-0 z-[110] hidden">
      <div class="absolute inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity"></div>
      <div class="flex items-center justify-center min-h-screen px-4 text-center sm:p-0">
        <div class="relative bg-white rounded-2xl text-left overflow-hidden shadow-2xl sm:max-w-md w-full border border-gray-100 p-6">
          <div class="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 text-red-600 mb-4 mx-auto">
            <span class="material-symbols-outlined text-[24px]">warning</span>
          </div>
          <h3 class="text-lg font-bold text-gray-900 text-center mb-2">Cancel Reservation</h3>
          <p class="text-sm text-gray-500 text-center mb-4">Please provide a reason for cancelling this reservation.</p>
          <input type="hidden" id="staffCancelResId">
          <textarea id="staffCancelReason" rows="3" class="w-full bg-[#f8f9fb] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-500" placeholder="e.g. Schedule conflict, facility maintenance..."></textarea>
          <div class="mt-5 flex items-center justify-center gap-3">
             <button type="button" id="staffCancelDismissBtn" class="px-4 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-300 rounded-xl hover:bg-gray-50">Back</button>
             <button type="button" id="staffCancelConfirmBtn" class="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-xl hover:bg-red-700">Confirm Cancel</button>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Move Request Review Modal -->
    <div id="moveReviewModal" class="fixed inset-0 z-[110] hidden">
      <div class="absolute inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity"></div>
      <div class="flex items-center justify-center min-h-screen px-4 text-center sm:p-0">
        <div class="relative bg-white rounded-2xl text-left overflow-hidden shadow-2xl sm:max-w-md w-full border border-gray-100 p-6">
          <h3 class="text-lg font-bold text-gray-900 mb-4">Review Move Request</h3>
          <input type="hidden" id="moveReviewId">
          <div class="mb-4">
             <label class="block text-xs font-bold text-gray-700 mb-1">Staff Note (Optional)</label>
             <textarea id="moveReviewNote" rows="2" class="w-full bg-[#f8f9fb] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#7a1f2b]" placeholder="Note to customer..."></textarea>
          </div>
          <div class="mt-5 flex items-center justify-end gap-3">
             <button type="button" id="moveReviewDismissBtn" class="px-4 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-300 rounded-xl hover:bg-gray-50">Close</button>
             <button type="button" id="moveReviewRejectBtn" class="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-xl hover:bg-red-700">Reject</button>
             <button type="button" id="moveReviewApproveBtn" class="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700">Approve</button>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Cancel Request Review Modal -->
    <div id="cancelReqReviewModal" class="fixed inset-0 z-[110] hidden">
      <div class="absolute inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity"></div>
      <div class="flex items-center justify-center min-h-screen px-4 text-center sm:p-0">
        <div class="relative bg-white rounded-2xl text-left overflow-hidden shadow-2xl sm:max-w-md w-full border border-gray-100 p-6">
          <h3 class="text-lg font-bold text-gray-900 mb-4">Review Cancellation Request</h3>
          <input type="hidden" id="cancelReqReviewId">
          <div class="mb-4">
             <label class="block text-xs font-bold text-gray-700 mb-1">Staff Note (Optional)</label>
             <textarea id="cancelReqReviewNote" rows="2" class="w-full bg-[#f8f9fb] border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#7a1f2b]" placeholder="Note to customer..."></textarea>
          </div>
          <div class="mt-5 flex items-center justify-end gap-3">
             <button type="button" id="cancelReqReviewDismissBtn" class="px-4 py-2 text-sm font-semibold text-gray-600 bg-white border border-gray-300 rounded-xl hover:bg-gray-50">Close</button>
             <button type="button" id="cancelReqReviewRejectBtn" class="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-xl hover:bg-red-700">Reject</button>
             <button type="button" id="cancelReqReviewApproveBtn" class="px-4 py-2 text-sm font-semibold text-white bg-[#7a1f2b] rounded-xl hover:bg-[#5b0617]">Approve (Cancel Booking)</button>
          </div>
        </div>
      </div>
    </div>
    """

    footer_part = """
    <script src="js/app.js"></script>
    <script src="js/util.js"></script>
    <script src="js/schedule.js"></script>
    <script src="js/slip.js"></script>
    <script src="js/logArchive.js"></script>
    <script src="js/rebook.js"></script>
    <script src="js/staff-queue.js"></script>
  </body>
</html>
"""

    with open("public/staff-queue.html", "w", encoding="utf-8") as f:
        f.write(header_part + main_content + modals + footer_part)

build_staff_html()
