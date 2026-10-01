import re

with open("public/js/booking.js", "r", encoding="utf-8") as f:
    js = f.read()

# Change the text to mention "Request a slip"
old_text = "`This room is already booked during ${when}. You can pick another time, or ask staff for an urgent override.`;"
new_text = "`This room is already booked during ${when}. You can pick another time, or request a slip for a conflict override.`;"
js = js.replace(old_text, new_text)

# Also update the modal title text to say "Request a Slip"
# Since the modal is dynamically built, let's search for "Urgent Override Request"
old_modal_html = "Urgent Override Request"
new_modal_html = "Request a Slip (Conflict Override)"
js = js.replace(old_modal_html, new_modal_html)

# Let's search for "Request Override"
old_btn_text = "Request Override"
new_btn_text = "Request a Slip"
js = js.replace(old_btn_text, new_btn_text)

with open("public/js/booking.js", "w", encoding="utf-8") as f:
    f.write(js)
