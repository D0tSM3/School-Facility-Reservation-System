import re

with open("public/js/staff-dashboard.js", "r", encoding="utf-8") as f:
    js = f.read()

# Replace tab logic
old_tab_logic = """const ACTIVE_TAB_CLASSES = ['bg-white', 'shadow-sm', 'text-gray-800', 'font-semibold'];
  const INACTIVE_TAB_CLASSES = ['text-gray-500', 'hover:text-gray-700', 'font-medium'];

  function switchTab(tab) {
    state.activeTab = tab;

    const pairs = [
      ['pending', tabPending, viewPending],
      ['moves', tabMoves, viewMoves],
      ['cancels', tabCancels, viewCancels],
      ['all', tabAll, viewAll],
      ['maintenance', tabMaintenance, viewMaintenance]
    ];

    pairs.forEach(([name, tabEl, viewEl]) => {
      const active = name === tab;
      if (tabEl) {
        INACTIVE_TAB_CLASSES.forEach((cls) => tabEl.classList.toggle(cls, !active));
        ACTIVE_TAB_CLASSES.forEach((cls) => tabEl.classList.toggle(cls, active));
        tabEl.setAttribute('aria-selected', active ? 'true' : 'false');
      }
      if (viewEl) viewEl.classList.toggle('hidden', !active);
    });"""

new_tab_logic = """
  function switchTab(tab) {
    state.activeTab = tab;

    const pairs = [
      ['pending', tabPending, viewPending, 'Pending Approvals'],
      ['moves', tabMoves, viewMoves, 'Move Requests'],
      ['cancels', tabCancels, viewCancels, 'Cancellation Requests'],
      ['all', tabAll, viewAll, 'All Requests'],
      ['maintenance', tabMaintenance, viewMaintenance, 'Facility State Grid']
    ];

    pairs.forEach(([name, tabEl, viewEl, title]) => {
      const active = name === tab;
      if (tabEl) {
        tabEl.classList.toggle('active-tab', active);
        tabEl.classList.toggle('ring-2', active);
        tabEl.classList.toggle('ring-[#7a1f2b]', active);
        tabEl.setAttribute('aria-selected', active ? 'true' : 'false');
      }
      if (viewEl) viewEl.classList.toggle('hidden', !active);
      
      if (active) {
         const titleEl = document.getElementById('viewport-title');
         if (titleEl) titleEl.textContent = title;
      }
    });"""

# Because of exact matching issues with indentation, we'll use a precise regex or substring replacement
js = js.replace("const ACTIVE_TAB_CLASSES = ['bg-white', 'shadow-sm', 'text-gray-800', 'font-semibold'];", "")
js = js.replace("const INACTIVE_TAB_CLASSES = ['text-gray-500', 'hover:text-gray-700', 'font-medium'];", "")

switch_tab_pattern = r"function switchTab\(tab\)\s*\{.*?if \(alertBox\)\s*\{"

replacement = """function switchTab(tab) {
    state.activeTab = tab;

    const pairs = [
      ['pending', tabPending, viewPending, 'Pending Approvals'],
      ['moves', tabMoves, viewMoves, 'Move Requests'],
      ['cancels', tabCancels, viewCancels, 'Cancellation Requests'],
      ['all', tabAll, viewAll, 'All Requests'],
      ['maintenance', tabMaintenance, viewMaintenance, 'Facility State Grid']
    ];

    pairs.forEach(([name, tabEl, viewEl, title]) => {
      const active = name === tab;
      if (tabEl) {
        tabEl.classList.toggle('active-tab', active);
        tabEl.classList.toggle('ring-2', active);
        tabEl.classList.toggle('ring-[#7a1f2b]', active);
        tabEl.setAttribute('aria-selected', active ? 'true' : 'false');
      }
      if (viewEl) viewEl.classList.toggle('hidden', !active);
      
      if (active) {
         const titleEl = document.getElementById('viewport-title');
         if (titleEl) titleEl.textContent = title;
      }
    });

    if (alertBox) {"""

js = re.sub(switch_tab_pattern, replacement, js, flags=re.DOTALL)

with open("public/js/staff-dashboard.js", "w", encoding="utf-8") as f:
    f.write(js)
