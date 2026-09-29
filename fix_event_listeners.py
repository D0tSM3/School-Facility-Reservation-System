import os
import re

with open("public/js/staff-dashboard.js", "r", encoding="utf-8") as f:
    js = f.read()

# Fix facilityGrid ID
js = js.replace("const facilityGrid   = el('facility-grid');", "const facilityGrid   = el('view-maintenance-list');")

# Add guards to event listeners
replacements = {
    "allStatusFilter.addEventListener(": "if (allStatusFilter) allStatusFilter.addEventListener(",
    "batchApproveBtn.addEventListener(": "if (batchApproveBtn) batchApproveBtn.addEventListener(",
    "refreshBtn.addEventListener(": "if (refreshBtn) refreshBtn.addEventListener(",
    "alertBtn.addEventListener(": "if (alertBtn) alertBtn.addEventListener(",
    "facilityFilter.addEventListener(": "if (facilityFilter) facilityFilter.addEventListener(",
    "exportLogBtn.addEventListener(": "if (exportLogBtn) exportLogBtn.addEventListener(",
    "detailOverlay.addEventListener(": "if (detailOverlay) detailOverlay.addEventListener(",
    "staffCancelOverlay.addEventListener(": "if (staffCancelOverlay) staffCancelOverlay.addEventListener(",
    "moveOverlay.addEventListener(": "if (moveOverlay) moveOverlay.addEventListener(",
    "cancelReqOverlay.addEventListener(": "if (cancelReqOverlay) cancelReqOverlay.addEventListener("
}

for old, new in replacements.items():
    js = js.replace(old, new)

with open("public/js/staff-dashboard.js", "w", encoding="utf-8") as f:
    f.write(js)
