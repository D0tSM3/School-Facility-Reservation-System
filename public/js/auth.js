/**
 * CampusRoom — Authentication & Account Registration Logic
 * Handles user sign in, registration validation, and password strength checks.
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';



  // ==========================================
  // 1. Sign In Page Logic
  // ==========================================
  const loginForm = document.getElementById('loginForm');
  const errorAlert = document.getElementById('authErrorAlert');
  const errorAlertText = document.getElementById('authErrorAlertText');

  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const emailInput = document.getElementById('bpu-email');
      const passwordInput = document.getElementById('bpu-password');

      const email = (emailInput ? emailInput.value : '').trim();
      const password = (passwordInput ? passwordInput.value : '').trim();

      if (!email || !password) {
        showLoginError('Please enter both your university email address and password.');
        return;
      }

      const BASE = window.location.pathname.replace(/[^\/]*$/, '');
      fetch(BASE + 'api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })
      .then(res => res.json().then(json => ({ status: res.status, json })))
      .then(({ status, json }) => {
        const payload = json.data || {};
        if (status === 200) {
          hideLoginError();

          
          if (payload.role === 'Admin') {
            window.location.href = 'admin-governance.html';
          } else if (payload.role === 'Staff') {
            window.location.href = 'staff-queue.html';
          } else {
            window.location.href = 'dashboard.html';
          }
        } else if (status === 403 && payload.requires_verification) {
          sessionStorage.setItem('otp_email', payload.email);
          if (payload.dev_otp) sessionStorage.setItem('dev_otp', payload.dev_otp);
          window.location.href = 'verify.html';
        } else {
          showLoginError(payload.error || json.error || 'Authentication failed: Invalid credentials provided.');
        }
      })
      .catch((err) => {
        showLoginError('Network error. Please try again later.');
      });
    });

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

    // Quick Demo Sign-In Buttons (Customer & Staff)
    const demoCustomerBtn = document.getElementById('demoCustomerLogin');
    if (demoCustomerBtn) {
      demoCustomerBtn.addEventListener('click', () => {
        const emailInput = document.getElementById('bpu-email');
        const passwordInput = document.getElementById('bpu-password');
        if (emailInput) emailInput.value = 'customer@bpu.edu.ph';
        if (passwordInput) passwordInput.value = 'password123';
        loginForm.dispatchEvent(new Event('submit'));
      });
    }

    const demoStaffBtn = document.getElementById('demoStaffLogin');
    if (demoStaffBtn) {
      demoStaffBtn.addEventListener('click', () => {
        const emailInput = document.getElementById('bpu-email');
        const passwordInput = document.getElementById('bpu-password');
        if (emailInput) emailInput.value = 'staff@bpu.edu.ph';
        if (passwordInput) passwordInput.value = 'password123';
        loginForm.dispatchEvent(new Event('submit'));
      });
    }
  }

  // ==========================================
  // 2. Registration Page Logic
  // ==========================================
  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
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

      const BASE = window.location.pathname.replace(/[^\/]*$/, '');
      fetch(BASE + 'api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: fullName, email, password })
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
