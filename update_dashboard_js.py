import re

with open("public/js/dashboard.js", "r", encoding="utf-8") as f:
    content = f.read()

# Remove qrEquipment declaration
content = re.sub(
    r"const qrEquipment = document.getElementById\('qrEquipment'\);",
    r"",
    content
)

# Update reset logic
content = re.sub(
    r"if \(qrEquipment\) qrEquipment\.value = '';",
    r"document.querySelectorAll('.qr-equipment-checkbox').forEach(cb => cb.checked = false);",
    content
)

# Update payload assembly logic
payload_assembly = """
      let selectedEquipment = [];
      document.querySelectorAll('.qr-equipment-checkbox:checked').forEach(cb => {
        selectedEquipment.push(cb.getAttribute('data-equipment'));
      });
      const eqString = selectedEquipment.length > 0 ? selectedEquipment.join(', ') : '';
      const equipmentNotes = `Expected Capacity: ${qrCapacity.value}. ` + eqString;
"""

content = re.sub(
    r"const equipmentNotes = `Expected Capacity: \$\{qrCapacity\.value\}\. ` \+ \(qrEquipment\.value \|\| ''\);",
    payload_assembly.strip(),
    content
)

with open("public/js/dashboard.js", "w", encoding="utf-8") as f:
    f.write(content)
