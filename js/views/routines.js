/* Routines — reusable session templates. A routine stores target sets, reps and
   rest per exercise; the actual numbers still come from what you lifted last
   time, so a template never goes stale. */

import { el, icon, ICONS, toast, openSheet, confirmSheet, menuSheet, emptyState, fmtDate } from '../util.js';
import {
  settings, activeRoutines, upsertRoutine, deleteRoutine, exerciseName, finishedWorkouts,
} from '../state.js';
import { beginWorkout } from '../session.js';
import { pickExercises } from '../picker.js';
import { navigate } from '../router.js';

export const meta = { title: 'Routines', sub: 'Templates you train from' };

export function render(root) {
  const routines = activeRoutines();

  root.append(el('button', {
    class: 'btn btn-ghost btn-block', type: 'button', onclick: () => editRoutine(null),
  }, icon(ICONS.plus), 'New routine'));

  if (!routines.length) {
    root.append(emptyState({
      title: 'No routines',
      text: 'A routine is a list of exercises with target sets and reps. Starting one pre-fills the whole session.',
      iconPath: ICONS.dumbbell,
    }));
    return;
  }

  const history = finishedWorkouts();
  root.append(el('div', { class: 'section' }, ...routines.map((routine) => {
    const last = history.find((w) => w.routineId === routine.id);
    return el('div', { class: 'card', style: { marginBottom: '10px' } },
      el('div', { class: 'flex-between' },
        el('div', { class: 'grow' },
          el('div', { class: 'row-title', text: routine.name }),
          el('div', { class: 'row-sub', text: `${routine.items.length} exercise${routine.items.length === 1 ? '' : 's'}${last ? ` · last ${fmtDate(last.startedAt)}` : ''}` })),
        el('button', {
          class: 'icon-btn plain', type: 'button', 'aria-label': `Options for ${routine.name}`,
          onclick: () => menuSheet(routine.name, [
            { label: 'Edit routine', onPick: () => editRoutine(routine) },
            { label: 'Duplicate', onPick: () => {
              upsertRoutine({ name: `${routine.name} (copy)`, note: routine.note, items: routine.items.map((i) => ({ ...i })) });
              navigate('routines');
            } },
            { label: 'Delete routine', danger: true, onPick: async () => {
              if (await confirmSheet({ title: 'Delete routine', message: `Delete “${routine.name}”? Logged workouts are kept.`, confirmLabel: 'Delete', danger: true })) {
                deleteRoutine(routine.id);
                navigate('routines');
              }
            } },
          ]),
        }, icon(ICONS.dots))),
      el('div', { class: 'small muted', style: { margin: '8px 0 12px', lineHeight: '1.5' },
        text: routine.items.map((i) => `${exerciseName(i.exerciseId)} ${i.sets}×${i.reps}`).join(' · ') || 'No exercises yet' }),
      el('div', { class: 'flex', style: { gap: '8px' } },
        el('button', { class: 'btn btn-primary grow', type: 'button', text: 'Start workout',
          onclick: () => beginWorkout(routine) }),
        el('button', { class: 'btn btn-ghost', type: 'button', text: 'Edit', onclick: () => editRoutine(routine) })));
  })));
}

/** Routine editor. Works for both a new routine and an existing one. */
export function editRoutine(routine) {
  const draft = {
    id: routine?.id,
    name: routine?.name || '',
    note: routine?.note || '',
    items: (routine?.items || []).map((i) => ({ ...i })),
  };

  openSheet({ title: routine ? 'Edit routine' : 'New routine', tall: true }, (api) => {
    const nameInput = el('input', { class: 'input', value: draft.name, placeholder: 'e.g. Upper A' });
    const noteInput = el('textarea', { class: 'input', value: draft.note, placeholder: 'Optional note — focus, tempo, anything.' });
    const items = el('div', { class: 'stack' });

    function renderItems() {
      items.innerHTML = '';
      if (!draft.items.length) {
        items.append(el('p', { class: 'muted small center', style: { padding: '14px 0' }, text: 'No exercises yet.' }));
        return;
      }
      draft.items.forEach((item, index) => {
        const setsIn = el('input', {
          class: 'set-in', type: 'text', inputmode: 'numeric', value: String(item.sets ?? 3),
          oninput: (e) => { item.sets = Math.max(1, parseInt(e.target.value, 10) || 1); },
        });
        const repsIn = el('input', {
          class: 'set-in', type: 'text', inputmode: 'numeric', value: String(item.reps ?? 10),
          oninput: (e) => { item.reps = Math.max(1, parseInt(e.target.value, 10) || 1); },
        });
        const restIn = el('input', {
          class: 'set-in', type: 'text', inputmode: 'numeric', value: String(item.restSec ?? settings.restDefault),
          oninput: (e) => { item.restSec = Math.max(0, parseInt(e.target.value, 10) || 0); },
        });
        items.append(el('div', { class: 'card', style: { padding: '11px 12px' } },
          el('div', { class: 'flex-between', style: { marginBottom: '9px' } },
            el('div', { class: 'row-title grow', text: exerciseName(item.exerciseId) }),
            el('button', {
              class: 'icon-btn plain', type: 'button', 'aria-label': 'Options',
              onclick: () => menuSheet(exerciseName(item.exerciseId), [
                index > 0 ? { label: 'Move up', onPick: () => { swap(index, index - 1); } } : null,
                index < draft.items.length - 1 ? { label: 'Move down', onPick: () => { swap(index, index + 1); } } : null,
                { label: 'Remove', danger: true, onPick: () => { draft.items.splice(index, 1); renderItems(); } },
              ]),
            }, icon(ICONS.dots))),
          el('div', { class: 'flex', style: { gap: '8px' } },
            labelled('Sets', setsIn),
            labelled('Reps', repsIn),
            labelled('Rest (s)', restIn))));
      });
    }

    function swap(a, b) {
      [draft.items[a], draft.items[b]] = [draft.items[b], draft.items[a]];
      renderItems();
    }

    api.setFooter(
      el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => api.close() }),
      el('button', {
        class: 'btn btn-primary', type: 'button', text: 'Save routine',
        onclick: () => {
          draft.name = nameInput.value.trim();
          draft.note = noteInput.value.trim();
          if (!draft.name) { toast('Name the routine first', 'err'); nameInput.focus(); return; }
          upsertRoutine(draft);
          api.close();
          toast('Routine saved', 'ok');
          navigate('routines');
        },
      }));

    renderItems();
    return el('div', {},
      el('label', { class: 'field' }, el('span', { class: 'label', text: 'Name' }), nameInput),
      el('label', { class: 'field' }, el('span', { class: 'label', text: 'Note' }), noteInput),
      el('div', { class: 'section-head', style: { marginTop: '18px' } }, el('h2', { text: 'Exercises' })),
      items,
      el('button', {
        class: 'btn btn-ghost btn-block', type: 'button', style: { marginTop: '12px' },
        onclick: async () => {
          const ids = await pickExercises({ title: 'Add to routine' });
          for (const id of ids) draft.items.push({ exerciseId: id, sets: 3, reps: 10, restSec: settings.restDefault });
          renderItems();
        },
      }, icon(ICONS.plus), 'Add exercise'));
  });
}

const labelled = (label, input) =>
  el('label', { class: 'grow', style: { textAlign: 'center' } },
    el('div', { class: 'stat-key', style: { marginBottom: '4px' }, text: label }),
    input);
