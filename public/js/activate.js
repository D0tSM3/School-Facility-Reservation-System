document.addEventListener('DOMContentLoaded', () => {
  'use strict';

  const baseUri = window.location.pathname.replace(/[^/]*$/, '');
  const requestForm = document.getElementById('requestForm');
  const verifyForm = document.getElementById('verifyForm');
  const completeForm = document.getElementById('completeForm');
  const studentIdInput = document.getElementById('student-id');
  const otpInput = document.getElementById('activation-code');
  const passwordInput = document.getElementById('new-password');
  const confirmInput = document.getElementById('confirm-password');
  const usernameInput = document.getElementById('activation-username');
  const requestMessage = document.getElementById('requestMessage');
  const stage2Message = document.getElementById('stage2Message');
  const verifyMessage = document.getElementById('verifyMessage');
  const completeMessage = document.getElementById('completeMessage');
  const resendButton = document.getElementById('resendButton');
  const stages = {
    1: document.getElementById('activation-stage-1'),
    2: document.getElementById('activation-stage-2'),
    3: document.getElementById('activation-stage-3'),
  };

  let csrfToken = '';
  let busy = false;
  let resendRemaining = 60;
  let resendTimer = null;
  let captchaEnabled = false;
  let captchaScriptLoaded = false;
  let captchaWidgets = {};
  let captchaConfigPromise;
  let passwordMinimum = null;
  let rosterName = '';
  let confirmationTouched = false;
  let strengthTimer = null;

  const requestGeneric = 'If eligible, an activation code has been sent to the email address on the school roster.';
  const policyMessages = {
    too_short: () => `Use at least ${passwordMinimum} characters.`,
    too_long: () => 'Use 128 characters or fewer.',
    whitespace_edges: () => 'Remove spaces at the start or end.',
    contains_personal: () => "Don't include your name, student number or email.",
    repetitive: () => 'Avoid repeated or sequential characters.',
    common: () => 'That password is too common. Choose a less predictable one.',
    breached: () => 'This password has appeared in a data breach. Choose a different one.',
    mismatch: () => "The two passwords don't match.",
    invalid_input: () => 'Enter a valid password.',
  };

  function showStage(number) {
    Object.entries(stages).forEach(([key, section]) => {
      section.hidden = Number(key) !== number;
    });
    if (number === 1) mountCaptcha('activationRecaptcha');
    if (number === 2) mountCaptcha('resendRecaptcha');
  }

  function showMessage(element, text) {
    element.textContent = text;
    element.hidden = false;
    element.classList.remove('hidden');
  }

  function setBusy(value) {
    busy = value;
    document.querySelectorAll('button').forEach((button) => {
      button.disabled = busy;
    });
    updateResendButton();
  }

  async function getEnvelope(path, options = {}) {
    const response = await fetch(baseUri + path, {
      credentials: 'same-origin',
      ...options,
      headers: {
        ...(options.headers || {}),
      },
    });
    let json;
    try {
      json = await response.json();
    } catch {
      json = {};
    }
    return { response, json };
  }

  async function refreshCsrfToken() {
    const { response, json } = await getEnvelope('api/auth/csrf');
    if (!response.ok || !json.success || typeof json.data?.token !== 'string') {
      throw new Error('Unable to initialize activation security.');
    }
    csrfToken = json.data.token;
  }

  async function postJson(path, payload) {
    if (!csrfToken) await refreshCsrfToken();
    return getEnvelope(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      body: JSON.stringify(payload),
    });
  }

  async function loadCaptchaConfig() {
    const { response, json } = await getEnvelope('api/config');
    if (!response.ok || !json.success) return;
    const config = json.data || {};
    captchaEnabled = config.recaptcha_enabled === true && Boolean(config.recaptcha_site_key);
    if (!captchaEnabled) return;
    window.activationRecaptchaSiteKey = config.recaptcha_site_key;

    await new Promise((resolve, reject) => {
      window.onActivationCaptchaLoad = () => {
        captchaScriptLoaded = true;
        mountCaptcha('activationRecaptcha');
        mountCaptcha('resendRecaptcha');
        resolve();
      };
      const script = document.createElement('script');
      script.src = 'https://www.google.com/recaptcha/api.js?onload=onActivationCaptchaLoad&render=explicit';
      script.async = true;
      script.defer = true;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function mountCaptcha(containerId) {
    const container = document.getElementById(containerId);
    if (!container || !captchaEnabled || !captchaScriptLoaded || !window.grecaptcha
      || typeof window.activationRecaptchaSiteKey !== 'string'
      || container.closest('section')?.hidden
      || captchaWidgets[containerId] !== undefined) return;
    captchaWidgets[containerId] = window.grecaptcha.render(containerId, {
      sitekey: window.activationRecaptchaSiteKey,
    });
  }

  function captchaToken(containerId) {
    if (!captchaEnabled || !captchaScriptLoaded || !window.grecaptcha) return '';
    const widgetId = captchaWidgets[containerId];
    return widgetId === undefined ? '' : (window.grecaptcha.getResponse(widgetId) || '');
  }

  function resetCaptcha(containerId) {
    const widgetId = captchaWidgets[containerId];
    if (widgetId !== undefined && window.grecaptcha) window.grecaptcha.reset(widgetId);
  }

  async function activationRequest(captchaContainerId) {
    await captchaConfigPromise;
    const token = captchaToken(captchaContainerId);
    try {
      await postJson('api/auth/activate/request', {
        student_id: studentIdInput.value.trim(),
        recaptcha_token: token,
      });
    } catch {
      // Keep eligibility and delivery details indistinguishable in the UI.
    } finally {
      resetCaptcha(captchaContainerId);
    }
    showMessage(requestMessage, requestGeneric);
    stage2Message.textContent = requestGeneric;
    otpInput.value = '';
    showStage(2);
    startResendCountdown();
  }

  function startResendCountdown() {
    if (resendTimer) window.clearInterval(resendTimer);
    resendRemaining = 60;
    updateResendButton();
    resendTimer = window.setInterval(() => {
      resendRemaining -= 1;
      updateResendButton();
      if (resendRemaining <= 0) {
        window.clearInterval(resendTimer);
        resendTimer = null;
      }
    }, 1000);
  }

  function updateResendButton() {
    resendButton.disabled = busy || resendRemaining > 0;
    resendButton.textContent = resendRemaining > 0 ? `Resend in ${resendRemaining}s` : 'Resend code';
  }

  function clearPasswordFields() {
    passwordInput.value = '';
    confirmInput.value = '';
    confirmationTouched = false;
    clearFieldErrors();
    updatePasswordGuidance();
    updateStrength();
  }

  function setGuidance(id, valid, visible = true) {
    const item = document.getElementById(id);
    item.hidden = !visible;
    if (visible) {
      item.firstElementChild.textContent = valid ? '✓' : '○';
      item.classList.toggle('font-semibold', valid);
    }
  }

  function includesPersonalInformation(value) {
    const candidate = value.toLocaleLowerCase();
    const schoolId = studentIdInput.value.trim().toLocaleLowerCase();
    if (schoolId && candidate.includes(schoolId)) return true;
    const tokens = rosterName.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u);
    return tokens.some((token) => Array.from(token).length >= 4 && candidate.includes(token));
  }

  function updatePasswordGuidance() {
    const password = passwordInput.value;
    const validLength = passwordMinimum !== null && Array.from(password).length >= passwordMinimum;
    const validEdges = !(/^\s|\s$/u.test(password));
    const validPersonal = !includesPersonalInformation(password);
    const matches = password !== '' && password === confirmInput.value;
    setGuidance('check-length', validLength);
    setGuidance('check-whitespace', validEdges);
    setGuidance('check-personal', validPersonal);
    setGuidance('check-match', matches, confirmationTouched);
  }

  function updateStrength() {
    const length = Array.from(passwordInput.value).length;
    const label = document.getElementById('strength-label');
    const bar = document.getElementById('strength-bar');
    if (passwordMinimum === null || length < passwordMinimum) {
      label.textContent = 'Too short';
      bar.className = 'h-full w-1/3 bg-red-700';
    } else if (length < 20) {
      label.textContent = 'Okay';
      bar.className = 'h-full w-2/3 bg-yellow-600';
    } else {
      label.textContent = 'Strong';
      bar.className = 'h-full w-full bg-green-700';
    }
  }

  function scheduleStrengthUpdate() {
    if (strengthTimer) window.clearTimeout(strengthTimer);
    strengthTimer = window.setTimeout(updateStrength, 400);
  }

  function clearFieldErrors() {
    [
      [passwordInput, document.getElementById('password-error')],
      [confirmInput, document.getElementById('confirm-error')],
    ].forEach(([input, message]) => {
      input.removeAttribute('aria-invalid');
      message.textContent = '';
      message.hidden = true;
    });
    completeMessage.textContent = '';
    completeMessage.hidden = true;
  }

  function showPolicyErrors(codes, focusSummary = true) {
    clearFieldErrors();
    const passwordCodes = codes.filter((code) => code !== 'mismatch');
    const confirmationCodes = codes.filter((code) => code === 'mismatch');
    if (passwordCodes.length > 0) {
      passwordInput.setAttribute('aria-invalid', 'true');
      const message = document.getElementById('password-error');
      message.textContent = passwordCodes.map((code) => policyMessages[code]?.() || policyMessages.invalid_input()).join(' ');
      message.hidden = false;
    }
    if (confirmationCodes.length > 0) {
      confirmInput.setAttribute('aria-invalid', 'true');
      const message = document.getElementById('confirm-error');
      message.textContent = policyMessages.mismatch();
      message.hidden = false;
    }
    completeMessage.textContent = codes.map((code) => policyMessages[code]?.() || policyMessages.invalid_input()).join(' ');
    completeMessage.hidden = false;
    if (focusSummary) completeMessage.focus();
  }

  function checkClientPolicy(password, confirmation) {
    const codes = [];
    if (Array.from(password).length < passwordMinimum) codes.push('too_short');
    if (/^\s|\s$/u.test(password)) codes.push('whitespace_edges');
    if (includesPersonalInformation(password)) codes.push('contains_personal');
    if (password !== confirmation) codes.push('mismatch');
    return codes;
  }

  function handleCompleteResponse(json, status) {
    if (status === 401) {
      clearPasswordFields();
      requestMessage.hidden = true;
      showMessage(requestMessage, 'Your session expired. Please request a new activation code.');
      showStage(1);
      return;
    }
    if (status === 429) {
      completeMessage.textContent = 'Please wait before trying again.';
      completeMessage.hidden = false;
      completeMessage.focus();
      return;
    }
    if (status === 422) {
      const codes = Array.isArray(json.data?.codes) ? json.data.codes : ['invalid_input'];
      showPolicyErrors(codes);
      return;
    }
    completeMessage.textContent = 'Unable to complete activation. Please try again.';
    completeMessage.hidden = false;
    completeMessage.focus();
  }

  document.getElementById('toggle-passwords').addEventListener('click', (event) => {
    const button = event.currentTarget;
    const show = passwordInput.type === 'password';
    passwordInput.type = show ? 'text' : 'password';
    confirmInput.type = show ? 'text' : 'password';
    button.textContent = show ? 'Hide password' : 'Show password';
    button.setAttribute('aria-label', button.textContent);
    button.setAttribute('aria-pressed', String(show));
  });

  passwordInput.addEventListener('input', () => {
    clearFieldErrors();
    updatePasswordGuidance();
    scheduleStrengthUpdate();
  });
  confirmInput.addEventListener('input', () => {
    confirmationTouched = true;
    clearFieldErrors();
    updatePasswordGuidance();
    scheduleStrengthUpdate();
  });
  confirmInput.addEventListener('blur', () => {
    confirmationTouched = true;
    updatePasswordGuidance();
  });

  function loadPasswordContext(context) {
    const policy = context.policy || {};
    if (!Number.isInteger(policy.min_length) || !Number.isInteger(policy.max_length)) {
      throw new Error('Password policy limits missing from activation context.');
    }
    passwordMinimum = policy.min_length;
    rosterName = typeof context.name === 'string' ? context.name : '';
    usernameInput.value = studentIdInput.value.trim();
    document.getElementById('minimum-length').textContent = String(passwordMinimum);
    updatePasswordGuidance();
    updateStrength();
  }

  requestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await activationRequest('activationRecaptcha');
    } finally {
      setBusy(false);
    }
  });

  verifyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    verifyMessage.hidden = true;
    setBusy(true);
    try {
      const { response, json } = await postJson('api/auth/activate/verify', {
        student_id: studentIdInput.value.trim(),
        otp: otpInput.value,
      });
      if (!response.ok || !json.success) {
        showMessage(verifyMessage, 'Invalid or expired activation code. Please try again.');
        return;
      }
      otpInput.value = '';
      await refreshCsrfToken();
      const context = await getEnvelope('api/auth/activate/context');
      if (context.response.status === 401) {
        showMessage(requestMessage, 'Your session expired. Please request a new activation code.');
        showStage(1);
        return;
      }
      if (!context.response.ok || !context.json.success) {
        showMessage(verifyMessage, 'Unable to continue activation. Please try again.');
        return;
      }
      document.getElementById('welcomeMessage').textContent = `Welcome, ${context.json.data.name || ''}`;
      document.getElementById('activationEmail').textContent = context.json.data.email || '';
      loadPasswordContext(context.json.data);
      clearPasswordFields();
      showStage(3);
    } catch {
      showMessage(verifyMessage, 'Unable to verify the code right now. Please try again.');
    } finally {
      setBusy(false);
    }
  });

  resendButton.addEventListener('click', async () => {
    if (busy || resendRemaining > 0) return;
    setBusy(true);
    try {
      await activationRequest('resendRecaptcha');
      showStage(2);
    } finally {
      setBusy(false);
    }
  });

  document.getElementById('differentIdLink').addEventListener('click', (event) => {
    event.preventDefault();
    requestMessage.hidden = true;
    verifyMessage.hidden = true;
    studentIdInput.value = '';
    otpInput.value = '';
    showStage(1);
  });

  completeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    const codes = checkClientPolicy(passwordInput.value, confirmInput.value);
    if (codes.length > 0) {
      showPolicyErrors(codes);
      return;
    }

    setBusy(true);
    try {
      const { response, json } = await postJson('api/auth/activate/complete', {
        password: passwordInput.value,
        password_confirm: confirmInput.value,
      });
      if (!response.ok || !json.success) {
        handleCompleteResponse(json, response.status);
        return;
      }
      clearPasswordFields();
      window.location.assign(baseUri + 'index.html?activated=1');
    } catch {
      completeMessage.textContent = 'Unable to complete activation right now. Please try again.';
      completeMessage.hidden = false;
      completeMessage.focus();
    } finally {
      setBusy(false);
    }
  });

  captchaConfigPromise = loadCaptchaConfig().catch(() => {
    captchaEnabled = false;
  });
  refreshCsrfToken().catch(() => {
    showMessage(requestMessage, 'Unable to initialize activation. Please refresh and try again.');
  });
  updateResendButton();
});
