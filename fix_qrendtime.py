with open("public/js/dashboard.js", "r", encoding="utf-8") as f:
    content = f.read()

content = content.replace(
    "if (qrEndTime) qrEndTime.innerHTML = '<option value=\"\">Select end time</option>';",
    "if (qrEndTime) { qrEndTime.value = ''; Array.from(qrEndTime.options).forEach(opt => { opt.disabled = false; opt.hidden = false; }); }"
)

with open("public/js/dashboard.js", "w", encoding="utf-8") as f:
    f.write(content)
