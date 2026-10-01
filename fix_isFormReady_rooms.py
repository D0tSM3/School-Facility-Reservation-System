import re

with open("public/rooms.html", "r", encoding="utf-8") as f:
    html = f.read()

# Update the isFormReady in rooms.html
old_isFormReady = r"""          function isFormReady\(\) \{\s*// 1\. Facility selected\s*if \(\!roomSelect \|\| \!roomSelect\.value\) return false;\s*// 2\. Dates selected\s*if \(\!resDate \|\| \!resDate\.value\) return false;\s*if \(\!resEndDate \|\| \!resEndDate\.value\) return false;\s*// 3\. Start time"""

new_isFormReady = """          function isFormReady() {
            // Check mode and sync resEndDate if single
            const mode = document.querySelector('input[name="booking_mode"]:checked')?.value || 'single';
            if (mode === 'single' && resDate) {
              resEndDate.value = resDate.value;
            }
            
            // 1. Facility selected
            if (!roomSelect || !roomSelect.value) return false;
            // 2. Dates selected
            if (!resDate || !resDate.value) return false;
            if (!resEndDate || !resEndDate.value) return false;
            
            // Validate 7-day limit in UI
            const sDate = new Date(resDate.value);
            const eDate = new Date(resEndDate.value);
            if ((eDate - sDate) / (1000 * 60 * 60 * 24) > 6 && mode !== 'single') return false;

            // Validate specific days
            if (mode === 'specific') {
               const checked = document.querySelectorAll('input[name="active_days"]:checked');
               if (checked.length === 0) return false;
            }

            // 3. Start time"""

html = re.sub(old_isFormReady, new_isFormReady, html, flags=re.DOTALL)

with open("public/rooms.html", "w", encoding="utf-8") as f:
    f.write(html)
