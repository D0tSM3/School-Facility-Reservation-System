with open("public/js/staff-dashboard.js", "r", encoding="utf-8") as f:
    js = f.read()

# Fix the broken function signature
js = js.replace("async function toggleFacility,\n    updateBatchButton(roomId", "async function toggleFacility(roomId")

# Ensure the export block at the bottom is correct
js = js.replace("""    openCancelRequestModal,
    toggleFacility,
    updateBatchButton
  };""", """    openCancelRequestModal,
    toggleFacility,
    updateBatchButton
  };""")

# Double check if any other toggleFacility got messed up
js = js.replace("window.CampusRoomStaff.toggleFacility,\n    updateBatchButton", "window.CampusRoomStaff.toggleFacility")

with open("public/js/staff-dashboard.js", "w", encoding="utf-8") as f:
    f.write(js)
