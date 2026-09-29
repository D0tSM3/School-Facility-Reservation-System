with open("public/js/staff-dashboard.js", "r", encoding="utf-8") as f:
    js = f.read()

export_block = """
  // ---------------------------------------------------------------
  // Export Global API for inline HTML onclick handlers
  // ---------------------------------------------------------------
  window.CampusRoomStaff = {
    decide,
    openDetailModal,
    openStaffCancelModal,
    openMoveModal,
    openCancelRequestModal,
    toggleFacility
  };

  // ---------------------------------------------------------------
  // Go
  // ---------------------------------------------------------------

  start();
});
"""

# Replace the end
js = js.replace("""  // ---------------------------------------------------------------
  // Go
  // ---------------------------------------------------------------

  start();
});""", export_block)

with open("public/js/staff-dashboard.js", "w", encoding="utf-8") as f:
    f.write(js)
