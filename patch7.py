import os

with open('public/js/reservations.js', 'r', encoding='utf-8') as f:
    content = f.read()

find = """        extraInfoHtml = `
              <span class="text-gray-300 select-none">&bull;</span>
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-[15px] text-gray-400">calendar_month</span>
                <span>${escapeHtml(datesText)}</span>
              </span>
              <span class="text-gray-300 select-none">&bull;</span>
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-[15px] text-gray-400">style</span>
                <span>${escapeHtml(displayType)}</span>
              </span>
        `;"""

replace = """        let datesTextHtml = '';
        if (reservation.series_rows.some(r => r.status !== reservation.status)) {
           // Display specific dates with their statuses if they differ
           datesTextHtml = reservation.series_rows.map(r => {
             const d = parseDate(r.start_time);
             const statusColor = r.status === 'Pending' ? 'text-yellow-600' : (r.status === 'Approved' ? 'text-green-600' : 'text-gray-600');
             return `<span class="${statusColor}">${d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()} ${d.getDate()} (${r.status})</span>`;
           }).join(', ') + `, ${first.getFullYear()}`;
        } else {
           datesTextHtml = escapeHtml(datesText);
        }
        
        extraInfoHtml = `
              <span class="text-gray-300 select-none">&bull;</span>
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-[15px] text-gray-400">calendar_month</span>
                <span>${datesTextHtml}</span>
              </span>
              <span class="text-gray-300 select-none">&bull;</span>
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-[15px] text-gray-400">style</span>
                <span>${escapeHtml(displayType)}</span>
              </span>
        `;"""

content = content.replace(find, replace)

with open('public/js/reservations.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Success')
