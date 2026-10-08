/**
 * CampusRoom — Authentication & Account Registration Logic
 * Handles user sign in, registration validation, and password strength checks.
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const BASE_URI = window.location.pathname.replace(/[^\/]*$/, '');

  // ==========================================
  // 0. reCAPTCHA bootstrap
  //
  // The site key comes from GET /api/config rather than being hardcoded here,
  // so .env stays the single source for it. When the server reports it
  // disabled — which is how the test suites and an unconfigured clone run —
  // nothing is loaded and every form behaves exactly as it did before.
  // ==========================================
  const captcha = {
    enabled: false,
    ready: false,
    widgets: {}   // containerId -> widget id, for precise reset()
  };

  /** The solved token for a container, or '' when reCAPTCHA is off. */
  function captchaToken(containerId) {
    if (!captcha.ready || !window.grecaptcha) return '';
    const id = captcha.widgets[containerId];
    return id === undefined ? '' : (window.grecaptcha.getResponse(id) || '');
  }

  /**
   * Clear a solved checkbox. A token is single-use, so any rejected submit
   * must reset it — otherwise the next attempt fails on a stale token and the
   * user is told "verification failed" when they have fixed the real problem.
   */
  function captchaReset(containerId) {
    if (!captcha.ready || !window.grecaptcha) return;
    const id = captcha.widgets[containerId];
    if (id !== undefined) window.grecaptcha.reset(id);
  }

  /** A visible placeholder, so the space is never silently blank. */
  function captchaNotice(el, text, isError) {
    el.innerHTML =
      '<div class="w-full text-center text-[11px] rounded border px-2 py-2 ' +
      (isError
        ? 'border-[#f3c9c6] bg-[#fdf4f3] text-[#93000a]'
        : 'border-outline-variant/50 bg-surface-container-low text-on-surface-variant') +
      '">' + text + '</div>';
  }

  const DEFAULT_RECAPTCHA_SITE_KEY = '6LenfsUtAAAAAJMakfoU3JfbkJk0s5950zLy2GdY';

  function initCaptcha(containerIds) {
    const present = containerIds.filter(id => document.getElementById(id));
    if (!present.length) return;

    const startCaptcha = (cfg) => {
      if (!cfg.recaptcha_enabled || !cfg.recaptcha_site_key) return;

      captcha.enabled = true;
      present.forEach(id => captchaNotice(document.getElementById(id), 'Loading verification…', false));

      const mountWidgets = () => {
        present.forEach(id => {
          const el = document.getElementById(id);
          if (!el) return;
          el.innerHTML = '';                       // clear the placeholder
          try {
            if (captcha.widgets[id] === undefined && window.grecaptcha && typeof window.grecaptcha.render === 'function') {
              captcha.widgets[id] = window.grecaptcha.render(id, { sitekey: cfg.recaptcha_site_key });
            }
          } catch (err) {
            console.error('[captcha] render failed for #' + id, err);
            captchaNotice(el, 'Verification could not load. Check that this site’s domain is registered for the reCAPTCHA key.', true);
          }
        });
        captcha.ready = true;
      };

      if (window.grecaptcha && typeof window.grecaptcha.render === 'function') {
        mountWidgets();
        return;
      }

      window.onCampusRoomCaptchaLoad = mountWidgets;

      if (!document.querySelector('script[src*="recaptcha/api.js"]')) {
        const loadScript = (src, onFail) => {
          const script = document.createElement('script');
          script.src = src;
          script.async = true;
          script.defer = true;
          script.onerror = onFail;
          document.head.appendChild(script);
        };

        // Attempt google.com first, then fall back to recaptcha.net mirror (e.g. for QUIC protocol errors)
        loadScript(
          'https://www.google.com/recaptcha/api.js?onload=onCampusRoomCaptchaLoad&render=explicit',
          () => {
            console.warn('[captcha] Failed to load from google.com, trying recaptcha.net mirror...');
            loadScript(
              'https://www.recaptcha.net/recaptcha/api.js?onload=onCampusRoomCaptchaLoad&render=explicit',
              () => {
                present.forEach(id =>
                  captchaNotice(document.getElementById(id),
                    'Could not reach Google verification service. Check your connection or disable QUIC protocol.', true));
              }
            );
          }
        );
      } else {
        const poll = setInterval(() => {
          if (window.grecaptcha && typeof window.grecaptcha.render === 'function') {
            clearInterval(poll);
            mountWidgets();
          }
        }, 100);
        setTimeout(() => clearInterval(poll), 8000);
      }

      window.setTimeout(() => {
        if (captcha.ready) return;
        present.forEach(id => {
          const el = document.getElementById(id);
          if (el && !el.querySelector('iframe')) {
            captchaNotice(el, 'The robot check did not load. Try refreshing; if it persists, contact the facilities desk.', true);
          }
        });
      }, 8000);
    };

    fetch(BASE_URI + 'api/config', { credentials: 'same-origin' })
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(json => {
        const cfg = (json && json.data) || {};
        startCaptcha(cfg);
      })
      .catch((err) => {
        console.warn('[captcha] /api/config unavailable, falling back to default site key:', err);
        startCaptcha({
          recaptcha_enabled: true,
          recaptcha_site_key: DEFAULT_RECAPTCHA_SITE_KEY
        });
      });
  }

  initCaptcha(['loginRecaptcha', 'registerRecaptcha']);

  // ==========================================
  // 1. Sign In Page Logic
  // ==========================================
  const loginForm = document.getElementById('loginForm');
  const errorAlert = document.getElementById('authErrorAlert');
  const errorAlertText = document.getElementById('authErrorAlertText');

  // --- Password Visibility Toggle for Sign In ---
  const toggleBtn = document.getElementById('toggle-password');
  const passwordInput = document.getElementById('bpu-password');
  const toggleIcon = document.getElementById('toggle-password-icon');

  if (toggleBtn && passwordInput && toggleIcon) {
    toggleBtn.addEventListener('click', () => {
      const isPassword = passwordInput.type === 'password';
      passwordInput.type = isPassword ? 'text' : 'password';
      toggleIcon.textContent = isPassword ? 'visibility' : 'visibility_off';
      passwordInput.classList.toggle('tracking-widest', !isPassword);
    });
  }

  if (loginForm) {
    let loginSubmitting = false;
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      // A reCAPTCHA token is single-use; a double-submit reuses it and Google
      // rejects the second as "timeout-or-duplicate". Block the re-entry.
      if (loginSubmitting) return;
      const submitBtn = loginForm.querySelector('button[type="submit"]');
      const emailInput = document.getElementById('bpu-email');
      const passwordInput = document.getElementById('bpu-password');

      const email = (emailInput ? emailInput.value : '').trim();
      const password = (passwordInput ? passwordInput.value : '').trim();

      if (!email || !password) {
        showLoginError('Please enter both your university email address and password.');
        return;
      }

      if (email.length > 255) {
        showLoginError('Email address must be 255 characters or fewer.');
        return;
      }

      if (password.length > 72) {
        showLoginError('Password must be 72 characters or fewer.');
        return;
      }

      // Caught here so the user is told to tick the box before a round trip.
      if (captcha.enabled && captcha.ready && !captchaToken('loginRecaptcha')) {
        showLoginError('Please confirm you are not a robot.');
        return;
      }

      loginSubmitting = true;
      if (submitBtn) submitBtn.disabled = true;

      const BASE = window.location.pathname.replace(/[^\/]*$/, '');
      fetch(BASE + 'api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, recaptcha_token: captchaToken('loginRecaptcha') })
      })
      .then(res => res.json().then(json => ({ status: res.status, json })))
      .then(({ status, json }) => {
        const payload = json.data || {};
        if (status === 200) {
          hideLoginError();

          
          try {
            sessionStorage.setItem('campus_role', payload.role);
            localStorage.setItem('campus_role', payload.role);
          } catch (err) {
            console.warn('Unable to save the session role hint', err);
          }
          if (payload.role === 'Admin' || payload.role === 'Staff') {
            // Staff share the admin dashboard (admin-only tabs are hidden there).
            window.location.href = 'admin-governance.html';
          } else {
            window.location.href = 'dashboard.html';
          }
        } else if (status === 403 && payload.requires_verification) {
          sessionStorage.setItem('otp_email', payload.email);
          if (payload.dev_otp) sessionStorage.setItem('dev_otp', payload.dev_otp);
          window.location.href = 'verify.html';
        } else {
          // Single-use token: clear it so a retry starts from a fresh tick.
          loginSubmitting = false;
          if (submitBtn) submitBtn.disabled = false;
          captchaReset('loginRecaptcha');
          const errorMsg = payload.error || json.error || 'Authentication failed: Invalid credentials provided.';
          showLoginError(errorMsg);
          const retryAfter = json.retry_after || payload.retry_after;
          const attempts = json.attempts || json.attempt_count || payload.attempts || payload.attempt_count;
          if (retryAfter && Number(retryAfter) > 0) {
            startLoginTimeout(Number(retryAfter), attempts);
          }
        }
      })
      .catch((err) => {
        loginSubmitting = false;
        if (submitBtn) submitBtn.disabled = false;
        captchaReset('loginRecaptcha');
        showLoginError('Network error. Please try again later.');
      });
    });

    let loginCooldownTimer = null;
    function startLoginTimeout(seconds, attempts) {
      const submitBtn = loginForm ? loginForm.querySelector('button[type="submit"]') : null;
      if (!submitBtn) return;
      if (loginCooldownTimer) clearInterval(loginCooldownTimer);

      let remaining = seconds;
      submitBtn.disabled = true;
      submitBtn.classList.add('opacity-70', 'cursor-not-allowed');

      const originalHtml = submitBtn.innerHTML;

      const updateButton = () => {
        submitBtn.innerHTML = `<span>Try again in ${remaining}s</span>`;
      };
      updateButton();

      loginCooldownTimer = setInterval(() => {
        remaining--;
        if (remaining > 0) {
          updateButton();
          if (errorAlertText) {
            errorAlertText.textContent = `Too many failed attempts. Please wait ${remaining}s before trying again.`;
          }
        } else {
          clearInterval(loginCooldownTimer);
          loginCooldownTimer = null;
          submitBtn.disabled = false;
          submitBtn.classList.remove('opacity-70', 'cursor-not-allowed');
          submitBtn.innerHTML = originalHtml;
        }
      }, 1000);
    }

    function showLoginError(msg) {
      if (errorAlert) {
        if (errorAlertText) errorAlertText.textContent = msg;
        errorAlert.classList.remove('hidden');
        errorAlert.classList.add('flex');
      }
    }

    function hideLoginError() {
      if (errorAlert) {
        errorAlert.classList.add('hidden');
        errorAlert.classList.remove('flex');
      }
    }

  }

  // ==========================================
  // 2. Registration Page Logic
  // ==========================================
  const registerForm = document.getElementById('registerForm');
  if (registerForm && document.getElementById('fullName')) {
    const fullNameInput = document.getElementById('fullName');
    const emailInput = document.getElementById('univEmail');
    const departmentSelect = document.getElementById('department');
    const idNumberInput = document.getElementById('idNumber');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirmPassword');
    const togglePasswordBtn = document.getElementById('togglePasswordBtn');
    const passwordBars = document.querySelectorAll('.pwd-strength-bar');
    const passwordScoreLabel = document.getElementById('passwordStrengthLabel');
    const passwordMatchBadge = document.getElementById('passwordMatchBadge');
    const registerAlert = document.getElementById('registerAlert');
    const registerAlertText = document.getElementById('registerAlertText');

    // Toggle Password Visibility
    if (togglePasswordBtn && passwordInput) {
      togglePasswordBtn.addEventListener('click', () => {
        const isPassword = passwordInput.type === 'password';
        passwordInput.type = isPassword ? 'text' : 'password';
        const icon = togglePasswordBtn.querySelector('.material-symbols-outlined');
        if (icon) {
          icon.textContent = isPassword ? 'visibility_off' : 'visibility';
        }
      });
    }

    // Password Strength Meter
    if (passwordInput) {
      passwordInput.addEventListener('input', () => {
        const val = passwordInput.value;
        let score = 0;
        if (val.length >= 8) score++;
        if (val.length >= 12) score++;
        if (/[A-Z]/.test(val) && /[a-z]/.test(val)) score++;
        if (/[0-9]/.test(val) && /[^A-Za-z0-9]/.test(val)) score++;

        if (passwordBars.length === 4) {
          passwordBars.forEach((bar, i) => {
            if (i < score) {
              bar.className = 'h-1.5 rounded-full bg-secondary-container pwd-strength-bar';
            } else {
              bar.className = 'h-1.5 rounded-full bg-surface-container-high pwd-strength-bar';
            }
          });
        }

        if (passwordScoreLabel) {
          const labels = ['Weak (1/4)', 'Fair (2/4)', 'Good (3/4)', 'Strong (4/4)'];
          passwordScoreLabel.textContent = score > 0 ? labels[score - 1] : 'Too Weak (0/4)';
        }

        checkPasswordMatch();
      });
    }

    // Confirm Password Match Check
    function checkPasswordMatch() {
      if (!confirmPasswordInput || !passwordInput || !passwordMatchBadge) return;
      const match = passwordInput.value.length > 0 && passwordInput.value === confirmPasswordInput.value;
      if (match) {
        passwordMatchBadge.innerHTML = '<span class="material-symbols-outlined text-[13px] text-secondary">check_circle</span> Passwords match';
        passwordMatchBadge.classList.remove('bg-error-container', 'text-error');
        passwordMatchBadge.classList.add('bg-secondary-fixed/30', 'text-secondary');
      } else if (confirmPasswordInput.value.length > 0) {
        passwordMatchBadge.innerHTML = '<span class="material-symbols-outlined text-[13px] text-error">cancel</span> Do not match';
        passwordMatchBadge.classList.remove('bg-secondary-fixed/30', 'text-secondary');
        passwordMatchBadge.classList.add('bg-error-container', 'text-error');
      }
    }

    if (confirmPasswordInput) {
      confirmPasswordInput.addEventListener('input', checkPasswordMatch);
    }

    // Form Submission
    registerForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const fullName = fullNameInput ? fullNameInput.value.trim() : '';
      const email = emailInput ? emailInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';
      const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value : '';

      if (password !== confirmPassword) {
        showRegisterError('Password and confirmation password do not match.');
        return;
      }

      if (captcha.enabled && captcha.ready && !captchaToken('registerRecaptcha')) {
        showRegisterError('Please confirm you are not a robot.');
        return;
      }

      const BASE = window.location.pathname.replace(/[^\/]*$/, '');
      fetch(BASE + 'api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fullName, email, password,
          recaptcha_token: captchaToken('registerRecaptcha')
        })
      })
      .then(res => res.json().then(json => ({ status: res.status, json })))
      .then(({ status, json }) => {
        // Response::json() nests the payload under `data`; errors are top-level.
        const payload = json.data || {};
        if (status === 201) {
          sessionStorage.setItem('otp_email', payload.email || email);
          if (payload.dev_otp) {
            sessionStorage.setItem('dev_otp', payload.dev_otp);
          }
          window.location.href = 'verify.html';
        } else {
          captchaReset('registerRecaptcha');
          showRegisterError(json.error || 'An error occurred during account registration.');
        }
      })
      .catch(err => {
        showRegisterError('Network error. Please try again later.');
      });
    });

    function showRegisterError(msg) {
      if (registerAlert) {
        if (registerAlertText) registerAlertText.textContent = msg;
        registerAlert.classList.remove('hidden');
        registerAlert.classList.add('flex');
      } else {
        alert(msg);
      }
    }
  }
});
