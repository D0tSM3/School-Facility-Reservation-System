import re

with open("public/js/booking.js", "r", encoding="utf-8") as f:
    js = f.read()

# Remove the dynamic overwrite of dateRangeHint
old_hint_overwrite = r"""    const hint = document.getElementById\('dateRangeHint'\);\s*if \(hint\) \{\s*hint\.textContent = 'For one day, use the same date twice\. The start and end times below apply to every day in the range\. ' \+\s*`Open \$\{window\.CampusSchedule\.fmt12\(rules\.open\)\} \u2013 \$\{window\.CampusSchedule\.fmt12\(rules\.close\)\}` \+\s*\(rules\.closedDays\.length \? `, closed \$\{closedDaysText\(\)\}\.` : ', every day\.'\);\s*\}"""

js = re.sub(old_hint_overwrite, "", js, flags=re.DOTALL)

# Update the checkboxes style in booking.js to match the UI screenshot
old_checkbox = r"""        const label = document.createElement\('label'\);\s*label\.className = 'flex items-center gap-1\.5 bg-gray-100 px-3 py-1\.5 rounded-lg cursor-pointer hover:bg-gray-200 transition-colors border border-gray-200';\s*label\.innerHTML = `<input type="checkbox" name="active_days" value="\$\{dateStr\}" class="accent-\[\#7a1f2b\]" checked><span class="text-xs font-semibold text-gray-700">\$\{display\}</span>`;"""
new_checkbox = """        const label = document.createElement('label');
        label.className = 'flex items-center gap-2.5 bg-white px-3.5 py-2.5 rounded-lg cursor-pointer border border-gray-200 shadow-sm transition-colors hover:border-[#7a1f2b]/30';
        label.innerHTML = `<input type="checkbox" name="active_days" value="${dateStr}" class="w-4 h-4 text-[#7a1f2b] bg-white border-gray-300 rounded focus:ring-[#7a1f2b] focus:ring-1" checked><span class="text-[13px] font-bold text-[#1e293b]">${dayName} <span class="text-gray-400 font-normal ml-1">· ${curr.toLocaleString('en-US', {month:'short', day:'numeric'})}</span></span>`;
        label.querySelector('input').addEventListener('change', () => { 
            const count = document.querySelectorAll('input[name="active_days"]:checked').length;
            const counter = document.getElementById('selectedDaysCount');
            if (counter) counter.textContent = `${count} selected`;
            onDatesChanged(); 
            updateCalendarSelection(); 
        });"""

js = re.sub(old_checkbox, new_checkbox, js, flags=re.DOTALL)

# Also update the renderSpecificDays function to initialize the count
init_count = """      if (daysDiff > 6) {
        dayCheckboxesContainer.innerHTML = '<span class="text-xs text-red-500">Range exceeds 7 days.</span>';
        return;
      }"""
init_count_new = """      if (daysDiff > 6) {
        dayCheckboxesContainer.innerHTML = '<span class="text-xs text-red-500">Range exceeds 7 days.</span>';
        return;
      }
      
      const counter = document.getElementById('selectedDaysCount');"""
js = js.replace(init_count, init_count_new)

# After the while loop, update the initial count
end_loop = """        curr.setDate(curr.getDate() + 1);
      }"""
end_loop_new = """        curr.setDate(curr.getDate() + 1);
      }
      if (counter) {
        const count = document.querySelectorAll('input[name="active_days"]:checked').length;
        counter.textContent = `${count} selected`;
      }"""
js = js.replace(end_loop, end_loop_new)

with open("public/js/booking.js", "w", encoding="utf-8") as f:
    f.write(js)
