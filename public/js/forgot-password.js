document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  // ==========================================
  // 1. SUPABASE AUTH CREDENTIALS
  // ==========================================
  // Replace these placeholder strings with your actual credentials
  // from Project Settings -> API in your Supabase Dashboard
  const SUPABASE_URL = 'https://grtsfjxlnujknehnczcv.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdydHNmanhsbnVqa25laG5jemN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxNTc1MTMsImV4cCI6MjEwNTczMzUxM30.L_BcXlECf0_S4YHbGJZqNCHOBSj7941M0WNJ3zZgx7A';

  if (!window.supabase) {
    console.error('Supabase client library failed to load.');
    return;
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ==========================================
  // 2. DOM SELECTORS
  // ==========================================
  const stepRequest = document.getElementById('stepRequest');
  const stepReset = document.getElementById('stepReset');
  const recoveryEmail = document.getElementById('recoveryEmail');
  const displayEmail = document.getElementById('displayEmail');
  const btnSendCode = document.getElementById('btnSendCode');
  const btnUpdate = document.getElementById('btnUpdatePassword');
  const statusBanner = document.getElementById('statusBanner');
  const statusMsg = document.getElementById('statusMsg');
  const statusIcon = document.getElementById('statusIcon');
  const otpInputs = document.querySelectorAll('.otp-digit');
  const newPassInput = document.getElementById('newPass');
  const confirmPassInput = document.getElementById('confirmPass');

  // ==========================================
  // 3. UI NOTIFICATION HELPERS
  // ==========================================
  function showMessage(msg, isError) {
    statusBanner.className = isError
      ? 'mb-4 bg-error-container text-on-error-container rounded-lg px-4 py-3 flex items-start gap-2'
      : 'mb-4 bg-emerald-50 border border-emerald-300 text-emerald-900 rounded-lg px-4 py-3 flex items-start gap-2';

    statusIcon.textContent = isError ? 'error' : 'check_circle';
    statusIcon.className = `material-symbols-outlined text-[18px] shrink-0 mt-0.5 ${
      isError ? 'text-error' : 'text-emerald-700'
    }`;
    statusMsg.textContent = msg;
    statusBanner.classList.remove('hidden');
  }

  function clearMessage() {
    statusBanner.classList.add('hidden');
  }

  // ==========================================
  // 4. OTP INPUT FIELD LOGIC (AUTO-ADVANCE & PASTE)
  // ==========================================
  otpInputs.forEach((inp, idx) => {
    // Advance to next box when a digit is entered
    inp.addEventListener('input', () => {
      const val = inp.value.replace(/[^0-9]/g, '');
      inp.value = val ? val[val.length - 1] : '';
      if (val && idx < otpInputs.length - 1) {
        otpInputs[idx + 1].focus();
      }
    });

    // Go to previous box on backspace
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !inp.value && idx > 0) {
        otpInputs[idx - 1].focus();
        otpInputs[idx - 1].value = '';
      }
    });

    // Support copying & pasting full 6 digits into any box
    inp.addEventListener('paste', (e) => {
      const pasteText = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      if (pasteText.length >= 6) {
        e.preventDefault();
        otpInputs.forEach((box, i) => {
          box.value = pasteText[i] || '';
        });
        otpInputs[5].focus();
      }
    });
  });

  // ==========================================
  // 5. PASSWORD VISIBILITY TOGGLE
  // ==========================================
  document.querySelectorAll('.pwd-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetInput = document.getElementById(btn.getAttribute('data-target'));
      if (!targetInput) return;

      const isPwd = targetInput.type === 'password';
      targetInput.type = isPwd ? 'text' : 'password';

      const icon = btn.querySelector('.material-symbols-outlined');
      if (icon) {
        icon.textContent = isPwd ? 'visibility' : 'visibility_off';
      }
    });
  });

  // ==========================================
  // 6. STEP 1: REQUEST OTP RECOVERY CODE
  // ==========================================
  if (btnSendCode) {
    btnSendCode.addEventListener('click', async () => {
      clearMessage();
      const email = (recoveryEmail ? recoveryEmail.value : '').trim();

      if (!email) {
        showMessage('Please enter your university email address.', true);
        return;
      }

      btnSendCode.disabled = true;
      btnSendCode.textContent = 'Sending code…';

      try {
        // Dispatches 6-digit recovery OTP via Supabase Auth
        const { error } = await sb.auth.signInWithOtp({
          email: email,
          options: { shouldCreateUser: false },
        });

        btnSendCode.disabled = false;
        btnSendCode.textContent = 'Send Recovery Code';

        if (error) {
          showMessage(error.message, true);
        } else {
          displayEmail.textContent = email;
          stepRequest.classList.add('hidden');
          stepReset.classList.remove('hidden');
          showMessage('Verification code sent! Check your inbox.', false);
          if (otpInputs[0]) otpInputs[0].focus();
        }
      } catch (err) {
        btnSendCode.disabled = false;
        btnSendCode.textContent = 'Send Recovery Code';
        showMessage('Network error while requesting verification code.', true);
      }
    });
  }

  // ==========================================
  // 7. STEP 2: VERIFY OTP & UPDATE PASSWORD
  // ==========================================
  if (btnUpdate) {
    btnUpdate.addEventListener('click', async () => {
      clearMessage();
      const email = (recoveryEmail ? recoveryEmail.value : '').trim();
      const otp = Array.from(otpInputs).map((i) => i.value).join('');
      const newPass = newPassInput ? newPassInput.value : '';
      const confirmPass = confirmPassInput ? confirmPassInput.value : '';

      if (otp.length !== 6) {
        showMessage('Please enter all 6 digits of your verification code.', true);
        return;
      }
      if (newPass.length < 8) {
        showMessage('Password must be at least 8 characters long.', true);
        return;
      }
      if (newPass !== confirmPass) {
        showMessage('Passwords do not match.', true);
        return;
      }

      btnUpdate.disabled = true;
      btnUpdate.textContent = 'Updating…';

      try {
        // 1. Verify OTP code against Supabase Auth recovery scope
        const { error: verifyError } = await sb.auth.verifyOtp({
          email: email,
          token: otp,
          type: 'recovery',
        });

        if (verifyError) {
          btnUpdate.disabled = false;
          btnUpdate.textContent = 'Update Password & Sign In';
          showMessage(verifyError.message || 'Invalid or expired verification code.', true);
          return;
        }

        // 2. Set new password on the newly validated user session
        const { error: updateError } = await sb.auth.updateUser({ password: newPass });

        if (updateError) {
          btnUpdate.disabled = false;
          btnUpdate.textContent = 'Update Password & Sign In';
          showMessage(updateError.message, true);
        } else {
          showMessage('Password updated successfully! Redirecting to sign in…', false);
          // Invalidate temporary recovery session before sending to login
          await sb.auth.signOut();
          setTimeout(() => {
            window.location.href = 'index.html';
          }, 1500);
        }
      } catch (err) {
        btnUpdate.disabled = false;
        btnUpdate.textContent = 'Update Password & Sign In';
        showMessage('Network error while resetting password.', true);
      }
    });
  }
});