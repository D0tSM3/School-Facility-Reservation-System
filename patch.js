const fs = require('fs');
let file = fs.readFileSync('public/js/reservations.js', 'utf8');

const targetStr =       return \\\<div data-status="\\$\\{escapeHtml(filterStatus)\\}" class="reservation-card bg-white px-5 py-4 rounded-xl border border-gray-200 shadow-sm mb-3 transition-all hover:border-gray-300 hover:shadow">
        <div class="flex items-center gap-5">

          <!-- Date block: month + year on same header line, large day below -->
          <div class="border border-gray-200 rounded-lg overflow-hidden text-center min-w-[68px] shrink-0 flex flex-col bg-white">
            <div class="bg-[#7a1f2b] text-white text-[9px] font-bold py-1 px-1 uppercase tracking-widest whitespace-nowrap">\\$\\{date.month\\} \\$\\{date.year\\}</div>
            <div class="text-2xl font-bold text-gray-900 py-2 leading-none">\\$\\{date.day\\}</div>
          </div>

          <!-- Main info -->
          <div class="flex flex-col flex-1 min-w-0">

            <!-- Title row: Detailed Purpose Description + ref badge + status badge -->
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="text-base font-bold text-gray-900 leading-tight">\\$\\{escapeHtml(reservation.purpose)\\}</h3>
              <span class="text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-mono tracking-wide shrink-0">#RES-\\$\\{escapeHtml(reservation.reservation_id).substring(0,8).toUpperCase()\\}</span>
              <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded shrink-0 \\$\\{statusColor\\}">\\$\\{statusText\\}</span>
            </div>

            <!-- Subtitle row: Selected Facility • Classification • Time -->
            <div class="flex items-center gap-3 text-sm text-gray-500 mt-1 flex-wrap">
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-[15px] text-gray-400">location_on</span>
                <span class="font-medium text-gray-700">\\$\\{escapeHtml(reservation.room_name || reservation.room_id)\\}</span>
              </span>
              \\$\\{reservation.category ? \\\
              <span class="text-gray-300 select-none">•</span>
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-[15px] text-gray-400">supervisor_account</span>
                <span>\\$\\{escapeHtml(reservation.category)\\}</span>
              </span>\\\ : ''\\}
              <span class="text-gray-300 select-none">•</span>
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-[15px] text-gray-400">schedule</span>
                <span>\\$\\{formatTime(reservation.start_time)\\} – \\$\\{formatTime(reservation.end_time)\\}</span>
              </span>
            </div>;

const replaceStr =       let dateBlockHtml = '';
      let extraInfoHtml = '';

      if (reservation.is_multi_day) {
        const first = reservation.datesObj[0];
        const last = reservation.datesObj[reservation.datesObj.length - 1];
        const monthFirst = first.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
        
        let displayType = reservation.is_consecutive ? 'Multiple Days — Consecutive Range' : 'Multiple Days — Specific Days';
        
        let datesText = '';
        if (reservation.is_consecutive) {
           datesText = \\\\\$\\{monthFirst\\} \\$\\{first.getDate()\\}–\\$\\{last.getDate()\\}, \\$\\{first.getFullYear()\\}\\\;
        } else {
           datesText = reservation.datesObj.map(d => \\\\\$\\{d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()\\} \\$\\{d.getDate()\\}\\\).join(', ') + \\\, \\$\\{first.getFullYear()\\}\\\;
        }

        dateBlockHtml = \\\
          <div class="border border-gray-200 rounded-lg overflow-hidden text-center min-w-[68px] shrink-0 flex flex-col bg-white">
            <div class="bg-[#7a1f2b] text-white text-[9px] font-bold py-1 px-1 uppercase tracking-widest whitespace-nowrap">MULTI-DAY</div>
            <div class="text-xl font-bold text-gray-900 py-2 leading-none">\\$\\{reservation.datesObj.length\\}<br><span class="text-[10px] font-normal text-gray-500 uppercase tracking-widest">Days</span></div>
          </div>
        \\\;

        extraInfoHtml = \\\
              <span class="text-gray-300 select-none">•</span>
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-[15px] text-gray-400">calendar_month</span>
                <span>\\$\\{escapeHtml(datesText)\\}</span>
              </span>
              <span class="text-gray-300 select-none">•</span>
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-[15px] text-gray-400">style</span>
                <span>\\$\\{escapeHtml(displayType)\\}</span>
              </span>
        \\\;
      } else {
        dateBlockHtml = \\\
          <div class="border border-gray-200 rounded-lg overflow-hidden text-center min-w-[68px] shrink-0 flex flex-col bg-white">
            <div class="bg-[#7a1f2b] text-white text-[9px] font-bold py-1 px-1 uppercase tracking-widest whitespace-nowrap">\\$\\{date.month\\} \\$\\{date.year\\}</div>
            <div class="text-2xl font-bold text-gray-900 py-2 leading-none">\\$\\{date.day\\}</div>
          </div>
        \\\;
      }

      return \\\<div data-status="\\$\\{escapeHtml(filterStatus)\\}" class="reservation-card bg-white px-5 py-4 rounded-xl border border-gray-200 shadow-sm mb-3 transition-all hover:border-gray-300 hover:shadow">
        <div class="flex items-center gap-5">

          \\$\\{dateBlockHtml\\}

          <!-- Main info -->
          <div class="flex flex-col flex-1 min-w-0">

            <!-- Title row: Detailed Purpose Description + ref badge + status badge -->
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="text-base font-bold text-gray-900 leading-tight">\\$\\{escapeHtml(reservation.purpose)\\}</h3>
              <span class="text-[10px] font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-mono tracking-wide shrink-0">#RES-\\$\\{escapeHtml(reservation.reservation_id).substring(0,8).toUpperCase()\\}</span>
              <span class="text-[10px] font-bold uppercase px-2 py-0.5 rounded shrink-0 \\$\\{statusColor\\}">\\$\\{statusText\\}</span>
            </div>

            <!-- Subtitle row: Selected Facility • Classification • Time -->
            <div class="flex items-center gap-3 text-sm text-gray-500 mt-1 flex-wrap">
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-[15px] text-gray-400">location_on</span>
                <span class="font-medium text-gray-700">\\$\\{escapeHtml(reservation.room_name || reservation.room_id)\\}</span>
              </span>
              \\$\\{reservation.category ? \\\
              <span class="text-gray-300 select-none">•</span>
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-[15px] text-gray-400">supervisor_account</span>
                <span>\\$\\{escapeHtml(reservation.category)\\}</span>
              </span>\\\ : ''\\}
              <span class="text-gray-300 select-none">•</span>
              <span class="flex items-center gap-1">
                <span class="material-symbols-outlined text-[15px] text-gray-400">schedule</span>
                <span>\\$\\{formatTime(reservation.start_time)\\} – \\$\\{formatTime(reservation.end_time)\\}</span>
              </span>
              \\$\\{extraInfoHtml\\}
            </div>\;

const targetNormalized = targetStr.replace(/\r\n/g, '\n');
const fileNormalized = file.replace(/\r\n/g, '\n');

if (fileNormalized.indexOf(targetNormalized) === -1) {
  console.log('Target string not found!');
  process.exit(1);
}

const newFile = fileNormalized.replace(targetNormalized, replaceStr.replace(/\r\n/g, '\n'));
fs.writeFileSync('public/js/reservations.js', newFile, 'utf8');
console.log('Done!');
