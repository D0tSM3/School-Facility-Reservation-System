import re

with open("public/staff-dashboard.html", "r", encoding="utf-8") as f:
    html = f.read()

# Completely rewrite the Modals section with pristine Tailwind
clean_modals = """
<!-- Move Request Review Modal -->
<div id="moveReviewModalOverlay" class="fixed inset-0 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center z-50 opacity-0 pointer-events-none transition-all duration-200" aria-hidden="true">
  <div id="moveReviewModal" class="bg-white w-[90%] max-w-md rounded-2xl shadow-2xl overflow-hidden transform transition-all duration-200 flex flex-col scale-95" role="dialog" aria-modal="true" aria-labelledby="moveReviewTitle">
    <div class="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
      <h2 id="moveReviewTitle" class="text-lg font-bold text-gray-900">Review Move Request</h2>
      <button type="button" id="moveReviewCloseIcon" class="text-gray-400 hover:text-gray-700 transition-colors focus:outline-none rounded-full p-1" aria-label="Close modal">
        <span class="material-symbols-outlined text-[20px]">close</span>
      </button>
    </div>
    <div class="p-6 flex-1 overflow-y-auto">
      <div id="moveReviewSummary" class="mb-6"></div>
      <form id="moveReviewForm" class="space-y-4">
        <div>
          <label for="moveReviewComment" class="block text-sm font-semibold text-gray-700 mb-2">Staff Comment (Required for Rejection)</label>
          <textarea id="moveReviewComment" rows="3" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#7a1f2b]/20 focus:border-[#7a1f2b] transition-all resize-none placeholder-gray-400" placeholder="Provide a reason for your decision..."></textarea>
        </div>
        <div id="moveReviewErrorMsg" class="hidden text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-100 font-medium"></div>
      </form>
    </div>
    <div class="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
      <button type="button" id="moveReviewCancelBtn" class="px-5 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors shadow-sm">Cancel</button>
      <button type="button" id="moveReviewRejectBtn" class="px-5 py-2.5 text-sm font-semibold text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors shadow-sm">Reject Move</button>
      <button type="button" id="moveReviewApproveBtn" class="px-5 py-2.5 text-sm font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 transition-colors shadow-sm">Approve Move</button>
    </div>
  </div>
</div>

<!-- Cancellation Request Review Modal -->
<div id="cancelReviewModalOverlay" class="fixed inset-0 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center z-50 opacity-0 pointer-events-none transition-all duration-200" aria-hidden="true">
  <div id="cancelReviewModal" class="bg-white w-[90%] max-w-md rounded-2xl shadow-2xl overflow-hidden transform transition-all duration-200 flex flex-col scale-95" role="dialog" aria-modal="true" aria-labelledby="cancelReviewTitle">
    <div class="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
      <h2 id="cancelReviewTitle" class="text-lg font-bold text-gray-900">Review Cancellation Request</h2>
      <button type="button" id="cancelReviewCloseIcon" class="text-gray-400 hover:text-gray-700 transition-colors focus:outline-none rounded-full p-1" aria-label="Close modal">
        <span class="material-symbols-outlined text-[20px]">close</span>
      </button>
    </div>
    <div class="p-6 flex-1 overflow-y-auto">
      <div id="cancelReviewSummary" class="mb-6"></div>
      <form id="cancelReviewForm" class="space-y-4">
        <div>
          <label for="cancelReviewComment" class="block text-sm font-semibold text-gray-700 mb-2">Staff Comment (Required for Rejection)</label>
          <textarea id="cancelReviewComment" rows="3" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#7a1f2b]/20 focus:border-[#7a1f2b] transition-all resize-none placeholder-gray-400" placeholder="Provide a reason for your decision..."></textarea>
        </div>
        <div id="cancelReviewErrorMsg" class="hidden text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-100 font-medium"></div>
      </form>
    </div>
    <div class="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
      <button type="button" id="cancelReviewCancelBtn" class="px-5 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors shadow-sm">Cancel</button>
      <button type="button" id="cancelReviewRejectBtn" class="px-5 py-2.5 text-sm font-semibold text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors shadow-sm">Reject Request</button>
      <button type="button" id="cancelReviewApproveBtn" class="px-5 py-2.5 text-sm font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 transition-colors shadow-sm">Approve Cancellation</button>
    </div>
  </div>
</div>

<!-- Application Inspection Modal -->
<div id="detailModalOverlay" class="fixed inset-0 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center z-50 opacity-0 pointer-events-none transition-all duration-200" aria-hidden="true">
  <div class="bg-white w-[90%] max-w-lg rounded-2xl shadow-2xl overflow-hidden transform transition-all duration-200 flex flex-col scale-95" role="dialog" aria-modal="true" aria-labelledby="detailModalTitle">
    <div class="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
      <h2 id="detailModalTitle" class="text-lg font-bold text-gray-900">Application Details</h2>
      <button type="button" id="detailModalCloseIcon" class="text-gray-400 hover:text-gray-700 transition-colors focus:outline-none rounded-full p-1" aria-label="Close modal">
        <span class="material-symbols-outlined text-[20px]">close</span>
      </button>
    </div>
    <div class="p-6 flex-1 overflow-y-auto" id="detailModalBody"></div>
    <div class="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
      <button type="button" id="detailModalCloseBtn" class="px-5 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors shadow-sm">Close Window</button>
    </div>
  </div>
</div>

<!-- Staff Cancellation Modal -->
<div id="staffCancelModalOverlay" class="fixed inset-0 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center z-50 opacity-0 pointer-events-none transition-all duration-200" aria-hidden="true">
  <div class="bg-white w-[90%] max-w-md rounded-2xl shadow-2xl overflow-hidden transform transition-all duration-200 flex flex-col scale-95" role="dialog" aria-modal="true" aria-labelledby="staffCancelModalTitle">
    <div class="px-6 py-5 border-b border-red-100 flex justify-between items-center bg-red-50/50">
      <h2 id="staffCancelModalTitle" class="text-lg font-bold text-red-700 flex items-center gap-2">
        <span class="material-symbols-outlined text-[22px]">warning</span>
        Revoke Booking Permit
      </h2>
      <button type="button" id="staffCancelCloseIcon" class="text-gray-400 hover:text-gray-700 transition-colors focus:outline-none rounded-full p-1" aria-label="Close modal">
        <span class="material-symbols-outlined text-[20px]">close</span>
      </button>
    </div>
    <div class="p-6 flex-1 overflow-y-auto">
      <div id="staffCancelSummary" class="mb-6"></div>
      <div class="space-y-4">
        <div>
          <label for="staffCancelReasonInput" class="block text-sm font-semibold text-gray-700 mb-2">Revocation Reason (Required)</label>
          <textarea id="staffCancelReasonInput" rows="3" class="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all resize-none placeholder-gray-400" placeholder="Explain why this approved booking is being revoked..."></textarea>
        </div>
        <div id="staffCancelError" class="hidden text-sm text-red-600 bg-red-50 p-3 rounded-lg border border-red-100 font-medium"></div>
      </div>
    </div>
    <div class="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
      <button type="button" id="staffCancelCancelBtn" class="px-5 py-2.5 text-sm font-semibold text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors shadow-sm">Cancel</button>
      <button type="button" id="staffCancelConfirmBtn" class="px-5 py-2.5 text-sm font-semibold text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors shadow-sm">Confirm Revocation</button>
    </div>
  </div>
</div>
"""

# Replace the entire old block
html = re.sub(r"<!-- Move Request Review Modal -->.*?</main>", clean_modals + "\n</main>", html, flags=re.DOTALL)

with open("public/staff-dashboard.html", "w", encoding="utf-8") as f:
    f.write(html)
