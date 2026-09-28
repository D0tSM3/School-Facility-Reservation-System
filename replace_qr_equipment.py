import re

with open("public/dashboard.html", "r", encoding="utf-8") as f:
    content = f.read()

replacement = """<label class="block text-sm font-bold text-gray-700 mb-1">Special Equipment &amp; Technical Logistics</label>
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3" id="qrEquipmentOptions">
                  <label class="flex items-start gap-3 p-4 bg-white border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors shadow-sm">
                    <input class="mt-0.5 rounded text-amber-500 focus:ring-amber-500 w-4 h-4 qr-equipment-checkbox" data-equipment="Wireless Lapel Mic" type="checkbox" />
                    <div class="flex flex-col">
                      <span class="text-sm font-bold text-gray-800">Wireless Lapel Mic</span>
                      <span class="text-xs text-gray-500 mt-0.5">2 Transmitters &amp; fresh batteries</span>
                    </div>
                  </label>
                  <label class="flex items-start gap-3 p-4 bg-white border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors shadow-sm">
                    <input class="mt-0.5 rounded text-amber-500 focus:ring-amber-500 w-4 h-4 qr-equipment-checkbox" data-equipment="HDMI Cable Kit" type="checkbox" />
                    <div class="flex flex-col">
                      <span class="text-sm font-bold text-gray-800">HDMI Cable Kit</span>
                      <span class="text-xs text-gray-500 mt-0.5">USB-C to 4K / DisplayPort</span>
                    </div>
                  </label>
                  <label class="flex items-start gap-3 p-4 bg-white border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 transition-colors shadow-sm">
                    <input class="mt-0.5 rounded text-amber-500 focus:ring-amber-500 w-4 h-4 qr-equipment-checkbox" data-equipment="Archival Recording Pod" type="checkbox" />
                    <div class="flex flex-col">
                      <span class="text-sm font-bold text-gray-800">Archival Recording Pod</span>
                      <span class="text-xs text-gray-500 mt-0.5">Fixed dual cam room capture</span>
                    </div>
                  </label>
                </div>"""

# Find the label and textarea
pattern = r'<label class="block text-sm font-bold text-gray-700 mb-1">Special Equipment / Setup</label>\s*<textarea id="qrEquipment"[^>]*></textarea>'
content = re.sub(pattern, replacement, content)

with open("public/dashboard.html", "w", encoding="utf-8") as f:
    f.write(content)
