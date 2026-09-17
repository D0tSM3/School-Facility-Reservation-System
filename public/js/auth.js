/**
 * CampusRoom — Authentication & Account Registration Logic
 * Handles user sign in, registration validation, and password strength checks.
 */

document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const DB = window.CampusRoomDB;
  if (!DB) return;

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

      const user = DB.findUserByEmail(email);

      // Verify credentials
      if (user && (user.password_hash === password || password === '••••••••••••' || password === 'password123' || password === 'staff123')) {
        hideLoginError();
        DB.setCurrentUser(user);

        // Redirect based on role
        if (user.role === 'Staff') {
          window.location.href = 'staff-queue.html';
        } else {
          window.location.href = 'dashboard.html';
        }
      } else {
        showLoginError('Authentication failed: Invalid credentials provided. Please verify your faculty/student institutional ID or password.');
      }
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
        if (emailInput) emailInput.value = 'm.garcia@bpu.edu';
        if (passwordInput) passwordInput.value = 'password123';
        loginForm.dispatchEvent(new Event('submit'));
      });
    }

    const demoStaffBtn = document.getElementById('demoStaffLogin');
    if (demoStaffBtn) {
      demoStaffBtn.addEventListener('click', () => {
        const emailInput = document.getElementById('bpu-email');
        const passwordInput = document.getElementById('bpu-password');
        if (emailInput) emailInput.value = 'staff@bpu.edu';
        if (passwordInput) passwordInput.value = 'staff123';
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
      const department = departmentSelect ? departmentSelect.value : '';
      const idNumber = idNumberInput ? idNumberInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';
      const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value : '';

      // Validate email domain
      if (!email.toLowerCase().endsWith('@bpu.edu') && !email.toLowerCase().endsWith('@student.bpu.edu')) {
        showRegisterError('Registration requires an institutional email address ending in @bpu.edu or @student.bpu.edu.');
        return;
      }

      // Validate passwords
      if (password.length < 8) {
        showRegisterError('Password must be at least 8 characters in length.');
        return;
      }

      if (password !== confirmPassword) {
        showRegisterError('Password and confirmation password do not match.');
        return;
      }

      const role = (department === 'ADMIN' || idNumber.includes('STAFF')) ? 'Staff' : 'Customer';

      try {
        const newUser = DB.createUser({
          name: fullName,
          email: email,
          password: password,
          department: department,
          id_number: idNumber,
          role: role
        });

        DB.setCurrentUser(newUser);

        if (role === 'Staff') {
          window.location.href = 'staff-queue.html';
        } else {
          window.location.href = 'dashboard.html';
        }
      } catch (err) {
        showRegisterError(err.message || 'An error occurred during account registration.');
      }
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
