import re

with open("public/rooms.html", "r", encoding="utf-8") as f:
    html = f.read()

# First, extract the calendar block wherever it is currently
calendar_match = re.search(r'(<!-- Facility Weekly Availability -->.*?<div id="room-calendar-container".*?</div>\s*</div>)', html, re.DOTALL)
if calendar_match:
    calendar_html = calendar_match.group(1)
    # Remove it from current location
    html = html.replace(calendar_html, '')
    
    # Now, find the END of the TIME block.
    # The TIME block ends exactly before: <!-- Classification Radios -->
    
    classification_match = re.search(r'<!-- Classification Radios -->', html)
    if classification_match:
        # Insert the calendar right before Classification Radios
        html = html.replace('<!-- Classification Radios -->', calendar_html + '\n\n              <!-- Classification Radios -->')

with open("public/rooms.html", "w", encoding="utf-8") as f:
    f.write(html)
