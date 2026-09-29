/**
 * CampusRoom — Forgot Password & Account Recovery Logic
 * Handles institutional email validation, reCAPTCHA integration,
 * 6-digit OTP code verification, new password updating, and dynamic feedback.
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const BASE_URI = window.location.pathname.replace(/[^\/]*$/, '');

  // ==========================================
  // 1. Elements
  // ==========================================
  // Step 1: Email Form Elements
  const form = document.getElementById('forgotPasswordForm');
  const formHeader = document.getElementById('forgotFormHeader');
  const emailInput = document.getElementById('forgot-email');
  const errorAlert = document.getElementById('forgotErrorAlert');
  const errorAlertText = document.getElementById('forgotErrorAlertText');
  const submitButton = document.getElementById('btn-forgot-submit');
  const submitText = document.getElementById('btn-forgot-text');
  const submitIcon = document.getElementById('btn-forgot-icon');
  const navLinks = document.getElementById('forgotNavLinks');
  const recaptchaContainerId = 'forgotRecaptcha';

  // Step 2: Verification Code & Reset Form Elements
  const confirmationCard = document.getElementById('forgotConfirmationCard');
  const confirmedEmailText = document.getElementById('confirmedEmailText');
  const resetForm = document.getElementById('resetPasswordForm');
  const resetErrorAlert = document.getElementById('resetErrorAlert');
  const resetErrorAlertText = document.getElementById('resetErrorAlertText');
  const resetSubmitBtn = document.getElementById('btn-reset-submit');
  const resetSubmitText = document.getElementById('btn-reset-text');
  const resetSubmitIcon = document.getElementById('btn-reset-icon');
  const newPasswordInput = document.getElementById('new-password');
  const confirmPasswordInput = document.getElementById('confirm-new-password');
  const resendBtn = document.getElementById('btn-resend-code');
  const resendCountdown = document.getElementById('resendCountdown');
  const sendAnotherBtn = document.getElementById('btn-send-another');
  const devBanner = document.getElementById('forgotDevBanner');
  const devOtpDisplay = document.getElementById('forgotDevOtpDisplay');
  const otpInputs = document.querySelectorAll('.otp-digit');

  // Step 3: Success Card
  const successCard = document.getElementById('forgotSuccessCard');

  let currentEmail = '';
  let resendTimer = null;

  // Strict email regex matching RFC-compliant institutional format
  const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9]+([.-][a-zA-Z0-9]+)*\.[a-zA-Z]{2,}$/;

  // ==========================================
  // 2. reCAPTCHA Bootstrap
  // ==========================================
  const captcha = {
    enabled: false,
    ready: false,
    widgetId: null,
    siteKey: ''
  };

  /** Returns the solved token or empty string if disabled/unsolved */
  function getCaptchaToken() {
    if (!captcha.enabled || !captcha.ready || !window.grecaptcha || captcha.widgetId === null) {
      return '';
    }
    return window.grecaptcha.getResponse(captcha.widgetId) || '';
  }

  /** Clears the solved token for clean resubmission */
  function resetCaptcha() {
    if (captcha.ready && window.grecaptcha && captcha.widgetId !== null) {
      try {
        window.grecaptcha.reset(captcha.widgetId);
      } catch (err) {
        console.warn('[reCAPTCHA] Reset failed:', err);
      }
    }
  }

  /** Display placeholder notice inside captcha container */
  function renderCaptchaNotice(container, text, isError) {
    if (!container) return;
    container.innerHTML =
      '<div class="w-full text-center text-[11px] rounded border px-3 py-2 ' +
      (isError
        ? 'border-[#f3c9c6] bg-[#fdf4f3] text-[#93000a]'
        : 'border-[#dcc0c0] bg-[#f8f9fb] text-[#564242]') +
      '">' + text + '</div>';
  }

  /**
   * Initializes reCAPTCHA dynamically by querying GET api/config.
   */
  function initCaptcha() {
    const container = document.getElementById(recaptchaContainerId);
    if (!container) return;

    fetch(BASE_URI + 'api/config', { credentials: 'same-origin' })
      .then(res => res.json())
      .then(json => {
        const cfg = (json && json.data) ? json.data : (json || {});
        if (!cfg.recaptcha_enabled || !cfg.recaptcha_site_key) {
          captcha.enabled = false;
          return;
        }

        captcha.enabled = true;
        captcha.siteKey = cfg.recaptcha_site_key;
        renderCaptchaNotice(container, 'Loading verification…', false);

        const mountWidget = () => {
          container.innerHTML = '';
          try {
            if (captcha.widgetId === null && window.grecaptcha && typeof window.grecaptcha.render === 'function') {
              captcha.widgetId = window.grecaptcha.render(recaptchaContainerId, {
                sitekey: cfg.recaptcha_site_key
              });
              captcha.ready = true;
            }
          } catch (err) {
            console.error('[reCAPTCHA] render failed:', err);
            renderCaptchaNotice(container, 'Verification could not load. Please check your connection.', true);
          }
        };

        if (window.grecaptcha && typeof window.grecaptcha.render === 'function') {
          mountWidget();
          return;
        }

        const existingScript = document.querySelector('script[src*="recaptcha/api.js"]');
        if (existingScript) {
          const pollInterval = setInterval(() => {
            if (window.grecaptcha && typeof window.grecaptcha.render === 'function') {
              clearInterval(pollInterval);
              mountWidget();
            }
          }, 100);
          setTimeout(() => clearInterval(pollInterval), 8000);
          return;
        }

        const callbackName = 'onCampusRoomForgotCaptchaLoad';
        window[callbackName] = () => {
          mountWidget();
          try {
            delete window[callbackName];
          } catch (e) {
            window[callbackName] = undefined;
          }
        };

        const script = document.createElement('script');
        script.src = `https://www.google.com/recaptcha/api.js?onload=${callbackName}&render=explicit`;
        script.async = true;
        script.defer = true;
        script.onerror = () => {
          renderCaptchaNotice(container, 'Could not reach Google verification service. You may be offline.', true);
        };
        document.head.appendChild(script);

        setTimeout(() => {
          if (!captcha.ready && container && !container.querySelector('iframe')) {
            renderCaptchaNotice(container, 'Verification took too long to load. Try refreshing the page.', true);
          }
        }, 8000);
      })
      .catch(() => {
        captcha.enabled = false;
      });
  }

  initCaptcha();

  // ==========================================
  // 3. UI Helpers: Error, Loading & State Switching
  // ==========================================
  function showError(message) {
    if (errorAlert) {
      if (errorAlertText) {
        errorAlertText.textContent = message;
      }
      errorAlert.classList.remove('hidden');
      errorAlert.classList.add('flex');
    }
  }

  function hideError() {
    if (errorAlert) {
      errorAlert.classList.add('hidden');
      errorAlert.classList.remove('flex');
      if (errorAlertText) {
        errorAlertText.textContent = '';
      }
    }
  }

  function showResetError(message) {
    if (resetErrorAlert) {
      if (resetErrorAlertText) {
        resetErrorAlertText.textContent = message;
      }
      resetErrorAlert.classList.remove('hidden');
      resetErrorAlert.classList.add('flex');
    }
  }

  function hideResetError() {
    if (resetErrorAlert) {
      resetErrorAlert.classList.add('hidden');
      resetErrorAlert.classList.remove('flex');
      if (resetErrorAlertText) {
        resetErrorAlertText.textContent = '';
      }
    }
  }

  function setLoadingState(isLoading) {
    if (!submitButton) return;
    submitButton.disabled = isLoading;

    if (isLoading) {
      if (submitText) submitText.textContent = 'Sending Code...';
      if (submitIcon) {
        submitIcon.textContent = 'progress_activity';
        submitIcon.classList.add('animate-spin');
      }
      submitButton.classList.add('opacity-80', 'cursor-not-allowed');
    } else {
      if (submitText) submitText.textContent = 'Send Reset Instructions';
      if (submitIcon) {
        submitIcon.textContent = 'arrow_forward';
        submitIcon.classList.remove('animate-spin');
      }
      submitButton.classList.remove('opacity-80', 'cursor-not-allowed');
    }
  }

  function setResetLoadingState(isLoading) {
    if (!resetSubmitBtn) return;
    resetSubmitBtn.disabled = isLoading;

    if (isLoading) {
      if (resetSubmitText) resetSubmitText.textContent = 'Updating Password...';
      if (resetSubmitIcon) {
        resetSubmitIcon.textContent = 'progress_activity';
        resetSubmitIcon.classList.add('animate-spin');
      }
      resetSubmitBtn.classList.add('opacity-80', 'cursor-not-allowed');
    } else {
      if (resetSubmitText) resetSubmitText.textContent = 'Reset Password & Sign In';
      if (resetSubmitIcon) {
        resetSubmitIcon.textContent = 'check_circle';
        resetSubmitIcon.classList.remove('animate-spin');
      }
      resetSubmitBtn.classList.remove('opacity-80', 'cursor-not-allowed');
    }
  }

  function showConfirmationState(submittedEmail, devOtp) {
    setLoadingState(false);
    hideError();
    hideResetError();

    currentEmail = submittedEmail;

    if (confirmedEmailText) {
      confirmedEmailText.textContent = submittedEmail;
    }

    if (devOtp && devBanner && devOtpDisplay) {
      devOtpDisplay.textContent = devOtp;
      devBanner.classList.remove('hidden');
    } else if (devBanner) {
      devBanner.classList.add('hidden');
    }

    if (form) form.classList.add('hidden');
    if (formHeader) formHeader.classList.add('hidden');
    if (navLinks) navLinks.classList.add('hidden');

    if (confirmationCard) {
      confirmationCard.classList.remove('hidden');
      confirmationCard.classList.add('flex');
    }

    // Auto-focus first digit box
    const firstOtp = document.getElementById('otp0');
    if (firstOtp) {
      setTimeout(() => firstOtp.focus(), 100);
    }
  }

  function showSuccessState() {
    if (confirmationCard) {
      confirmationCard.classList.add('hidden');
      confirmationCard.classList.remove('flex');
    }
    if (successCard) {
      successCard.classList.remove('hidden');
      successCard.classList.add('flex');
    }
  }

  function resetToFormView() {
    if (confirmationCard) {
      confirmationCard.classList.add('hidden');
      confirmationCard.classList.remove('flex');
    }
    if (successCard) {
      successCard.classList.add('hidden');
      successCard.classList.remove('flex');
    }

    if (formHeader) formHeader.classList.remove('hidden');
    if (form) form.classList.remove('hidden');
    if (navLinks) navLinks.classList.remove('hidden');

    clearOtpInputs();
    if (newPasswordInput) newPasswordInput.value = '';
    if (confirmPasswordInput) confirmPasswordInput.value = '';

    hideError();
    hideResetError();
    resetCaptcha();
    setLoadingState(false);
    setResetLoadingState(false);

    if (emailInput) {
      emailInput.focus();
    }
  }

  // ==========================================
  // 4. 6-Digit OTP Box Interactivity
  // ==========================================
  function getOtpValue() {
    return Array.from(otpInputs).map(inp => inp.value).join('');
  }

  function clearOtpInputs() {
    otpInputs.forEach(inp => { inp.value = ''; });
  }

  otpInputs.forEach((inp, idx) => {
    // Numeric input only + auto-advance
    inp.addEventListener('input', () => {
      const val = inp.value.replace(/[^0-9]/g, '');
      inp.value = val ? val[val.length - 1] : '';
      if (val && idx < otpInputs.length - 1) {
        otpInputs[idx + 1].focus();
      }
      hideResetError();
    });

    // Backspace navigation
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !inp.value && idx > 0) {
        otpInputs[idx - 1].focus();
        otpInputs[idx - 1].value = '';
      }
    });

    // Paste handling (supports pasting 6 digits directly)
    inp.addEventListener('paste', (e) => {
      const pasteText = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
      if (pasteText.length >= 6) {
        e.preventDefault();
        for (let j = 0; j < 6; j++) {
          if (otpInputs[j]) {
            otpInputs[j].value = pasteText[j] || '';
          }
        }
        if (otpInputs[5]) otpInputs[5].focus();
        hideResetError();
      }
    });
  });

  // Password Visibility Eye Toggle
  document.querySelectorAll('.toggle-password-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      const icon = btn.querySelector('.material-symbols-outlined');
      if (input && icon) {
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        icon.textContent = isPassword ? 'visibility' : 'visibility_off';
      }
    });
  });

  // ==========================================
  // 5. Step 1: Request OTP Submission
  // ==========================================
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideError();

      const email = (emailInput ? emailInput.value : '').trim();

      if (!email) {
        showError('Please enter your email address.');
        if (emailInput) emailInput.focus();
        return;
      }

      if (email.length > 255 || !EMAIL_REGEX.test(email)) {
        showError('Please enter a valid email address (e.g. name@gmail.com or id@bpu.edu.ph).');
        if (emailInput) emailInput.focus();
        return;
      }

      const token = getCaptchaToken();
      if (captcha.enabled && captcha.ready && !token) {
        showError('Please confirm you are not a robot before submitting.');
        return;
      }

      setLoadingState(true);

      try {
        const response = await fetch(BASE_URI + 'api/auth/forgot-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          credentials: 'same-origin',
          body: JSON.stringify({
            email: email,
            recaptcha_token: token
          })
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok) {
          const payload = data.data || data;
          sessionStorage.setItem('otp_email', email);
          if (payload.dev_otp) {
            sessionStorage.setItem('dev_otp', payload.dev_otp);
            console.info('[CampusRoom/Auth] Dev Mode OTP:', payload.dev_otp);
          }
          showConfirmationState(email, payload.dev_otp);
        } else {
          resetCaptcha();
          setLoadingState(false);
          const errorMsg = data.error || (data.data && data.data.error) || 'Failed to submit recovery request. Please try again.';
          showError(errorMsg);
        }
      } catch (networkError) {
        console.warn('[forgot-password] API unreachable:', networkError);
        showError('Network error. Please verify your connection.');
        setLoadingState(false);
      }
    });
  }

  // ==========================================
  // 6. Step 2: Verification Code & Reset Password
  // ==========================================
  if (resetForm) {
    resetForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideResetError();

      const otp = getOtpValue();
      const newPassword = newPasswordInput ? newPasswordInput.value : '';
      const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value : '';

      if (otp.length !== 6) {
        showResetError('Please enter the full 6-digit verification code sent to your email.');
        return;
      }

      if (!newPassword || newPassword.length < 8) {
        showResetError('Password must be at least 8 characters.');
        if (newPasswordInput) newPasswordInput.focus();
        return;
      }

      if (newPassword !== confirmPassword) {
        showResetError('Passwords do not match. Please re-enter.');
        if (confirmPasswordInput) confirmPasswordInput.focus();
        return;
      }

      setResetLoadingState(true);

      try {
        const response = await fetch(BASE_URI + 'api/auth/reset-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          credentials: 'same-origin',
          body: JSON.stringify({
            email: currentEmail,
            otp: otp,
            password: newPassword
          })
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok) {
          sessionStorage.removeItem('otp_email');
          sessionStorage.removeItem('dev_otp');
          showSuccessState();
        } else {
          setResetLoadingState(false);
          const errorMsg = data.error || (data.data && data.data.error) || 'Password reset failed. Please check the code and try again.';
          showResetError(errorMsg);
        }
      } catch (err) {
        setResetLoadingState(false);
        showResetError('Network error. Please try again later.');
      }
    });
  }

  // Resend Code handler
  if (resendBtn) {
    resendBtn.addEventListener('click', async () => {
      if (resendBtn.disabled) return;
      resendBtn.disabled = true;

      try {
        const response = await fetch(BASE_URI + 'api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ email: currentEmail })
        });
        const data = await response.json().catch(() => ({}));
        const payload = data.data || data;
        if (payload.dev_otp && devBanner && devOtpDisplay) {
          devOtpDisplay.textContent = payload.dev_otp;
          devBanner.classList.remove('hidden');
        }

        // 30-second countdown
        let count = 30;
        resendCountdown.textContent = `(${count}s)`;
        if (resendTimer) clearInterval(resendTimer);
        resendTimer = setInterval(() => {
          count--;
          if (count > 0) {
            resendCountdown.textContent = `(${count}s)`;
          } else {
            clearInterval(resendTimer);
            resendCountdown.textContent = '';
            resendBtn.disabled = false;
          }
        }, 1000);
      } catch (err) {
        resendBtn.disabled = false;
        resendCountdown.textContent = '';
      }
    });
  }

  // "Change email" button on Step 2
  if (sendAnotherBtn) {
    sendAnotherBtn.addEventListener('click', () => {
      resetToFormView();
    });
  }
});
