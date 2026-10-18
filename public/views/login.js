/** Sign-in / sign-up screen. */

import {
  el,
  createField,
  clearFieldErrors,
  applyServerFieldErrors,
  busy
} from '../dom.js';
import { api, ApiError } from '../api.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function renderLogin(ctx) {
  const params = new URLSearchParams(window.location.search);
  const nextParam = params.get('next');
  const nextPath =
    nextParam && nextParam.startsWith('/') && !nextParam.startsWith('/login') ? nextParam : '/';
  const sessionExpired = params.get('expired') === '1';

  let mode = params.get('mode') === 'signup' ? 'signup' : 'signin';
  let pending = false;

  const card = el('div', { class: 'auth__card' });
  const section = el('section', { class: 'auth fade-in', 'aria-labelledby': 'auth-title' }, card);

  function paint() {
    const isSignup = mode === 'signup';

    const displayNameField = isSignup
      ? createField({
          label: 'Display name',
          name: 'displayName',
          inputId: 'login-display-name',
          autocomplete: 'name',
          placeholder: 'Marguerite Devos',
          required: true
        })
      : null;

    const emailField = createField({
      label: isSignup ? 'Email' : 'Email or username',
      name: 'email',
      inputId: 'login-email',
      type: 'email',
      autocomplete: 'username',
      placeholder: 'you@example.com',
      required: true
    });

    const passwordField = createField({
      label: 'Password',
      name: 'password',
      inputId: 'login-password',
      type: 'password',
      autocomplete: isSignup ? 'new-password' : 'current-password',
      placeholder: isSignup ? 'At least 8 characters' : 'Your password',
      required: true,
      reveal: true
    });

    const fields = [displayNameField, emailField, passwordField].filter(Boolean);

    const errorBox = el('div', { class: 'error-banner', role: 'alert', hidden: true });
    const statusLine = el('p', { class: 'form__status', role: 'status', 'aria-live': 'polite' });

    const submitButton = el(
      'button',
      { type: 'submit', class: 'btn btn--primary btn--block' },
      isSignup ? 'Create account' : 'Sign in'
    );

    function showError(message) {
      errorBox.replaceChildren(
        el('div', {}, el('strong', {}, 'Could not continue'), el('span', {}, message))
      );
      errorBox.hidden = false;
    }

    function validate() {
      clearFieldErrors(fields);
      errorBox.hidden = true;
      statusLine.textContent = '';
      let firstInvalid = null;

      if (displayNameField && displayNameField.value.trim().length < 2) {
        displayNameField.setError('Enter your display name (at least 2 characters).');
        firstInvalid = firstInvalid || displayNameField;
      }

      const email = emailField.value.trim();
      if (!email) {
        emailField.setError('Enter your email address.');
        firstInvalid = firstInvalid || emailField;
      } else if (!EMAIL_PATTERN.test(email)) {
        emailField.setError('Enter a valid email address, like you@example.com.');
        firstInvalid = firstInvalid || emailField;
      }

      if (!passwordField.value) {
        passwordField.setError('Enter your password.');
        firstInvalid = firstInvalid || passwordField;
      } else if (isSignup && passwordField.value.length < 8) {
        passwordField.setError('Use at least 8 characters.');
        firstInvalid = firstInvalid || passwordField;
      }

      if (firstInvalid) {
        firstInvalid.focus();
        return false;
      }
      return true;
    }

    async function submit() {
      if (pending) return;
      if (!validate()) return;
      pending = true;
      busy(submitButton, true, isSignup ? 'Creating account…' : 'Signing in…');
      statusLine.textContent = isSignup ? 'Creating your account…' : 'Signing in…';

      try {
        const payload = isSignup
          ? {
              displayName: displayNameField.value.trim(),
              email: emailField.value.trim(),
              password: passwordField.value
            }
          : { email: emailField.value.trim(), password: passwordField.value };

        const result = isSignup ? await api.register(payload) : await api.login(payload);
        ctx.setUser(result.user);
        ctx.navigate(nextPath, { replace: true });
      } catch (error) {
        statusLine.textContent = '';
        if (error instanceof ApiError && error.fields) {
          applyServerFieldErrors(fields, error.fields);
          const firstWithError = fields.find((field) => field.input.getAttribute('aria-invalid') === 'true');
          if (firstWithError) firstWithError.focus();
        }
        showError(
          error instanceof ApiError
            ? error.message
            : 'Something went wrong while signing in. Please try again.'
        );
      } finally {
        pending = false;
        busy(submitButton, false);
      }
    }

    const demoHint = el(
      'div',
      { class: 'demo-hint' },
      el(
        'div',
        { class: 'demo-hint__row' },
        el('span', { class: 'mono-label' }, 'Demo account'),
        el('code', {}, 'cenius@cenius.ai / cenius')
      ),
      el(
        'div',
        { class: 'demo-hint__row' },
        el('span', {}, 'Seeded tower coordinator with the full rota.'),
        el(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost btn--sm',
            onclick: () => {
              emailField.value = 'cenius@cenius.ai';
              passwordField.value = 'cenius';
              submit();
            }
          },
          'Use demo account'
        )
      )
    );

    const form = el(
      'form',
      {
        class: 'form',
        novalidate: true,
        onsubmit: (event) => {
          event.preventDefault();
          submit();
        }
      },
      displayNameField ? displayNameField.wrapper : null,
      emailField.wrapper,
      passwordField.wrapper,
      errorBox,
      el('div', { class: 'form__actions' }, submitButton),
      statusLine
    );

    const switchLine = el(
      'p',
      { class: 'auth__switch' },
      isSignup ? 'Already have an account? ' : 'New to the tower? ',
      el(
        'button',
        {
          type: 'button',
          class: 'link-button',
          onclick: () => {
            mode = isSignup ? 'signin' : 'signup';
            paint();
            const first = card.querySelector('input');
            if (first) first.focus();
          }
        },
        isSignup ? 'Sign in instead' : 'Create an account'
      )
    );

    card.replaceChildren(
      el(
        'div',
        { class: 'auth__head' },
        el('span', { class: 'mono-label' }, 'carillon-rota'),
        el('h1', { class: 'auth__title', id: 'auth-title' }, isSignup ? 'Join the rota' : 'Sign in to the tower'),
        el(
          'p',
          { class: 'auth__sub' },
          isSignup
            ? 'Create an account to claim Sunday recitals and tower practice slots.'
            : 'Sunday recitals, clavier practice slots and programme credits in one place.'
        )
      ),
      sessionExpired && !isSignup
        ? el(
            'div',
            { class: 'error-banner', role: 'status' },
            el('div', {}, el('strong', {}, 'Session ended'), el('span', {}, 'Your session expired. Sign in again to pick up where you left off.'))
          )
        : null,
      demoHint,
      form,
      switchLine
    );

    const firstInput = card.querySelector('input');
    if (firstInput && !sessionExpired) firstInput.focus();
  }

  paint();
  return section;
}
