import re

with open("public/js/reservations.js", "r", encoding="utf-8") as f:
    content = f.read()

# I will add a dynamic end time updater to reservations.js
# Look for: ['moveDate', 'moveStartTime', 'moveEndTime'].forEach(id => {

updater_script = """
    const moveStartTimeSelect = document.getElementById('moveStartTime');
    const moveEndTimeSelect = document.getElementById('moveEndTime');

    if (moveStartTimeSelect && moveEndTimeSelect) {
      const ALL_END_OPTIONS = Array.from(moveEndTimeSelect.options)
        .filter(o => o.value)
        .map(o => ({ value: o.value, text: o.textContent }));
      
      const syncMoveEndOptions = () => {
        const start = moveStartTimeSelect.value;
        const previous = moveEndTimeSelect.value;
        
        moveEndTimeSelect.innerHTML = '<option value="">End time</option>';
        ALL_END_OPTIONS.forEach(o => {
          const opt = document.createElement('option');
          opt.value = o.value;
          opt.textContent = o.text;
          
          if (start && o.value <= start) {
            opt.disabled = true;
            opt.hidden = true; // hide/disable before or equal
          }
          moveEndTimeSelect.appendChild(opt);
        });
        
        if (previous && previous > start) {
          moveEndTimeSelect.value = previous;
        }
      };

      moveStartTimeSelect.addEventListener('change', syncMoveEndOptions);
      // Run once
      syncMoveEndOptions();
    }

    ['moveDate', 'moveStartTime', 'moveEndTime'].forEach(id => {
"""

content = content.replace("['moveDate', 'moveStartTime', 'moveEndTime'].forEach(id => {", updater_script)

with open("public/js/reservations.js", "w", encoding="utf-8") as f:
    f.write(content)
