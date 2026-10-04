import os

with open('public/register.html', 'r', encoding='utf-8') as f:
    content = f.read()

find = """          isValid = validateField("bpu-fname", "err-fname") && isValid;"""

replace = """          const accTypeCheck = document.querySelector('input[name="account_type"]:checked');
          const errAccType = document.getElementById('err-account-type');
          if (!accTypeCheck) {
            errAccType.classList.remove('hidden');
            isValid = false;
          } else {
            errAccType.classList.add('hidden');
          }
          isValid = validateField("bpu-fname", "err-fname") && isValid;"""

if find in content:
    content = content.replace(find, replace)
    print("Added frontend validation")
else:
    print("Could not find frontend validation")

find2 = """              body: JSON.stringify({
                name,
                email,
                password: pass,
                recaptcha_token: recaptchaToken,
              }),"""

replace2 = """              body: JSON.stringify({
                name,
                email,
                password: pass,
                account_type: accTypeCheck ? accTypeCheck.value : '',
                recaptcha_token: recaptchaToken,
              }),"""

if find2 in content:
    content = content.replace(find2, replace2)
    with open('public/register.html', 'w', encoding='utf-8') as f:
        f.write(content)
    print("Added account_type to payload")
else:
    print("Could not find payload")
