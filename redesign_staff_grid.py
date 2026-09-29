import os

def create_staff_dashboard():
    with open("public/staff-dashboard.html", "r", encoding="utf-8") as f:
        html = f.read()

    # Extract everything before <main>
    header_part = html.split('<main')[0]

    # Extract modals and scripts
    footer_part = html.split('</main>')[1]

    main_content = """<main class="w-full pt-20 px-8 pb-12 max-w-[1400px] mx-auto">
        <!-- Operational Header Banner -->
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 sm:p-7 mb-7 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div class="flex items-center gap-2 mb-2">
              <span class="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" id="sync-indicator"></span>
              <span class="text-[11px] font-bold uppercase tracking-wider text-emerald-600" id="sync-timestamp">Live Staff Dispatch Feed</span>
            </div>
            <h1 class="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight">
              Staff Approval Dashboard
            </h1>
            <p class="text-sm text-gray-500 mt-1.5 leading-relaxed">
              Review incoming faculty space applications and toggle room maintenance states across campus.
            </p>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <button
                type="button"
                class="inline-flex items-center gap-1.5 px-5 py-2.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-semibold rounded-xl shadow-sm transition-all"
                id="btn-refresh-queue"
              >
                <span class="material-symbols-outlined text-[18px]">refresh</span>
                <span>Refresh Queue</span>
            </button>
            <button
                type="button"
                class="inline-flex items-center gap-1.5 px-5 py-2.5 bg-[#7a1f2b] hover:bg-[#5e1821] text-white text-sm font-semibold rounded-xl shadow-sm transition-all disabled:opacity-50"
                id="btn-batch-approve"
              >
                <span class="material-symbols-outlined text-[18px]">done_all</span>
                <span id="batch-approve-label">Batch Approve</span>
            </button>
          </div>
        </div>

        <!-- 4-Column Metric Cards (Act as Tabs) -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8" id="staffTabsContainer">
          
          <!-- Card 1: Pending Approvals -->
          <button type="button" id="tab-pending" class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col items-center justify-center text-center h-[200px] hover:shadow-md transition-all cursor-pointer relative overflow-hidden group focus:outline-none">
            <div class="absolute bottom-0 left-0 right-0 h-1 bg-[#F59E0B] opacity-0 group-[.active-tab]:opacity-100 transition-opacity"></div>
            <div class="w-12 h-12 rounded-xl bg-amber-50 group-[.active-tab]:bg-[#F59E0B] flex items-center justify-center text-[#F59E0B] group-[.active-tab]:text-white mb-4 transition-colors">
              <span class="material-symbols-outlined text-[24px]">assignment</span>
            </div>
            <p class="text-4xl font-extrabold text-gray-900 mb-2 leading-none" id="kpi-pending-count">0</p>
            <p class="text-xs font-semibold text-gray-500">Pending Approvals</p>
          </button>

          <!-- Card 2: Move Requests -->
          <button type="button" id="tab-moves" class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col items-center justify-center text-center h-[200px] hover:shadow-md transition-all cursor-pointer relative overflow-hidden group focus:outline-none">
            <div class="absolute bottom-0 left-0 right-0 h-1 bg-blue-500 opacity-0 group-[.active-tab]:opacity-100 transition-opacity"></div>
            <div class="w-12 h-12 rounded-xl bg-blue-50 group-[.active-tab]:bg-blue-500 flex items-center justify-center text-blue-500 group-[.active-tab]:text-white mb-4 transition-colors">
              <span class="material-symbols-outlined text-[24px]">edit_calendar</span>
            </div>
            <p class="text-4xl font-extrabold text-gray-900 mb-2 leading-none" id="move-badge-count">0</p>
            <p class="text-xs font-semibold text-gray-500">Move Requests</p>
          </button>

          <!-- Card 3: Cancellations -->
          <button type="button" id="tab-cancels" class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col items-center justify-center text-center h-[200px] hover:shadow-md transition-all cursor-pointer relative overflow-hidden group focus:outline-none">
            <div class="absolute bottom-0 left-0 right-0 h-1 bg-red-500 opacity-0 group-[.active-tab]:opacity-100 transition-opacity"></div>
            <div class="w-12 h-12 rounded-xl bg-red-50 group-[.active-tab]:bg-red-500 flex items-center justify-center text-red-500 group-[.active-tab]:text-white mb-4 transition-colors">
              <span class="material-symbols-outlined text-[24px]">event_busy</span>
            </div>
            <p class="text-4xl font-extrabold text-gray-900 mb-2 leading-none" id="cancel-badge-count">0</p>
            <p class="text-xs font-semibold text-gray-500">Cancellation Requests</p>
          </button>

          <!-- Card 4: Facility Status -->
          <button type="button" id="tab-maintenance" class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col items-center justify-center text-center h-[200px] hover:shadow-md transition-all cursor-pointer relative overflow-hidden group focus:outline-none">
            <div class="absolute bottom-0 left-0 right-0 h-1 bg-emerald-500 opacity-0 group-[.active-tab]:opacity-100 transition-opacity"></div>
            <div class="w-12 h-12 rounded-xl bg-emerald-50 group-[.active-tab]:bg-emerald-500 flex items-center justify-center text-emerald-500 group-[.active-tab]:text-white mb-4 transition-colors">
              <span class="material-symbols-outlined text-[24px]">room_preferences</span>
            </div>
            <p class="text-4xl font-extrabold text-gray-900 mb-2 leading-none" id="kpi-maintenance-count">0</p>
            <p class="text-xs font-semibold text-gray-500">Facility Status Grid</p>
          </button>
        </div>
        
        <!-- Viewport Container -->
        <div class="bg-transparent" id="active-viewport-title-container">
            <h2 class="text-lg font-bold text-gray-900 mb-4 px-2" id="viewport-title">Pending Approvals</h2>
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
            <!-- Legacy all tab structure for JS compatibility but hidden from UI mostly -->
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
            <div id="view-all-list" class="space-y-4"></div>
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
                    </select>
                  </div>
               </div>
               
               <div id="maintenance-alert-container" class="hidden mb-4"></div>
               
               <div id="view-maintenance-list" class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                 <div class="p-8 text-center text-gray-500 bg-white border border-gray-100 rounded-2xl shadow-sm text-sm lg:col-span-2 xl:col-span-3">Loading facilities...</div>
               </div>
            </div>
        </div>
"""

    with open("public/staff-dashboard.html", "w", encoding="utf-8") as f:
        f.write(header_part + main_content + "</main>\n" + footer_part)

create_staff_dashboard()
