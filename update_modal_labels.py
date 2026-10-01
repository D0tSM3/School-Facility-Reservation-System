import re

with open("public/rooms.html", "r", encoding="utf-8") as f:
    html = f.read()

# 1. Target Facility
old_tf = r'<label class="text-sm font-bold text-gray-800" for="roomSelect">Target Facility <span class="text-red-500">\*</span></label>'
new_tf = r'<span class="text-[10px] font-extrabold text-[#2a303c] uppercase tracking-widest mb-3 block">TARGET FACILITY <span class="text-red-500">*</span></span>'
html = re.sub(old_tf, new_tf, html)

old_tf_input = r'<select id="roomSelect" class="w-full pl-10 pr-8 py-2.5 bg-\[\#f8f9fb\] border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-\[\#7a1f2b\] focus:border-\[\#7a1f2b\] appearance-none" required>'
new_tf_input = r'<select id="roomSelect" class="w-full pl-10 pr-8 py-2.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-[#7a1f2b] focus:border-[#7a1f2b] appearance-none" required>'
html = re.sub(old_tf_input, new_tf_input, html)


# 2. Primary Reservation Classification
old_rc = r'<label class="text-sm font-bold text-gray-800">Primary Reservation Classification <span class="text-red-500">\*</span></label>'
new_rc = r'<span class="text-[10px] font-extrabold text-[#2a303c] uppercase tracking-widest mb-3 block">PRIMARY RESERVATION CLASSIFICATION <span class="text-red-500">*</span></span>'
html = re.sub(old_rc, new_rc, html)


# 3. Detailed Purpose Description
old_dp = r'<label class="text-sm font-bold text-gray-800" for="purpose">Detailed Purpose Description <span class="text-red-500">\*</span></label>'
new_dp = r'<span class="text-[10px] font-extrabold text-[#2a303c] uppercase tracking-widest mb-3 block">DETAILED PURPOSE DESCRIPTION <span class="text-red-500">*</span></span>'
html = re.sub(old_dp, new_dp, html)

old_dp_input = r'class="w-full p-4 bg-\[\#f8f9fb\] border border-gray-200 rounded-xl text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-\[\#7a1f2b\] focus:border-\[\#7a1f2b\]"'
new_dp_input = r'class="w-full p-3.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-1 focus:ring-[#7a1f2b] focus:border-[#7a1f2b]"'
html = re.sub(old_dp_input, new_dp_input, html)


# 4. Special Equipment & Technical Logistics
old_eq = r'<label class="text-sm font-bold text-gray-800">Special Equipment &amp; Technical Logistics</label>'
new_eq = r'<span class="text-[10px] font-extrabold text-[#2a303c] uppercase tracking-widest mb-3 block mt-6">SPECIAL EQUIPMENT &amp; TECHNICAL LOGISTICS</span>'
html = re.sub(old_eq, new_eq, html)

# 5. Policy Acknowledgement label style update
old_policy = r'<span class="text-sm font-bold text-gray-800 block">Institutional Space Policy Acknowledgement</span>'
new_policy = r'<span class="text-sm font-bold text-[#1e293b] block">Institutional Space Policy Acknowledgement</span>'
html = re.sub(old_policy, new_policy, html)

# Replace the layout of the 'Classification' boxes to match the new crisp border styles (like the BOOKING TYPE boxes).
old_class_box = r'class="h-full px-2 py-4 rounded-xl border border-gray-200 bg-white text-gray-500 text-center transition-all peer-checked:bg-\[\#7a1f2b\] peer-checked:border-\[\#7a1f2b\] peer-checked:text-white flex flex-col items-center gap-2 hover:bg-gray-50 shadow-sm"'
new_class_box = r'class="h-full px-2 py-4 rounded-xl border border-gray-300 bg-white text-gray-500 text-center transition-all peer-checked:bg-[#7a1f2b] peer-checked:border-[#7a1f2b] peer-checked:text-white flex flex-col items-center gap-2 hover:bg-[#faf5f6] hover:border-[#7a1f2b]/30 shadow-sm"'
html = re.sub(old_class_box, new_class_box, html)

with open("public/rooms.html", "w", encoding="utf-8") as f:
    f.write(html)
