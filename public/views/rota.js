/** Sunday recital rota: the full list, filters, and the add-recital screen. */

import {
  el,
  td,
  th,
  createField,
  clearFieldErrors,
  applyServerFieldErrors,
  busy,
  toast,
  emptyState,
  formatFullDate,
  formatShortDate,
  relativeDayLabel,
  plural,
  nextSundayIso,
  todayIso,
  isSunday
} from '../dom.js';
import { api, ApiError } from '../api.js';
import { makeRunner, actionButton } from '../ui-actions.js';

const FILTERS = [
  { key: 'upcoming', label: 'Upcoming', test: (recital, today) => recital.date >= today },
  { key: 'open', label: 'Open dates', test: (recital, today) => recital.date >= today && !recital.claimedById },
  { key: 'mine', label: 'Claimed by you', test: (recital, today, userId) => recital.claimedById === userId },
  { key: 'past', label: 'Past', test: (recital, today) => recital.date < today },
  { key: 'all', label: 'Everything', test: () => true }
];

export async function renderRotaList(ctx) {
  const payload = await api.listRecitals('all');
  const all = payload.recitals;
  const today = todayIso();
  const userId = ctx.user.id;
  const runAction = makeRunner(ctx);

  let active = 'upcoming';

  const countLabel = el('span', { class: 'panel__meta' });
  const tbody = el('tbody');
  const filterBar = el('div', { class: 'cluster', role: 'group', 'aria-label': 'Filter the rota' });
  const emptyHost = el('div', { hidden: true });

  const tableWrap = el(
    'div',
    { class: 'table-scroll' },
    el(
      'table',
      { class: 'table' },
      el(
        'thead',
        {},
        el('tr', {}, th('Date'), th('Recital'), th('Carillonneur'), th('Programme'), th('Actions'))
      ),
      tbody
    )
  );

  function actionsFor(recital) {
    const mine = recital.claimedById === userId;
    const actions = el('div', { class: 'row' });
    actions.append(
      el('a', { class: 'btn btn--ghost btn--sm', href: `/recitals/${recital.id}`, 'data-link': 'true' }, 'Open')
    );
    if (!recital.claimedById) {
      actions.append(
        actionButton('Claim', 'btn--primary', (button) =>
          runAction(button, 'Claiming…', () => api.claimRecital(recital.id), `Claimed “${recital.title}”.`)
        )
      );
    } else if (mine) {
      actions.append(
        actionButton('Cancel claim', 'btn--ghost', (button) =>
          runAction(button, 'Cancelling…', () => api.releaseRecital(recital.id), `Released “${recital.title}”.`)
        )
      );
    }
    return actions;
  }

  function row(recital) {
    const mine = recital.claimedById === userId;
    return el(
      'tr',
      { class: mine ? 'is-mine' : null },
      td(
        'Date',
        el('span', { class: 'cell-date' }, formatShortDate(recital.date)),
        el('div', { class: 'list__meta' }, relativeDayLabel(recital.date))
      ),
      td(
        'Recital',
        el('a', { class: 'cell-title', href: `/recitals/${recital.id}`, 'data-link': 'true' }, recital.title),
        recital.notes ? el('div', { class: 'list__meta' }, recital.notes) : null
      ),
      td(
        'Carillonneur',
        recital.claimedBy ? (mine ? 'You' : recital.claimedBy.displayName) : el('span', { class: 'muted' }, 'Open')
      ),
      td('Programme', plural(recital.pieceCount, 'piece')),
      el('td', { class: 'cell-actions', dataset: { label: 'Actions' } }, actionsFor(recital))
    );
  }

  function paintFilters() {
    filterBar.replaceChildren(
      ...FILTERS.map((filter) => {
        const count = all.filter((recital) => filter.test(recital, today, userId)).length;
        const button = el(
          'button',
          {
            type: 'button',
            class: filter.key === active ? 'btn btn--sm btn--primary' : 'btn btn--sm btn--ghost',
            'aria-pressed': filter.key === active ? 'true' : 'false'
          },
          `${filter.label} · ${count}`
        );
        button.addEventListener('click', () => {
          active = filter.key;
          paint();
        });
        return button;
      })
    );
  }

  function paintEmpty() {
    const filter = FILTERS.find((entry) => entry.key === active);
    if (all.length === 0) {
      emptyHost.replaceChildren(
        emptyState(
          'No recitals on the rota yet',
          'Add the first Sunday recital and the rota will fill up from there. Every signed-in carillonneur can manage the rota.',
          el('a', { class: 'btn btn--primary btn--sm', href: '/rota/new', 'data-link': 'true' }, 'Add a recital')
        )
      );
      return;
    }
    emptyHost.replaceChildren(
      emptyState(
        `No recitals in “${filter.label}”`,
        'Nothing matches this view right now. Switch to everything to see the whole season.',
        el(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost btn--sm',
            onclick: () => {
              active = 'all';
              paint();
            }
          },
          'Show everything'
        )
      )
    );
  }

  function paint() {
    const rows = all.filter((recital) =>
      FILTERS.find((entry) => entry.key === active).test(recital, today, userId)
    );
    countLabel.textContent = `${rows.length} of ${all.length} recitals`;
    paintFilters();
    if (rows.length === 0) {
      tbody.replaceChildren();
      tableWrap.hidden = true;
      emptyHost.hidden = false;
      paintEmpty();
    } else {
      tableWrap.hidden = false;
      emptyHost.hidden = true;
      tbody.replaceChildren(...rows.map(row));
    }
  }

  paint();

  const openCount = all.filter((recital) => recital.date >= today && !recital.claimedById).length;
  const mineCount = all.filter((recital) => recital.claimedById === userId).length;

  return el(
    'div',
    { class: 'page fade-in' },
    el(
      'div',
      { class: 'page__head' },
      el(
        'div',
        { class: 'page__headtext' },
        el('span', { class: 'page__eyebrow' }, 'Carillon Recital Rota'),
        el('h1', { class: 'page__title' }, 'Sunday recital rota'),
        el(
          'p',
          { class: 'page__lede' },
          `${plural(all.length, 'recital')} on the books · ${plural(openCount, 'open Sunday')} · ${plural(
            mineCount,
            'date'
          )} claimed by you.`
        )
      ),
      el(
        'div',
        { class: 'page__actions' },
        el('a', { class: 'btn btn--primary', href: '/rota/new', 'data-link': 'true' }, 'Add recital'),
        el('a', { class: 'btn btn--ghost', href: '/practice', 'data-link': 'true' }, 'Practice board')
      )
    ),
    el(
      'section',
      { class: 'panel', 'aria-labelledby': 'rota-heading' },
      el(
        'div',
        { class: 'panel__head' },
        el('h2', { class: 'panel__title', id: 'rota-heading' }, 'Rota by Sunday date'),
        countLabel
      ),
      el('div', { class: 'panel__body stack' }, filterBar),
      el('div', { class: 'panel__body panel__body--flush' }, tableWrap, emptyHost),
      el(
        'div',
        { class: 'panel__foot' },
        el('span', {}, 'Claiming locks a date to you until you cancel it'),
        el('a', { href: '/', 'data-link': 'true' }, 'Dashboard →')
      )
    )
  );
}

