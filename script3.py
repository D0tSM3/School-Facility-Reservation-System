import re
with open('public/rooms.html', 'r', encoding='utf-8') as f:
  content = f.read()
content = content.replace('TARGET FACILITY <span class=\
text-red-500\>*</span></span>', 'TARGET FACILITY <span class=\text-red-500
normal-case
text-[10px]
tracking-normal
ml-1\>Required</span></span>')
content = content.replace('BOOKING TYPE</span>', 'BOOKING TYPE <span class=\text-red-500
normal-case
text-[10px]
tracking-normal
ml-1\>Required</span></span>')
content = content.replace('DATE</span>', 'DATE <span class=\text-red-500
normal-case
text-[10px]
tracking-normal
ml-1\>Required</span></span>')
content = content.replace('TIME</span>', 'TIME <span class=\text-red-500
normal-case
text-[10px]
tracking-normal
ml-1\>Required</span></span>')
content = content.replace('CLASSIFICATION <span class=\text-red-500\>*</span></span>', 'CLASSIFICATION <span class=\text-red-500
normal-case
text-[10px]
tracking-normal
ml-1\>Required</span></span>')
content = content.replace('DESCRIPTION <span class=\text-red-500\>*</span></span>', 'DESCRIPTION <span class=\text-red-500
normal-case
text-[10px]
tracking-normal
ml-1\>Required</span></span>')
content = content.replace('Submit Request\n                </button>', 'Reserve\n                </button>')
with open('public/rooms.html', 'w', encoding='utf-8') as f:
  f.write(content)
