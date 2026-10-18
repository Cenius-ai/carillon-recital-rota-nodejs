/** Shared mutation helpers: busy-guarded actions and inline confirmations. */

import { el, toast } from './dom.js';
import { ApiError } from './api.js';

export function makeRunner(ctx) {
  return async function runAction(button, busyLabel, action, successMessage) {
    if (button.dataset.busy === 'true') return false;
    button.dataset.busy = 'true';
    button.disabled = true;
    const previousLabel = button.textContent;
    button.textContent = busyLabel;

    try {
      await action();
      toast(successMessage);
      await ctx.refresh();
      return true;
    } catch (error) {
      toast(
        error instanceof ApiError
          ? error.message
          : 'That action could not be completed. Please try again.',
        'error'
      );
      button.disabled = false;
      button.textContent = previousLabel;
      button.dataset.busy = 'false';
      if (error instanceof ApiError && [403, 404, 409].includes(error.status)) {
        await ctx.refresh();
      }
      return false;
    }
  };
}

export function actionButton(label, variant, onClick) {
  const button = el('button', { type: 'button', class: `btn btn--sm ${variant}` }, label);
  button.addEventListener('click', () => onClick(button));
  return button;
}

export function inlineConfirm(host, options) {
  const { question, confirmLabel, onConfirm } = options;
  const previous = Array.from(host.childNodes);

  const cancel = el('button', { type: 'button', class: 'btn btn--ghost btn--sm' }, 'Keep');
  const confirm = el('button', { type: 'button', class: 'btn btn--danger btn--sm' }, confirmLabel);

  cancel.addEventListener('click', () => {
    host.replaceChildren(...previous);
    cancel.blur();
  });
  confirm.addEventListener('click', () => onConfirm(confirm));

  host.replaceChildren(el('span', { class: 'list__meta' }, question), confirm, cancel);
  confirm.focus();
}
