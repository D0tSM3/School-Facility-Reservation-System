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

  const requestGeneric = 'If eligible, an activation code has been sent to the email address on the school roster.';
  const errorMessages = {
    whitespace_edges: 'Do not use spaces at the beginning or end of your password.',
    password_required: 'Enter a password.',
    password_policy: 'Choose a password that meets the password requirements.',
    already_activated: 'This school account has already been activated.',
    activation_failed: 'Activation could not be completed. Please try again.',
  };
  const passwordPolicyMessages = {
    'Password must be valid UTF-8.': 'Use a password containing valid text characters.',
    'Password must be between 12 and 128 characters.': 'Use between 12 and 128 characters.',
    'Choose a less common password.': 'This password is too common. Choose a different one.',
    'This password appears in known data breaches. Choose another password.':
      'This password appears in known breach data. Choose a different one.',
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
    updatePasswordChecklist();
  }

  function updatePasswordChecklist() {
    const password = passwordInput.value;
    const confirmation = confirmInput.value;
    const lengthOkay = [...password].length >= 12 && [...password].length <= 128;
    const matches = password !== '' && password === confirmation;
    const whitespaceOkay = password === password.trim();
    [
      ['check-length', lengthOkay],
      ['check-match', matches],
      ['check-whitespace', whitespaceOkay],
    ].forEach(([id, okay]) => {
      const item = document.getElementById(id);
      item.classList.toggle('text-green-700', okay);
      item.classList.toggle('text-gray-500', !okay);
    });
  }

  function showCompleteError(json, status) {
    if (status === 401) {
      clearPasswordFields();
      requestMessage.hidden = true;
      showMessage(requestMessage, 'Your session expired. Please request a new activation code.');
      showStage(1);
      return;
    }
    const code = json.data && typeof json.data.code === 'string' ? json.data.code : '';
    const message = code === 'password_policy'
      ? (passwordPolicyMessages[json.error] || errorMessages.password_policy)
      : errorMessages[code];
    showMessage(completeMessage, message || 'Unable to complete activation. Check your details and try again.');
    clearPasswordFields();
  }

  document.querySelectorAll('[data-toggle-password]').forEach((button) => {
    button.addEventListener('click', () => {
      const input = document.getElementById(button.dataset.togglePassword);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      button.textContent = show ? 'Hide' : 'Show';
      button.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
  });

  [passwordInput, confirmInput].forEach((input) => {
    input.addEventListener('input', updatePasswordChecklist);
  });

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
      completeMessage.hidden = true;
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
      startResendCountdown();
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
    completeMessage.hidden = true;
    const password = passwordInput.value;
    const confirmation = confirmInput.value;
    if ([...password].length < 12 || [...password].length > 128 || password !== confirmation
      || password !== password.trim()) {
      showMessage(completeMessage, password !== password.trim()
        ? errorMessages.whitespace_edges
        : 'Check the password requirements and confirmation.');
      clearPasswordFields();
      return;
    }

    setBusy(true);
    try {
      const { response, json } = await postJson('api/auth/activate/complete', { password });
      if (!response.ok || !json.success) {
        showCompleteError(json, response.status);
        return;
      }
      clearPasswordFields();
      window.location.assign(baseUri + 'index.html?activated=1');
    } catch {
      clearPasswordFields();
      showMessage(completeMessage, 'Unable to complete activation right now. Please try again.');
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
  updatePasswordChecklist();
  updateResendButton();
});
