import re

with open("public/js/booking.js", "r", encoding="utf-8") as f:
    content = f.read()

replacement = """
    syncEndOptions = () => {
      const start = startTimeInput.value;
      const previous = endTimeInput.value;
      endTimeInput.innerHTML = '<option value="">Select End</option>';
      ALL_END_OPTIONS.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.text;
        
        if (start && o.value <= start) {
          opt.disabled = true;
          opt.hidden = true; // hide/disable before or equal
        } else {
          // Start is free, but is [start, this end) free?
          const clash = rangeConflicts(start, o.value);
          if (clash.length) {
            opt.disabled = true;
            opt.textContent = o.text + ' ?" unavailable';
            opt.title = window.CampusSchedule.describe(clash, start, o.value);
          }
        }
        endTimeInput.appendChild(opt);
      });
      // Keep the previous end only if it is still offered AND still usable.
      const keep = Array.from(endTimeInput.options).find(o => o.value === previous);
      if (previous && previous > start && keep && !keep.disabled) endTimeInput.value = previous;
    };
"""

pattern = re.compile(r'syncEndOptions = \(\) => \{.*?if \(previous && previous > start && keep && !keep\.disabled\) endTimeInput\.value = previous;\n\s*\};', re.DOTALL)
content = pattern.sub(replacement.strip(), content)

with open("public/js/booking.js", "w", encoding="utf-8") as f:
    f.write(content)


with open("public/js/dashboard.js", "r", encoding="utf-8") as f:
    content2 = f.read()

dashboard_replacement = """
    TIMES.slice(0, -1).forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = format12(t);
      qrStartTime.appendChild(opt);
    });

    // Populate all end times initially
    TIMES.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = format12(t);
      qrEndTime.appendChild(opt);
    });

    qrStartTime.addEventListener('change', () => {
      const start = qrStartTime.value;
      const previous = qrEndTime.value;
      
      Array.from(qrEndTime.options).forEach(opt => {
        if (!opt.value) return; // skip placeholder
        if (start && opt.value <= start) {
          opt.disabled = true;
          opt.hidden = true;
        } else {
          opt.disabled = false;
          opt.hidden = false;
        }
      });
      
      if (previous && previous <= start) {
        qrEndTime.value = '';
      }
    });
"""

pattern2 = re.compile(r"TIMES\.slice\(0, -1\)\.forEach\(t => \{.*qrStartTime\.addEventListener\('change', \(\) => \{.*qrEndTime\.appendChild\(opt\);\n\s*\}\);\n\s*\}\);", re.DOTALL)
content2 = pattern2.sub(dashboard_replacement.strip(), content2)

with open("public/js/dashboard.js", "w", encoding="utf-8") as f:
    f.write(content2)

