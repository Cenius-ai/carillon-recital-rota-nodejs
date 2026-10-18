/**
 * Tiny DOM toolkit: element builder, date formatting, form fields, toasts.
 * Everything renders through textContent / createElement — no HTML strings.
 */

/* ------------------------------------------------------------------ */
/* Elements                                                            */
/* ------------------------------------------------------------------ */

function flatten(children) {
  const out = [];
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) continue;
    if (Array.isArray(child)) out.push(...flatten(child));
    else out.push(child);
  }
  return out;
}

function applyProps(node, props) {
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class' || key === 'className') {
      node.className = String(value);
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'dataset') {
      for (const [dataKey, dataValue] of Object.entries(value)) {
        if (dataValue === null || dataValue === undefined) continue;
        node.dataset[dataKey] = String(dataValue);
      }
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (value === true) {
      node.setAttribute(key, '');
    } else {
      node.setAttribute(key, String(value));
    }
  }
}

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  applyProps(node, props);
  for (const child of flatten(children)) {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function frag(...children) {
  const node = document.createDocumentFragment();
  for (const child of flatten(children)) {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export function td(label, ...children) {
  return el('td', { dataset: { label } }, ...children);
}

export function th(label, options = {}) {
  return el('th', { scope: 'col', class: options.class || null }, label);
}

/* ------------------------------------------------------------------ */
/* Icons (inline SVG, currentColor)                                    */
/* ------------------------------------------------------------------ */

const ICON_PATHS = {
  plus: 'M12 5v14M5 12h14',
  'arrow-left': 'M19 12H5M11 18l-6-6 6-6',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  trash: 'M4 7h16M9 7V4.5h6V7M6 7l1 13h10l1-13M10 11v6M14 11v6',
  pencil: 'M4 20h4L20 8l-4-4L4 16v4Z',
  clock: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17M12 7.5V12l3.2 2',
  calendar: 'M4 6.5h16V20H4zM4 10.5h16M8.5 3v4M15.5 3v4',
  user: 'M12 4.5a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5M5 20c0-3.2 3.1-5 7-5s7 1.8 7 5',
  logout: 'M10 4H5v16h5M14.5 8l4 4-4 4M18.5 12H9',
  check: 'M5 13l4 4L19 7',
  close: 'M6 6l12 12M18 6L6 18',
  bell: 'M12 3.5a5 5 0 0 0-5 5v4L5 16h14l-2-3.5v-4a5 5 0 0 0-5-5M10 19a2 2 0 0 0 4 0'
};

const SVG_NS = 'http://www.w3.org/2000/svg';

export function icon(name, size = 16) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICON_PATHS[name] || ICON_PATHS.check);
  svg.append(path);
  return svg;
}

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseIsoDate(iso) {
  return new Date(`${iso}T12:00:00`);
}

export function todayIso() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function addDaysIso(iso, days) {
  const date = parseIsoDate(iso);
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function nextSundayIso(fromIso = todayIso()) {
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = addDaysIso(fromIso, offset);
    if (parseIsoDate(candidate).getDay() === 0) return candidate;
  }
  return fromIso;
}

export function isSunday(iso) {
  return parseIsoDate(iso).getDay() === 0;
}

export function formatFullDate(iso) {
  const date = parseIsoDate(iso);
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatShortDate(iso) {
  const date = parseIsoDate(iso);
  return `${WEEKDAYS_SHORT[date.getDay()]} ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

export function formatDayMonth(iso) {
  const date = parseIsoDate(iso);
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

export function relativeDayLabel(iso) {
  const today = todayIso();
  const diff = Math.round((parseIsoDate(iso) - parseIsoDate(today)) / DAY_MS);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return `In ${diff} days`;
  if (diff < -1 && diff > -7) return `${Math.abs(diff)} days ago`;
  const weeks = Math.round(Math.abs(diff) / 7);
  if (weeks < 2) return diff > 0 ? 'Next week' : 'Last week';
  return diff > 0 ? `In ${weeks} weeks` : `${weeks} weeks ago`;
}

export function formatTimestamp(isoDateTime) {
  const date = new Date(isoDateTime);
  if (Number.isNaN(date.getTime())) return '—';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}, ${hours}:${minutes}`;
}

export function formatTimeRange(start, end) {
  return `${start} – ${end}`;
}

export function formatDuration(minutes) {
  if (!minutes) return '—';
  return `${minutes} min`;
}

export function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm || `${singular}s`}`;
}

/* ------------------------------------------------------------------ */
/* Form fields                                                         */
/* ------------------------------------------------------------------ */

let fieldCounter = 0;

export function createField(options) {
  const {
    label,
    name,
    type = 'text',
    value = '',
    hint,
    required = false,
    autocomplete,
    placeholder,
    min,
    max,
    step,
    rows,
    selectOptions,
    reveal = false,
    inputId,
    inputmode
  } = options;

  fieldCounter += 1;
  const id = inputId || `field-${name}-${fieldCounter}`;
  const errorId = `${id}-error`;
  const hintId = hint ? `${id}-hint` : null;

  let input;
  const shared = {
    id,
    name,
    'aria-describedby': [hintId, errorId].filter(Boolean).join(' ')
  };
  if (required) shared.required = true;

  if (type === 'textarea') {
    input = el('textarea', { ...shared, class: 'textarea', rows: rows || 3, placeholder: placeholder || null }, value);
  } else if (type === 'select') {
    input = el('select', { ...shared, class: 'select' });
    for (const option of selectOptions || []) {
      input.append(
        el(
          'option',
          { value: option.value, selected: option.value === value ? true : null },
          option.label
        )
      );
    }
  } else {
    input = el('input', {
      ...shared,
      class: 'input',
      type,
      value: value === null || value === undefined ? '' : String(value),
      autocomplete: autocomplete || null,
      placeholder: placeholder || null,
      min: min === undefined ? null : String(min),
      max: max === undefined ? null : String(max),
      step: step === undefined ? null : String(step),
      inputmode: inputmode || null
    });
  }

  const errorNode = el('p', { class: 'field__error', id: errorId, hidden: true });

  let inputHost = input;
  if (reveal) {
    const toggle = el(
      'button',
      {
        type: 'button',
        class: 'pw-toggle',
        'aria-pressed': 'false',
        'aria-label': 'Show password',
        onclick: () => {
          const showing = input.type === 'text';
          input.type = showing ? 'password' : 'text';
          toggle.textContent = showing ? 'Show' : 'Hide';
          toggle.setAttribute('aria-pressed', showing ? 'false' : 'true');
          toggle.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
          input.focus();
        }
      },
      'Show'
    );
    inputHost = el('div', { class: 'pw-wrap' }, input, toggle);
  }

  const wrapper = el(
    'div',
    { class: 'field' },
    el('label', { class: 'field__label', for: id }, label),
    inputHost,
    hint ? el('p', { class: 'field__hint', id: hintId }, hint) : null,
    errorNode
  );

  return {
    wrapper,
    input,
    name,
    get value() {
      return input.value;
    },
    set value(next) {
      input.value = next;
    },
    setError(message) {
      errorNode.textContent = message;
      errorNode.hidden = false;
      input.setAttribute('aria-invalid', 'true');
    },
    clearError() {
      errorNode.textContent = '';
      errorNode.hidden = true;
      input.removeAttribute('aria-invalid');
    },
    focus() {
      input.focus();
    }
  };
}

export function collectFields(fields) {
  const values = {};
  for (const field of fields) {
    if (!field) continue;
    values[field.name] = typeof field.value === 'string' ? field.value.trim() : field.value;
  }
  return values;
}

export function clearFieldErrors(fields) {
  for (const field of fields) if (field) field.clearError();
}

export function applyServerFieldErrors(fields, fieldErrors) {
  if (!fieldErrors) return false;
  let applied = false;
  for (const field of fields) {
    if (!field) continue;
    const message = fieldErrors[field.name];
    if (message) {
      field.setError(message);
      applied = true;
    }
  }
  return applied;
}

export function focusFirstField(fields) {
  for (const field of fields) {
    if (field) {
      field.focus();
      return;
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* Toasts                                                              */
/* ------------------------------------------------------------------ */

export function toast(message, kind = 'info') {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const node = el('div', { class: kind === 'error' ? 'toast toast--error' : 'toast' }, message);
  stack.append(node);
  window.setTimeout(() => node.remove(), kind === 'error' ? 7000 : 4200);
}

/* ------------------------------------------------------------------ */
/* Misc UI helpers                                                     */
/* ------------------------------------------------------------------ */

export function statusBadge(recitalOrSlot, currentUserId) {
  if (recitalOrSlot.claimedById && recitalOrSlot.claimedById === currentUserId) {
    return el('span', { class: 'badge badge--mine' }, 'Claimed by you');
  }
  if (recitalOrSlot.claimedById) {
    return el('span', { class: 'badge badge--taken' }, recitalOrSlot.claimedBy.displayName);
  }
  return el('span', { class: 'badge badge--open' }, 'Open');
}

export function errorBanner(message, onRetry) {
  return el(
    'div',
    { class: 'error-banner', role: 'alert' },
    el('div', {}, el('strong', {}, 'Something went wrong'), el('span', {}, message)),
    onRetry
      ? el('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: onRetry }, 'Try again')
      : null
  );
}

export function emptyState(title, text, action) {
  return el(
    'div',
    { class: 'empty' },
    el('p', { class: 'empty__title' }, title),
    el('p', { class: 'empty__text' }, text),
    action || null
  );
}

export function sectionHeading(title, hint) {
  return el(
    'div',
    { class: 'row' },
    el('h2', { class: 'mono-label' }, title),
    hint ? el('span', { class: 'panel__meta' }, hint) : null
  );
}

export function busy(button, isBusy, busyLabel) {
  if (!button) return;
  if (isBusy) {
    button.dataset.label = button.textContent;
    button.textContent = busyLabel || 'Working…';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    if (button.dataset.label) button.textContent = button.dataset.label;
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}
