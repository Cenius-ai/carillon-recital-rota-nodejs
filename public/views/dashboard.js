/** Dashboard: KPI strip, upcoming rota, my commitments, practice, quick add. */

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
  formatTimeRange,
  nextSundayIso,
  todayIso,
  addDaysIso,
  plural,
  isSunday
} from '../dom.js';
import { api, ApiError } from '../api.js';

export async function renderDashboard(ctx) {
  const [recitalPayload, slotPayload, meta] = await Promise.all([
    api.listRecitals('upcoming'),
    api.listSlots('upcoming'),
    api.meta()
  ]);

  const recitals = recitalPayload.recitals;
  const slots = slotPayload.slots;
  const userId = ctx.user.id;

  const myRecitals = recitals.filter((recital) => recital.claimedById === userId);
  const openRecitals = recitals.filter((recital) => !recital.claimedById);
  const mySlots = slots.filter((slot) => slot.claimedById === userId);
  const horizon = addDaysIso(todayIso(), 7);
  const weekSlots = slots.filter((slot) => slot.date <= horizon);
  const openWeekSlots = weekSlots.filter((slot) => !slot.claimedById);
  const pieceTotal = recitals.reduce((total, recital) => total + recital.pieceCount, 0);
  const recitalsWithProgramme = recitals.filter((recital) => recital.pieceCount > 0).length;

  async function runAction(button, busyLabel, action, successMessage) {
    if (button.dataset.busy === 'true') return;
    button.dataset.busy = 'true';
    button.disabled = true;
    button.textContent = busyLabel;
    try {
      await action();
      toast(successMessage);
      await ctx.refresh();
    } catch (error) {
      toast(
        error instanceof ApiError ? error.message : 'That action could not be completed. Please try again.',
        'error'
      );
      button.disabled = false;
      button.dataset.busy = 'false';
      if (error instanceof ApiError && (error.status === 409 || error.status === 403 || error.status === 404)) {
        await ctx.refresh();
      }
    }
  }

  function actionButton(label, variant, onClick) {
    const button = el('button', { type: 'button', class: `btn btn--sm ${variant}` }, label);
    button.addEventListener('click', () => onClick(button));
    return button;
  }

  function rotaActions(recital) {
    const mine = recital.claimedById === userId;
    const actions = el('div', { class: 'row' });
    actions.append(
      el('a', { class: 'btn btn--ghost btn--sm', href: `/recitals/${recital.id}`, 'data-link': 'true' }, 'Open')
    );
    if (!recital.claimedById) {
      actions.append(
        actionButton('Claim', 'btn--primary', (button) =>
          runAction(
            button,
            'Claiming…',
            () => api.claimRecital(recital.id),
            `Claimed “${recital.title}”.`
          )
        )
      );
    } else if (mine) {
      actions.append(
        actionButton('Cancel claim', 'btn--ghost', (button) =>
          runAction(
            button,
            'Cancelling…',
            () => api.releaseRecital(recital.id),
            `Released “${recital.title}”.`
          )
        )
      );
    }
    return actions;
  }

  function rotaRow(recital) {
    const mine = recital.claimedById === userId;
    return el(
      'tr',
      { class: mine ? 'is-mine' : null },
      td('Date', el('span', { class: 'cell-date' }, formatShortDate(recital.date))),
      td(
        'Recital',
        el('a', { class: 'cell-title', href: `/recitals/${recital.id}`, 'data-link': 'true' }, recital.title),
        el('div', { class: 'list__meta' }, relativeDayLabel(recital.date))
      ),
      td(
        'Carillonneur',
        recital.claimedBy ? (mine ? 'You' : recital.claimedBy.displayName) : el('span', { class: 'muted' }, 'Open')
      ),
      td('Programme', plural(recital.pieceCount, 'piece')),
      el('td', { class: 'cell-actions', dataset: { label: 'Actions' } }, rotaActions(recital))
    );
  }

  function rotaPanel() {
    const body =
      recitals.length === 0
        ? emptyState(
            'No upcoming recitals',
            'The rota is empty. Add the first Sunday recital and it will appear here straight away.',
            el('a', { class: 'btn btn--primary btn--sm', href: '/rota/new', 'data-link': 'true' }, 'Add a recital')
          )
        : el(
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
              el('tbody', {}, recitals.map(rotaRow))
            )
          );

    return el(
      'section',
      { class: 'panel span-8', 'aria-labelledby': 'panel-rota' },
      el(
        'div',
        { class: 'panel__head' },
        el('h2', { class: 'panel__title', id: 'panel-rota' }, 'Upcoming Sunday recitals'),
        el('span', { class: 'panel__meta' }, `${plural(openRecitals.length, 'open date')} · ${recitals.length} booked`)
      ),
      el('div', { class: 'panel__body panel__body--flush' }, body),
      el(
        'div',
        { class: 'panel__foot' },
        el('span', {}, 'Rota is sorted by Sunday date'),
        el('a', { href: '/rota', 'data-link': 'true' }, 'Full rota →')
      )
    );
  }

  function commitmentItem(entry) {
    const isRecital = entry.kind === 'recital';
    const title = isRecital ? entry.item.title : `${entry.item.towerRoom}`;
    const meta = isRecital
      ? `${formatShortDate(entry.item.date)} · ${relativeDayLabel(entry.item.date)} · ${plural(entry.item.pieceCount, 'piece')}`
      : `${formatShortDate(entry.item.date)} · ${formatTimeRange(entry.item.startTime, entry.item.endTime)}`;
    const cancel = actionButton('Cancel', 'btn--ghost', (button) =>
      runAction(
        button,
        'Cancelling…',
        () => (isRecital ? api.releaseRecital(entry.item.id) : api.releaseSlot(entry.item.id)),
        isRecital ? 'Recital released back to the rota.' : 'Practice slot released.'
      )
    );

    return el(
      'li',
      { class: 'list__item is-mine' },
      el(
        'div',
        { class: 'list__main' },
        isRecital
          ? el('a', { class: 'list__title', href: `/recitals/${entry.item.id}`, 'data-link': 'true' }, title)
          : el('span', { class: 'list__title' }, title),
        el('span', { class: 'list__meta' }, meta)
      ),
      el('div', { class: 'list__actions' }, cancel)
    );
  }

  function commitmentsPanel() {
    const entries = [
      ...myRecitals.map((item) => ({ kind: 'recital', item })),
      ...mySlots.map((item) => ({ kind: 'slot', item }))
    ].sort((left, right) => {
      if (left.item.date !== right.item.date) return left.item.date.localeCompare(right.item.date);
      return String(left.item.startTime || '').localeCompare(String(right.item.startTime || ''));
    });

    return el(
      'section',
      { class: 'panel span-4', 'aria-labelledby': 'panel-mine' },
      el(
        'div',
        { class: 'panel__head' },
        el('h2', { class: 'panel__title', id: 'panel-mine' }, 'Your commitments'),
        el('span', { class: 'panel__meta' }, plural(entries.length, 'claim'))
      ),
      entries.length === 0
        ? emptyState(
            'Nothing claimed yet',
            'Claim an open recital or a tower practice slot and it will be listed here.',
            el('a', { class: 'btn btn--ghost btn--sm', href: '/rota', 'data-link': 'true' }, 'Browse the rota')
          )
        : el('ul', { class: 'list' }, entries.map(commitmentItem))
    );
  }

  function slotRow(slot) {
    const mine = slot.claimedById === userId;
    const actions = el('div', { class: 'row' });
    if (!slot.claimedById) {
      actions.append(
        actionButton('Claim', 'btn--primary', (button) =>
          runAction(button, 'Claiming…', () => api.claimSlot(slot.id), 'Practice slot claimed.')
        )
      );
    } else if (mine) {
      actions.append(
        actionButton('Cancel', 'btn--ghost', (button) =>
          runAction(button, 'Cancelling…', () => api.releaseSlot(slot.id), 'Practice slot released.')
        )
      );
    } else {
      actions.append(el('span', { class: 'badge badge--taken' }, slot.claimedBy.displayName));
    }

    return el(
      'li',
      { class: mine ? 'list__item is-mine' : 'list__item' },
      el(
        'div',
        { class: 'list__main' },
        el('span', { class: 'list__title' }, `${formatShortDate(slot.date)} · ${formatTimeRange(slot.startTime, slot.endTime)}`),
        el('span', { class: 'list__meta' }, `${slot.towerRoom}${slot.notes ? ` — ${slot.notes}` : ''}`)
      ),
      el('div', { class: 'list__actions' }, actions)
    );
  }

  function practicePanel() {
    return el(
      'section',
      { class: 'panel span-7', 'aria-labelledby': 'panel-practice' },
      el(
        'div',
        { class: 'panel__head' },
        el('h2', { class: 'panel__title', id: 'panel-practice' }, 'Tower practice · next 7 days'),
        el('span', { class: 'panel__meta' }, `${plural(openWeekSlots.length, 'open slot')} of ${weekSlots.length}`)
      ),
      weekSlots.length === 0
        ? emptyState(
            'No practice slots this week',
            'The clavier is free. Add a slot so carillonneurs can reserve practice time.',
            el('a', { class: 'btn btn--primary btn--sm', href: '/practice/new', 'data-link': 'true' }, 'Add a practice slot')
          )
        : el('ul', { class: 'list' }, weekSlots.slice(0, 6).map(slotRow)),
      el(
        'div',
        { class: 'panel__foot' },
        el('span', {}, 'Silent clavier sessions available'),
        el('a', { href: '/practice', 'data-link': 'true' }, 'Practice board →')
      )
    );
  }

  /* ---------------- quick add ---------------- */

  function quickRecitalForm() {
    const dateField = createField({
      label: 'Recital date',
      name: 'date',
      type: 'date',
      inputId: 'quick-recital-date',
      value: nextSundayIso(),
      hint: 'Sundays only'
    });
    const titleField = createField({
      label: 'Recital title',
      name: 'title',
      type: 'text',
      inputId: 'quick-recital-title',
      placeholder: 'Sunday Recital: Hymn Festival'
    });
    const fields = [dateField, titleField];
    const status = el('p', { class: 'form__status', role: 'status', 'aria-live': 'polite' });
    const submit = el('button', { type: 'submit', class: 'btn btn--primary btn--sm' }, 'Add recital');
    let pending = false;

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
            dateField.setError('Choose a date.');
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
          busy(submit, true, 'Adding…');
          try {
            await api.createRecital({ date: dateField.value, title: titleField.value.trim(), notes: '' });
            toast('Recital added to the rota.');
            await ctx.refresh();
          } catch (error) {
            applyServerFieldErrors(fields, error instanceof ApiError ? error.fields : null);
            status.textContent = error instanceof ApiError ? error.message : 'Could not add the recital.';
            status.classList.add('form__status--error');
          } finally {
            pending = false;
            busy(submit, false);
          }
        }
      },
      el('div', { class: 'form__row' }, dateField.wrapper, titleField.wrapper),
      el('div', { class: 'form__actions' }, submit),
      status
    );
    return form;
  }

  function quickSlotForm() {
    const tomorrow = addDaysIso(todayIso(), 1);
    const dateField = createField({
      label: 'Date',
      name: 'date',
      type: 'date',
      inputId: 'quick-slot-date',
      value: tomorrow
    });
    const startField = createField({
      label: 'Start',
      name: 'startTime',
      type: 'time',
      inputId: 'quick-slot-start',
      value: '09:00'
    });
    const endField = createField({
      label: 'End',
      name: 'endTime',
      type: 'time',
      inputId: 'quick-slot-end',
      value: '10:00'
    });
    const roomField = createField({
      label: 'Tower room',
      name: 'towerRoom',
      type: 'select',
      inputId: 'quick-slot-room',
      value: meta.towerRooms[0],
      selectOptions: meta.towerRooms.map((room) => ({ value: room, label: room }))
    });
    const fields = [dateField, startField, endField, roomField];
    const status = el('p', { class: 'form__status', role: 'status', 'aria-live': 'polite' });
    const submit = el('button', { type: 'submit', class: 'btn btn--primary btn--sm' }, 'Add slot');
    let pending = false;

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
            dateField.setError('Choose a date.');
            firstInvalid = firstInvalid || dateField;
          }
          if (!startField.value) {
            startField.setError('Choose a start time.');
            firstInvalid = firstInvalid || startField;
          }
          if (!endField.value) {
            endField.setError('Choose an end time.');
            firstInvalid = firstInvalid || endField;
          }
          if (startField.value && endField.value && endField.value <= startField.value) {
            endField.setError('End time must be after the start time.');
            firstInvalid = firstInvalid || endField;
          }
          if (firstInvalid) {
            firstInvalid.focus();
            return;
          }
          pending = true;
          busy(submit, true, 'Adding…');
          try {
            await api.createSlot({
              date: dateField.value,
              startTime: startField.value,
              endTime: endField.value,
              towerRoom: roomField.value,
              notes: ''
            });
            toast('Practice slot added.');
            await ctx.refresh();
          } catch (error) {
            applyServerFieldErrors(fields, error instanceof ApiError ? error.fields : null);
            status.textContent = error instanceof ApiError ? error.message : 'Could not add the slot.';
            status.classList.add('form__status--error');
          } finally {
            pending = false;
            busy(submit, false);
          }
        }
      },
      el('div', { class: 'form__row' }, dateField.wrapper, roomField.wrapper),
      el('div', { class: 'form__row' }, startField.wrapper, endField.wrapper),
      el('div', { class: 'form__actions' }, submit),
      status
    );
    return form;
  }

  const quickAddPanel = el(
    'section',
    { class: 'panel span-5', 'aria-labelledby': 'panel-add' },
    el(
      'div',
      { class: 'panel__head' },
      el('h2', { class: 'panel__title', id: 'panel-add' }, 'Quick add'),
      el('span', { class: 'panel__meta' }, 'Opens a new record immediately')
    ),
    el(
      'div',
      { class: 'panel__body stack' },
      el(
        'div',
        { class: 'stack' },
        el('h3', { class: 'mono-label' }, '› New Sunday recital'),
        quickRecitalForm()
      ),
      el('div', { class: 'divider', 'aria-hidden': 'true' }, '────────────────────────────'),
      el(
        'div',
        { class: 'stack' },
        el('h3', { class: 'mono-label' }, '› New clavier practice slot'),
        quickSlotForm()
      )
    )
  );

  const kpiStrip = el(
    'div',
    { class: 'kpis' },
    el(
      'div',
      { class: 'kpi' },
      el('span', { class: 'kpi__label' }, 'Open recital dates'),
      el('span', { class: 'kpi__value' }, String(openRecitals.length)),
      el('span', { class: 'kpi__meta' }, `${plural(recitals.length, 'date')} on the rota ahead`)
    ),
    el(
      'div',
      { class: 'kpi' },
      el('span', { class: 'kpi__label' }, 'Your recital claims'),
      el('span', { class: 'kpi__value' }, String(myRecitals.length)),
      el(
        'span',
        { class: 'kpi__meta' },
        myRecitals.length
          ? `Next: ${formatShortDate(myRecitals[0].date)}`
          : 'Nothing claimed yet'
      )
    ),
    el(
      'div',
      { class: 'kpi' },
      el('span', { class: 'kpi__label' }, 'Practice · next 7 days'),
      el('span', { class: 'kpi__value' }, String(weekSlots.length)),
      el('span', { class: 'kpi__meta' }, `${plural(openWeekSlots.length, 'slot')} still open`)
    ),
    el(
      'div',
      { class: 'kpi' },
      el('span', { class: 'kpi__label' }, 'Programme pieces'),
      el('span', { class: 'kpi__value' }, String(pieceTotal)),
      el('span', { class: 'kpi__meta' }, `Across ${plural(recitalsWithProgramme, 'recital')}`)
    )
  );

  const headMeta = myRecitals.length
    ? `Your next recital: ${formatFullDate(myRecitals[0].date)} (${relativeDayLabel(myRecitals[0].date)})`
    : 'Claim a date from the rota below to take a Sunday';

  return el(
    'div',
    { class: 'page fade-in' },
    el(
      'div',
      { class: 'page__head' },
      el(
        'div',
        { class: 'page__headtext' },
        el('span', { class: 'page__eyebrow' }, `Signed in as ${ctx.user.displayName} · ${ctx.user.role || 'Carillonneur'}`),
        el('h1', { class: 'page__title' }, 'Tower dashboard', el('span', { class: 'cursor', 'aria-hidden': 'true' })),
        el('p', { class: 'page__lede' }, `${plural(openRecitals.length, 'recital date')} open · ${headMeta}`)
      ),
      el(
        'div',
        { class: 'page__actions' },
        el('a', { class: 'btn btn--primary', href: '/rota/new', 'data-link': 'true' }, 'Add recital'),
        el('a', { class: 'btn btn--ghost', href: '/practice/new', 'data-link': 'true' }, 'Add practice slot')
      )
    ),
    kpiStrip,
    el('div', { class: 'grid' }, rotaPanel(), commitmentsPanel(), practicePanel(), quickAddPanel)
  );
}
