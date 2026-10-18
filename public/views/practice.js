/** Tower practice board: slots grouped by date, plus the add-slot screen. */

import {
  el,
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
  todayIso,
  addDaysIso,
  plural
} from '../dom.js';
import { api, ApiError } from '../api.js';
import { makeRunner, actionButton, inlineConfirm } from '../ui-actions.js';

export async function renderPracticeBoard(ctx) {
  const [{ slots }, meta] = await Promise.all([api.listSlots('upcoming'), api.meta()]);
  const runAction = makeRunner(ctx);
  const userId = ctx.user.id;

  let filter = 'all';
  const boardHost = el('div', { class: 'stack' });
  const filterBar = el('div', { class: 'cluster', role: 'group', 'aria-label': 'Filter practice slots' });
  const countLabel = el('span', { class: 'panel__meta' });

  const FILTERS = [
    { key: 'all', label: 'All upcoming', test: () => true },
    { key: 'open', label: 'Open', test: (slot) => !slot.claimedById },
    { key: 'mine', label: 'Claimed by you', test: (slot) => slot.claimedById === userId }
  ];

  function slotActions(slot) {
    const mine = slot.claimedById === userId;
    const actions = el('div', { class: 'slot__actions' });

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
    }

    actions.append(
      actionButton('Delete', 'btn--danger', () => {
        inlineConfirm(actions, {
          question: 'Delete this slot?',
          confirmLabel: 'Delete',
          onConfirm: async (button) => {
            button.disabled = true;
            button.textContent = 'Deleting…';
            try {
              await api.deleteSlot(slot.id);
              toast('Practice slot deleted.');
              await ctx.refresh();
            } catch (error) {
              toast(error instanceof ApiError ? error.message : 'The slot could not be deleted.', 'error');
              button.disabled = false;
              button.textContent = 'Delete';
            }
          }
        });
      })
    );

    return actions;
  }

  function slotRow(slot) {
    const mine = slot.claimedById === userId;
    return el(
      'div',
      { class: mine ? 'slot is-mine' : 'slot' },
      el('span', { class: 'slot__time' }, formatTimeRange(slot.startTime, slot.endTime)),
      el(
        'div',
        { class: 'slot__body' },
        el('span', { class: 'slot__room' }, slot.towerRoom),
        el(
          'span',
          { class: 'slot__meta' },
          slot.claimedBy
            ? mine
              ? 'Claimed by you'
              : `Claimed by ${slot.claimedBy.displayName}`
            : 'Open — nobody has claimed this slot'
        ),
        slot.notes ? el('span', { class: 'slot__meta' }, slot.notes) : null
      ),
      slotActions(slot)
    );
  }

  function dayGroup(date, groupSlots) {
    const openCount = groupSlots.filter((slot) => !slot.claimedById).length;
    return el(
      'article',
      { class: 'daygroup', 'aria-label': formatFullDate(date) },
      el(
        'div',
        { class: 'daygroup__head' },
        el(
          'div',
          { class: 'row' },
          el('span', { class: 'daygroup__date' }, formatFullDate(date)),
          el('span', { class: 'badge badge--open' }, relativeDayLabel(date))
        ),
        el('span', { class: 'daygroup__rel' }, `${plural(groupSlots.length, 'slot')} · ${openCount} open`)
      ),
      el('div', {}, groupSlots.map(slotRow))
    );
  }

  function paintFilters() {
    filterBar.replaceChildren(
      ...FILTERS.map((entry) => {
        const count = slots.filter(entry.test).length;
        const button = el(
          'button',
          {
            type: 'button',
            class: entry.key === filter ? 'btn btn--sm btn--primary' : 'btn btn--sm btn--ghost',
            'aria-pressed': entry.key === filter ? 'true' : 'false'
          },
          `${entry.label} · ${count}`
        );
        button.addEventListener('click', () => {
          filter = entry.key;
          paint();
        });
        return button;
      })
    );
  }

  function paint() {
    paintFilters();
    const visible = slots.filter(FILTERS.find((entry) => entry.key === filter).test);
    countLabel.textContent = `${visible.length} of ${slots.length} slots`;

    if (visible.length === 0) {
      boardHost.replaceChildren(
        slots.length === 0
          ? el(
              'section',
              { class: 'panel' },
              emptyState(
                'No practice slots booked',
                'The clavier is free. Add the first slot so carillonneurs can reserve tower practice time.',
                el(
                  'a',
                  { class: 'btn btn--primary btn--sm', href: '/practice/new', 'data-link': 'true' },
                  'Add a practice slot'
                )
              )
            )
          : el(
              'section',
              { class: 'panel' },
              emptyState(
                'No slots in this view',
                'Nothing matches this filter right now. Switch back to all upcoming slots.',
                el(
                  'button',
                  {
                    type: 'button',
                    class: 'btn btn--ghost btn--sm',
                    onclick: () => {
                      filter = 'all';
                      paint();
                    }
                  },
                  'Show all upcoming slots'
                )
              )
            )
      );
      return;
    }

    const groups = new Map();
    for (const slot of visible) {
      if (!groups.has(slot.date)) groups.set(slot.date, []);
      groups.get(slot.date).push(slot);
    }
    const dates = Array.from(groups.keys()).sort();
    boardHost.replaceChildren(...dates.map((date) => dayGroup(date, groups.get(date))));
  }

  paint();

  const openTotal = slots.filter((slot) => !slot.claimedById).length;
  const mineTotal = slots.filter((slot) => slot.claimedById === userId).length;

  return el(
    'div',
    { class: 'page fade-in' },
    el(
      'div',
      { class: 'page__head' },
      el(
        'div',
        { class: 'page__headtext' },
        el('span', { class: 'page__eyebrow' }, 'Tower practice'),
        el('h1', { class: 'page__title' }, 'Clavier practice board'),
        el(
          'p',
          { class: 'page__lede' },
          `${plural(openTotal, 'open slot')} across the coming days · ${plural(mineTotal, 'slot')} claimed by you.`
        )
      ),
      el(
        'div',
        { class: 'page__actions' },
        el('a', { class: 'btn btn--primary', href: '/practice/new', 'data-link': 'true' }, 'Add practice slot'),
        el('a', { class: 'btn btn--ghost', href: '/rota', 'data-link': 'true' }, 'Recital rota')
      )
    ),
    el(
      'section',
      { class: 'panel', 'aria-labelledby': 'practice-heading' },
      el(
        'div',
        { class: 'panel__head' },
        el('h2', { class: 'panel__title', id: 'practice-heading' }, 'Slots by day'),
        countLabel
      ),
      el('div', { class: 'panel__body' }, filterBar),
      el('div', { class: 'panel__body', style: { paddingTop: '0' } }, boardHost),
      el(
        'div',
        { class: 'panel__foot' },
        el('span', {}, `Tower rooms: ${meta.towerRooms.join(' · ')}`),
        el('a', { href: '/', 'data-link': 'true' }, 'Dashboard →')
      )
    )
  );
}

