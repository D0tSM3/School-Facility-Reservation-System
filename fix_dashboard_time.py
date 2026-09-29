import re

with open("public/js/dashboard.js", "r", encoding="utf-8") as f:
    content = f.read()

replacement = """
  if (qrStartTime && qrEndTime) {
    TIMES.slice(0, -1).forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = format12(t);
      qrStartTime.appendChild(opt);
    });

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
  }
"""

pattern = re.compile(r"if \(qrStartTime && qrEndTime\) \{.*?\}\);[\s\n]*\}", re.DOTALL)
content = pattern.sub(replacement.strip(), content)

with open("public/js/dashboard.js", "w", encoding="utf-8") as f:
    f.write(content)
