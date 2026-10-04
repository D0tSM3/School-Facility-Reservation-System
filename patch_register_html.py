import os

with open('public/register.html', 'r', encoding='utf-8') as f:
    content = f.read()

find = """            <form id="registerForm" class="flex flex-col gap-4">
              <!-- Name Row -->"""

replace = """            <form id="registerForm" class="flex flex-col gap-4">
              <!-- Account Type -->
              <div>
                <label class="block text-[13px] font-bold text-[#00173d] mb-1.5">Account Type <span class="text-red-500">*</span></label>
                <div class="grid grid-cols-2 gap-3">
                  <label class="relative flex items-center justify-center p-3 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 has-[:checked]:border-[#7a1f2b] has-[:checked]:bg-red-50 transition-all">
                    <input type="radio" name="account_type" value="Student" class="sr-only" required>
                    <div class="flex items-center gap-2">
                      <span class="material-symbols-outlined text-[20px] text-gray-500 group-has-[:checked]:text-[#7a1f2b]">school</span>
                      <span class="text-[14px] font-bold text-gray-700 group-has-[:checked]:text-[#7a1f2b]">Student</span>
                    </div>
                  </label>
                  <label class="relative flex items-center justify-center p-3 border border-gray-200 rounded-xl cursor-pointer hover:bg-gray-50 has-[:checked]:border-[#7a1f2b] has-[:checked]:bg-red-50 transition-all">
                    <input type="radio" name="account_type" value="Faculty" class="sr-only" required>
                    <div class="flex items-center gap-2">
                      <span class="material-symbols-outlined text-[20px] text-gray-500 group-has-[:checked]:text-[#7a1f2b]">badge</span>
                      <span class="text-[14px] font-bold text-gray-700 group-has-[:checked]:text-[#7a1f2b]">Faculty</span>
                    </div>
                  </label>
                </div>
                <p id="err-account-type" class="hidden text-[12px] text-error mt-1 font-medium">Please select an account type.</p>
              </div>

              <!-- Name Row -->"""

if find in content:
    content = content.replace(find, replace)
    with open('public/register.html', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Added Account Type to register.html")
else:
    print("Could not find insertion point!")
