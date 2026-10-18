/** Recital detail: assigned carillonneur, notes, and the ordered programme editor. */

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
  formatTimestamp,
  relativeDayLabel,
  plural,
  isSunday
} from '../dom.js';
import { api, ApiError } from '../api.js';
import { makeRunner, actionButton, inlineConfirm } from '../ui-actions.js';

export async function renderRecitalDetail(ctx) {
  const recitalId = ctx.params.id;
  const [recitalPayload, piecesPayload] = await Promise.all([
    api.getRecital(recitalId),
    api.listPieces(recitalId)
  ]);

  const recital = recitalPayload.recital;
  const pieces = piecesPayload.pieces;
  const runAction = makeRunner(ctx);
  const mine = recital.claimedById === ctx.user.id;
  const totalMinutes = pieces.reduce((total, piece) => total + (piece.durationMinutes || 0), 0);

  /* ---------------- header actions ---------------- */

  const actionsHost = el('div', { class: 'page__actions' });

  function claimButton() {
    if (!recital.claimedById) {
      return actionButton('Claim this recital', 'btn--primary', (button) =>
        runAction(button, 'Claiming…', () => api.claimRecital(recital.id), 'This recital is now on your rota.')
      );
    }
    if (mine) {
      return actionButton('Cancel my claim', 'btn--ghost', (button) =>
        runAction(button, 'Cancelling…', () => api.releaseRecital(recital.id), 'Recital released back to the rota.')
      );
    }
    return el('span', { class: 'badge badge--taken' }, `Claimed by ${recital.claimedBy.displayName}`);
  }

  function deleteButton() {
    return actionButton('Delete recital', 'btn--danger', () => {
      inlineConfirm(actionsHost, {
        question: `Delete this recital${pieces.length ? ` and its ${plural(pieces.length, 'piece')}` : ''}?`,
        confirmLabel: 'Yes, delete it',
        onConfirm: async (button) => {
          button.disabled = true;
          button.textContent = 'Deleting…';
          try {
            await api.deleteRecital(recital.id);
            toast('Recital deleted from the rota.');
            ctx.navigate('/');
          } catch (error) {
            toast(
              error instanceof ApiError ? error.message : 'The recital could not be deleted.',
              'error'
            );
            button.disabled = false;
            button.textContent = 'Yes, delete it';
          }
        }
      });
    });
  }

  actionsHost.append(
    claimButton(),
    el(
      'a',
      { class: 'btn btn--ghost', href: '/rota', 'data-link': 'true' },
      'Back to rota'
    ),
    deleteButton()
  );

  /* ---------------- details panel ---------------- */

  const detailsBody = el('div', { class: 'panel__body' });

  function detailRow(label, value) {
    return [el('dt', {}, label), el('dd', {}, value)];
  }

  function paintDetails() {
    const statusBadge = mine
      ? el('span', { class: 'badge badge--mine' }, 'Claimed by you')
      : recital.claimedById
        ? el('span', { class: 'badge badge--taken' }, 'Claimed')
        : el('span', { class: 'badge badge--open' }, 'Open — needs a carillonneur');

    detailsBody.replaceChildren(
      el(
        'dl',
        { class: 'detail-list' },
        ...detailRow('Date', `${formatFullDate(recital.date)} · ${relativeDayLabel(recital.date)}`),
        ...detailRow(
          'Carillonneur',
          recital.claimedBy ? (mine ? 'You' : recital.claimedBy.displayName) : 'Not yet claimed'
        ),
        ...detailRow('Status', statusBadge),
        ...detailRow(
          'Programme',
          `${plural(pieces.length, 'piece')}${totalMinutes ? ` · about ${totalMinutes} min of music` : ''}`
        ),
        ...detailRow('Added', formatTimestamp(recital.createdAt)),
        ...detailRow(
          'Notes',
          recital.notes ? el('span', { class: 'note-block' }, recital.notes) : el('span', { class: 'muted' }, 'No notes yet.')
        )
      )
    );
  }

  const editButton = actionButton('Edit details', 'btn--ghost', () => {
    paintEditForm();
  });

  actionsHost.insertBefore(editButton, actionsHost.children[1] || null);

  function paintEditForm() {
    const dateField = createField({
      label: 'Recital date',
      name: 'date',
      type: 'date',
      inputId: 'edit-recital-date',
      value: recital.date,
      hint: 'Sundays only'
    });
    const titleField = createField({
      label: 'Recital title',
      name: 'title',
      type: 'text',
      inputId: 'edit-recital-title',
      value: recital.title
    });
    const notesField = createField({
      label: 'Notes',
      name: 'notes',
      type: 'textarea',
      inputId: 'edit-recital-notes',
      value: recital.notes || '',
      rows: 4
    });
    const fields = [dateField, titleField, notesField];
    const status = el('p', { class: 'form__status', role: 'status', 'aria-live': 'polite' });
    const save = el('button', { type: 'submit', class: 'btn btn--primary btn--sm' }, 'Save changes');
    const cancel = el(
      'button',
      {
        type: 'button',
        class: 'btn btn--ghost btn--sm',
        onclick: () => paintDetails()
      },
      'Cancel'
    );
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
          busy(save, true, 'Saving…');
          try {
            await api.updateRecital(recital.id, {
              date: dateField.value,
              title: titleField.value.trim(),
              notes: notesField.value.trim()
            });
            toast('Recital updated.');
            await ctx.refresh();
          } catch (error) {
            applyServerFieldErrors(fields, error instanceof ApiError ? error.fields : null);
            status.textContent =
              error instanceof ApiError ? error.message : 'The recital could not be saved.';
            status.classList.add('form__status--error');
          } finally {
            pending = false;
            busy(save, false);
          }
        }
      },
      dateField.wrapper,
      titleField.wrapper,
      notesField.wrapper,
      status,
      el('div', { class: 'form__actions' }, save, cancel)
    );

    detailsBody.replaceChildren(form);
    dateField.focus();
  }

  paintDetails();

  /* ---------------- programme ---------------- */

  const programmeHost = el('div', { class: 'panel__body panel__body--flush' });

  function pieceEditForm(piece, host) {
    const previous = Array.from(host.childNodes);
    const titleField = createField({
      label: 'Title',
      name: 'title',
      value: piece.title,
      inputId: `piece-title-${piece.id}`
    });
    const composerField = createField({
      label: 'Composer',
      name: 'composer',
      value: piece.composer,
      inputId: `piece-composer-${piece.id}`
    });
    const arrangerField = createField({
      label: 'Arrangement credit',
      name: 'arranger',
      value: piece.arranger || '',
      inputId: `piece-arranger-${piece.id}`,
      placeholder: 'Original for carillon'
    });
    const durationField = createField({
      label: 'Duration (minutes)',
      name: 'durationMinutes',
      type: 'number',
      min: 1,
      max: 60,
      value: piece.durationMinutes || '',
      inputId: `piece-duration-${piece.id}`
    });
    const fields = [titleField, composerField, arrangerField, durationField];
    const status = el('p', { class: 'form__status', role: 'status', 'aria-live': 'polite' });
    const save = el('button', { type: 'submit', class: 'btn btn--primary btn--sm' }, 'Save piece');
    const cancel = el(
      'button',
      {
        type: 'button',
        class: 'btn btn--ghost btn--sm',
        onclick: () => host.replaceChildren(...previous)
      },
      'Cancel'
    );
    let pending = false;

    const form = el(
      'form',
      {
        class: 'form',
        style: { width: '100%' },
        novalidate: true,
        onsubmit: async (event) => {
          event.preventDefault();
          if (pending) return;
          clearFieldErrors(fields);
          status.textContent = '';
          let firstInvalid = null;
          if (titleField.value.trim().length === 0) {
            titleField.setError('A title is required.');
            firstInvalid = firstInvalid || titleField;
          }
          if (composerField.value.trim().length === 0) {
            composerField.setError('A composer is required.');
            firstInvalid = firstInvalid || composerField;
          }
          const duration = durationField.value.trim();
          if (duration && (Number(duration) < 1 || Number(duration) > 60 || !Number.isInteger(Number(duration)))) {
            durationField.setError('Use a whole number between 1 and 60.');
            firstInvalid = firstInvalid || durationField;
          }
          if (firstInvalid) {
            firstInvalid.focus();
            return;
          }
          pending = true;
          busy(save, true, 'Saving…');
          try {
            await api.updatePiece(piece.id, {
              title: titleField.value.trim(),
              composer: composerField.value.trim(),
              arranger: arrangerField.value.trim(),
              durationMinutes: duration ? Number(duration) : null
            });
            toast('Programme piece updated.');
            await ctx.refresh();
          } catch (error) {
            applyServerFieldErrors(fields, error instanceof ApiError ? error.fields : null);
            status.textContent = error instanceof ApiError ? error.message : 'The piece could not be saved.';
            status.classList.add('form__status--error');
          } finally {
            pending = false;
            busy(save, false);
          }
        }
      },
      el('div', { class: 'form__row' }, titleField.wrapper, composerField.wrapper),
      el('div', { class: 'form__row' }, arrangerField.wrapper, durationField.wrapper),
      status,
      el('div', { class: 'form__actions' }, save, cancel)
    );

    host.replaceChildren(form);
    titleField.focus();
  }

  function pieceRow(piece, index) {
    const host = el('div', { class: 'piece' });
    const actions = el('div', { class: 'piece__actions' });

    actions.append(
      actionButton('Edit', 'btn--ghost', () => pieceEditForm(piece, host)),
      actionButton('Remove', 'btn--danger', () => {
        inlineConfirm(actions, {
          question: 'Remove from programme?',
          confirmLabel: 'Remove',
          onConfirm: async (button) => {
            button.disabled = true;
            button.textContent = 'Removing…';
            try {
              await api.deletePiece(piece.id);
              toast('Piece removed from the programme.');
              await ctx.refresh();
            } catch (error) {
              toast(error instanceof ApiError ? error.message : 'The piece could not be removed.', 'error');
              button.disabled = false;
              button.textContent = 'Remove';
            }
          }
        });
      })
    );

    host.append(
      el('span', { class: 'piece__order' }, String(index + 1).padStart(2, '0')),
      el(
        'div',
        { class: 'piece__body' },
        el('span', { class: 'piece__title' }, piece.title),
        el(
          'span',
          { class: 'piece__meta' },
          piece.arranger
            ? `${piece.composer} · arr. ${piece.arranger}${piece.durationMinutes ? ` · ${piece.durationMinutes} min` : ''}`
            : `${piece.composer}${piece.durationMinutes ? ` · ${piece.durationMinutes} min` : ''}`
        ),
        piece.notes ? el('span', { class: 'piece__notes' }, piece.notes) : null
      ),
      actions
    );
    return host;
  }

  function paintProgramme() {
    if (pieces.length === 0) {
      programmeHost.replaceChildren(
        emptyState(
          'The programme is still empty',
          'Add the first piece below — title, composer, and the arrangement credit that belongs on the printed programme.',
          el(
            'button',
            {
              type: 'button',
              class: 'btn btn--primary btn--sm',
              onclick: () => {
                const first = document.getElementById('add-piece-title');
                if (first) first.focus();
              }
            },
            'Add the first piece'
          )
        )
      );
      return;
    }
    programmeHost.replaceChildren(...pieces.map(pieceRow));
  }

  paintProgramme();

  /* ---------------- add-piece form ---------------- */

  const titleField = createField({
    label: 'Piece title',
    name: 'title',
    inputId: 'add-piece-title',
    placeholder: 'Preludium in G'
  });
  const composerField = createField({
    label: 'Composer',
    name: 'composer',
    inputId: 'add-piece-composer',
    placeholder: 'Matthias van den Gheyn'
  });
  const arrangerField = createField({
    label: 'Arrangement credit',
    name: 'arranger',
    inputId: 'add-piece-arranger',
    placeholder: 'Original for carillon',
    hint: 'Credit printed next to the composer, e.g. “arr. Saskia Vermeer”.'
  });
  const durationField = createField({
    label: 'Duration (minutes, optional)',
    name: 'durationMinutes',
    type: 'number',
    inputId: 'add-piece-duration',
    min: 1,
    max: 60
  });
  const notesField = createField({
    label: 'Performance notes (optional)',
    name: 'notes',
    type: 'textarea',
    inputId: 'add-piece-notes',
    rows: 2
  });

  const addFields = [titleField, composerField, arrangerField, durationField, notesField];
  const addStatus = el('p', { class: 'form__status', role: 'status', 'aria-live': 'polite' });
  const addSubmit = el('button', { type: 'submit', class: 'btn btn--primary' }, 'Add to programme');
  let addPending = false;

  const addForm = el(
    'form',
    {
      class: 'form',
      novalidate: true,
      onsubmit: async (event) => {
        event.preventDefault();
        if (addPending) return;
        clearFieldErrors(addFields);
        addStatus.textContent = '';
        let firstInvalid = null;
        if (titleField.value.trim().length === 0) {
          titleField.setError('A title is required.');
          firstInvalid = firstInvalid || titleField;
        }
        if (composerField.value.trim().length === 0) {
          composerField.setError('A composer is required.');
          firstInvalid = firstInvalid || composerField;
        }
        const duration = durationField.value.trim();
        if (duration && (!Number.isInteger(Number(duration)) || Number(duration) < 1 || Number(duration) > 60)) {
          durationField.setError('Use a whole number between 1 and 60.');
          firstInvalid = firstInvalid || durationField;
        }
        if (firstInvalid) {
          firstInvalid.focus();
          return;
        }
        addPending = true;
        busy(addSubmit, true, 'Adding…');
        try {
          await api.createPiece(recital.id, {
            title: titleField.value.trim(),
            composer: composerField.value.trim(),
            arranger: arrangerField.value.trim(),
            durationMinutes: duration ? Number(duration) : null,
            notes: notesField.value.trim()
          });
          toast('Piece added to the programme.');
          await ctx.refresh();
        } catch (error) {
          applyServerFieldErrors(addFields, error instanceof ApiError ? error.fields : null);
          addStatus.textContent =
            error instanceof ApiError ? error.message : 'The piece could not be added. Please try again.';
          addStatus.classList.add('form__status--error');
        } finally {
          addPending = false;
          busy(addSubmit, false);
        }
      }
    },
    el('div', { class: 'form__row' }, titleField.wrapper, composerField.wrapper),
    el('div', { class: 'form__row' }, arrangerField.wrapper, durationField.wrapper),
    notesField.wrapper,
    addStatus,
    el('div', { class: 'form__actions' }, addSubmit)
  );

  /* ---------------- page ---------------- */

  return el(
    'div',
    { class: 'page fade-in' },
    el(
      'div',
      { class: 'page__head' },
      el(
        'div',
        { class: 'page__headtext' },
        el(
          'span',
          { class: 'page__eyebrow' },
          `Sunday recital · ${formatShortDate(recital.date)} · ${relativeDayLabel(recital.date)}`
        ),
        el('h1', { class: 'page__title' }, recital.title),
        el(
          'p',
          { class: 'page__lede' },
          pieces.length
            ? `${plural(pieces.length, 'piece')} in the programme${totalMinutes ? `, about ${totalMinutes} minutes of music` : ''}.`
            : 'No programme yet — add the first piece so the carillonneur knows what to play.'
        )
      ),
      actionsHost
    ),
    el(
      'div',
      { class: 'grid' },
      el(
        'section',
        { class: 'panel span-5', 'aria-labelledby': 'recital-details-heading' },
        el(
          'div',
          { class: 'panel__head' },
          el('h2', { class: 'panel__title', id: 'recital-details-heading' }, 'Recital details'),
          el('span', { class: 'panel__meta' }, formatFullDate(recital.date))
        ),
        detailsBody
      ),
      el(
        'section',
        { class: 'panel span-7', 'aria-labelledby': 'programme-heading' },
        el(
          'div',
          { class: 'panel__head' },
          el('h2', { class: 'panel__title', id: 'programme-heading' }, 'Programme'),
          el('span', { class: 'panel__meta' }, 'In playing order')
        ),
        programmeHost
      ),
      el(
        'section',
        { class: 'panel span-12', 'aria-labelledby': 'add-piece-heading' },
        el(
          'div',
          { class: 'panel__head' },
          el('h2', { class: 'panel__title', id: 'add-piece-heading' }, 'Add a programme piece'),
          el('span', { class: 'panel__meta' }, 'Appended to the end of the programme')
        ),
        el('div', { class: 'panel__body' }, addForm)
      )
    )
  );
}