export async function renderPracticeForm(ctx) {
  const meta = await api.meta();
  const tomorrow = addDaysIso(todayIso(), 1);

  const dateField = createField({
    label: 'Practice date',
    name: 'date',
    type: 'date',
    inputId: 'practice-date',
    value: tomorrow,
    required: true
  });
  const startField = createField({
    label: 'Start time',
    name: 'startTime',
    type: 'time',
    inputId: 'practice-start',
    value: '09:00',
    required: true
  });
  const endField = createField({
    label: 'End time',
    name: 'endTime',
    type: 'time',
    inputId: 'practice-end',
    value: '10:30',
    hint: 'Must be after the start time.',
    required: true
  });
  const roomField = createField({
    label: 'Tower room',
    name: 'towerRoom',
    type: 'select',
    inputId: 'practice-room',
    value: meta.towerRooms[0],
    selectOptions: meta.towerRooms.map((room) => ({ value: room, label: room }))
  });
  const notesField = createField({
    label: 'Notes (optional)',
    name: 'notes',
    type: 'textarea',
    inputId: 'practice-notes',
    rows: 3,
    placeholder: 'Silent clavier only — no bells.'
  });

  const fields = [dateField, startField, endField, roomField, notesField];
  const status = el('p', { class: 'form__status', role: 'status', 'aria-live': 'polite' });
  const submit = el('button', { type: 'submit', class: 'btn btn--primary' }, 'Add practice slot');
  const cancel = el('a', { class: 'btn btn--ghost', href: '/practice', 'data-link': 'true' }, 'Cancel');
  let pending = false;

  const summary = el('p', { class: 'form__status' }, '');
  function previewWindow() {
    if (!dateField.value || !startField.value || !endField.value) {
      summary.textContent = '';
      return;
    }
    if (endField.value <= startField.value) {
      summary.textContent = 'End time must be after the start time.';
      summary.classList.add('form__status--error');
    } else {
      summary.textContent = `${formatShortDate(dateField.value)} · ${formatTimeRange(startField.value, endField.value)} · ${roomField.value}`;
      summary.classList.remove('form__status--error');
    }
  }
  [dateField.input, startField.input, endField.input, roomField.input].forEach((input) => {
    input.addEventListener('change', previewWindow);
  });
  previewWindow();

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
          dateField.setError('Choose a practice date.');
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
        busy(submit, true, 'Adding slot…');
        try {
          await api.createSlot({
            date: dateField.value,
            startTime: startField.value,
            endTime: endField.value,
            towerRoom: roomField.value,
            notes: notesField.value.trim()
          });
          toast('Practice slot added to the board.');
          ctx.navigate('/practice');
        } catch (error) {
          applyServerFieldErrors(fields, error instanceof ApiError ? error.fields : null);
          status.textContent =
            error instanceof ApiError ? error.message : 'The slot could not be added. Please try again.';
          status.classList.add('form__status--error');
        } finally {
          pending = false;
          busy(submit, false);
        }
      }
    },
    el('div', { class: 'form__row' }, dateField.wrapper, roomField.wrapper),
    el('div', { class: 'form__row' }, startField.wrapper, endField.wrapper),
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
        el('span', { class: 'page__eyebrow' }, 'Tower practice'),
        el('h1', { class: 'page__title' }, 'Add a clavier practice slot'),
        el(
          'p',
          { class: 'page__lede' },
          'The slot opens unclaimed — anyone on the rota can reserve it, and they can release it again.'
        )
      ),
      el(
        'div',
        { class: 'page__actions' },
        el('a', { class: 'btn btn--ghost', href: '/practice', 'data-link': 'true' }, '← Back to practice board')
      )
    ),
    el(
      'section',
      { class: 'panel', 'aria-labelledby': 'add-slot-heading' },
      el(
        'div',
        { class: 'panel__head' },
        el('h2', { class: 'panel__title', id: 'add-slot-heading' }, 'Slot details'),
        el('span', { class: 'panel__meta' }, `Tower rooms: ${meta.towerRooms.length}`)
      ),
      el('div', { class: 'panel__body' }, form)
    )
  );
}