export async function renderRecitalForm(ctx) {
  const dateField = createField({
    label: 'Recital date',
    name: 'date',
    type: 'date',
    inputId: 'recital-date',
    value: nextSundayIso(),
    hint: 'Sunday recitals only — the form rejects any other weekday.',
    required: true
  });
  const titleField = createField({
    label: 'Recital title',
    name: 'title',
    type: 'text',
    inputId: 'recital-title',
    placeholder: 'Sunday Recital: Hymn Festival',
    hint: 'Shown on the rota and on the programme page.',
    required: true
  });
  const notesField = createField({
    label: 'Notes for the carillonneur (optional)',
    name: 'notes',
    type: 'textarea',
    inputId: 'recital-notes',
    rows: 4,
    placeholder: 'Meet at the tower door ten minutes before the hour.'
  });

  const fields = [dateField, titleField, notesField];
  const status = el('p', { class: 'form__status', role: 'status', 'aria-live': 'polite' });
  const submit = el('button', { type: 'submit', class: 'btn btn--primary' }, 'Add recital');
  const cancel = el('a', { class: 'btn btn--ghost', href: '/rota', 'data-link': 'true' }, 'Cancel');
  const summary = el('p', { class: 'form__status' }, '');
  let pending = false;

  function previewDate() {
    if (!dateField.value) {
      summary.textContent = '';
      return;
    }
    if (isSunday(dateField.value)) {
      summary.textContent = `Rings on ${formatFullDate(dateField.value)}.`;
      summary.classList.remove('form__status--error');
    } else {
      summary.textContent = `${formatFullDate(dateField.value)} is not a Sunday.`;
      summary.classList.add('form__status--error');
    }
  }

  dateField.input.addEventListener('change', previewDate);
  previewDate();

  const form = el(
    'form',
    {
      class: 'form',
      novalidate: true,
      onsubmit: async (event) => {
        event.preventDefault();
        if (pending) return;
        clearFieldErrors(fields);
        status.textContent = '';
        let firstInvalid = null;

        if (!dateField.value) {
          dateField.setError('Choose the Sunday date.');
          firstInvalid = firstInvalid || dateField;
        } else if (!isSunday(dateField.value)) {
          dateField.setError('Sunday recitals must fall on a Sunday.');
          firstInvalid = firstInvalid || dateField;
        }
        if (titleField.value.trim().length < 3) {
          titleField.setError('Give the recital a title (at least 3 characters).');
          firstInvalid = firstInvalid || titleField;
        }

        if (firstInvalid) {
          firstInvalid.focus();
          return;
        }

        pending = true;
        busy(submit, true, 'Adding recital…');
        try {
          const result = await api.createRecital({
            date: dateField.value,
            title: titleField.value.trim(),
            notes: notesField.value.trim()
          });
          toast('Recital added to the rota.');
          ctx.navigate(`/recitals/${result.recital.id}`);
        } catch (error) {
          applyServerFieldErrors(fields, error instanceof ApiError ? error.fields : null);
          status.textContent =
            error instanceof ApiError ? error.message : 'The recital could not be added. Please try again.';
          status.classList.add('form__status--error');
        } finally {
          pending = false;
          busy(submit, false);
        }
      }
    },
    dateField.wrapper,
    titleField.wrapper,
    notesField.wrapper,
    summary,
    el('div', { class: 'form__actions' }, submit, cancel),
    status
  );

  return el(
    'div',
    { class: 'page fade-in' },
    el(
      'div',
      { class: 'page__head' },
      el(
        'div',
        { class: 'page__headtext' },
        el('span', { class: 'page__eyebrow' }, 'Sunday recital rota'),
        el('h1', { class: 'page__title' }, 'Add a Sunday recital'),
        el(
          'p',
          { class: 'page__lede' },
          'New recitals open on the rota straight away — anyone can then claim the date.'
        )
      ),
      el('div', { class: 'page__actions' }, el('a', { class: 'btn btn--ghost', href: '/rota', 'data-link': 'true' }, '← Back to rota'))
    ),
    el(
      'section',
      { class: 'panel', 'aria-labelledby': 'add-recital-heading' },
      el(
        'div',
        { class: 'panel__head' },
        el('h2', { class: 'panel__title', id: 'add-recital-heading' }, 'Recital details'),
        el('span', { class: 'panel__meta' }, 'All fields validated on the server too')
      ),
      el('div', { class: 'panel__body' }, form)
    )
  );
}
