import re

with open("public/js/reservations.js", "r", encoding="utf-8") as f:
    content = f.read()

replacement = """
        let filterStatus = reservation.status.toLowerCase();
        if (isPast && reservation.status !== 'Pending' && reservation.status !== 'Rejected' && reservation.status !== 'Cancelled') {
          filterStatus = 'history';
        }
"""

content = re.sub(
    r"\s*let filterStatus = reservation\.status\.toLowerCase\(\);\s*if \(isPast && reservation\.status !== 'Rejected' && reservation\.status !== 'Cancelled'\) \{\s*filterStatus = 'history';\s*\}",
    replacement,
    content
)

with open("public/js/reservations.js", "w", encoding="utf-8") as f:
    f.write(content)
