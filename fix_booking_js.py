import re

with open("public/js/booking.js", "r", encoding="utf-8") as f:
    content = f.read()

# I need to fix the syntax error where I accidentally replaced ALL_END_OPTIONS declaration.
# Let's just restore the correct block.

replacement = """
  let syncEndOptions = () => {};
  if (startTimeInput && endTimeInput) {
    const ALL_END_OPTIONS = Array.from(endTimeInput.options)
      .filter(o => o.value)
      .map(o => ({ value: o.value, text: o.textContent }));

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

    startTimeInput.addEventListener('change', () => { syncEndOptions(); validateTime(); updateCalendarSelection(); });
  }
"""

# I need to find the broken block:
# It currently starts with `let syncEndOptions = () => {` and ends with `});` just before `// 3.3:`
pattern = re.compile(r'let syncEndOptions = \(\) => \{.*startTimeInput\.addEventListener\(\'change\', \(\) => \{ syncEndOptions\(\); validateTime\(\); updateCalendarSelection\(\); \}\);\n\s*\}', re.DOTALL)

# Wait, `startTimeInput.addEventListener` might have been inside or outside the block.
content = re.sub(
    r'let syncEndOptions = \(\) => \{.*?startTimeInput\.addEventListener\(\'change\', \(\) => \{ syncEndOptions\(\); validateTime\(\); updateCalendarSelection\(\); \}\);\n\s*\}',
    replacement.strip(),
    content,
    flags=re.DOTALL
)

with open("public/js/booking.js", "w", encoding="utf-8") as f:
    f.write(content)
