import os

with open('public/js/reservations.js', 'r', encoding='utf-8') as f:
    content = f.read()

find = """        dateBlockHtml = `
          <!-- Date block: MULTI-DAY -->
          <div class="border border-gray-200 rounded-lg overflow-hidden text-center min-w-[68px] shrink-0 flex flex-col bg-white">
            <div class="bg-[#7a1f2b] text-white text-[9px] font-bold py-1 px-1 uppercase tracking-widest whitespace-nowrap">MULTI-DAY</div>
            <div class="text-xl font-bold text-gray-900 py-2 leading-none">${reservation.datesObj.length}<br><span class="text-[10px] font-normal text-gray-500 uppercase tracking-widest">Days</span></div>
          </div>
        `;"""

replace = """        let topHeader = `${monthFirst} ${first.getFullYear()}`;
        let mainContent = '';
        
        if (reservation.is_consecutive) {
           const mFirst = first.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
           const mLast = last.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
           const yFirst = first.getFullYear();
           const yLast = last.getFullYear();
           
           if (yFirst !== yLast) {
               topHeader = 'MULTI-DAY';
               mainContent = `${mFirst} ${first.getDate()}<br>–<br>${mLast} ${last.getDate()}`;
           } else if (mFirst !== mLast) {
               topHeader = `${yFirst}`;
               mainContent = `${mFirst} ${first.getDate()}<br>–<br>${mLast} ${last.getDate()}`;
           } else {
               topHeader = `${mFirst} ${yFirst}`;
               mainContent = `${first.getDate()}–${last.getDate()}`;
           }
        } else {
           const mFirst = first.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
           const mLast = last.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
           
           if (mFirst !== mLast || first.getFullYear() !== last.getFullYear()) {
               topHeader = 'MULTI-DAY';
               mainContent = reservation.datesObj.length + '<br><span class="text-[10px] font-normal text-gray-500 uppercase tracking-widest">Days</span>';
           } else {
               topHeader = `${mFirst} ${first.getFullYear()}`;
               mainContent = reservation.datesObj.map(d => d.getDate()).join(', ');
           }
        }

        dateBlockHtml = `
          <!-- Date block: MULTI-DAY -->
          <div class="border border-gray-200 rounded-lg overflow-hidden text-center min-w-[76px] shrink-0 flex flex-col bg-white">
            <div class="bg-[#7a1f2b] text-white text-[9px] font-bold py-1 px-1 uppercase tracking-widest whitespace-nowrap">${topHeader}</div>
            <div class="text-[15px] font-bold text-gray-900 py-2 px-1 leading-tight flex items-center justify-center flex-1">${mainContent}</div>
          </div>
        `;"""

content = content.replace(find, replace)

with open('public/js/reservations.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Done')
