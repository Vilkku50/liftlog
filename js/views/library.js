/* Exercise library. Browsing is deliberately text-only: animations are fetched
   when you open an exercise, not for every row, so a scroll through the
   catalogue costs one API call instead of forty. */

import { el, icon, ICONS, toast, debounce, emptyState, menuSheet } from '../util.js';
import { settings, saveSettings, allExercises, deleteExercise } from '../state.js';
import { BODY_PARTS, EQUIPMENT } from '../seed.js';
import { searchLocal, adoptRemote, createExerciseSheet } from '../picker.js';
import { openExerciseDetail, thumb } from '../exercise-detail.js';
import { navigate } from '../router.js';
import * as edb from '../edb.js';

export const meta = { title: 'Library', sub: 'Exercises, animations and how-to' };

export function render(root) {
  const state = { query: '', bodyPart: '', equipment: '', source: 'local' };

  const input = el('input', { class: 'input', type: 'search', placeholder: 'Search exercises…', autocomplete: 'off' });
  const results = el('div', { class: 'stack', style: { marginTop: '12px' } });
  const status = el('div', { class: 'center muted small', style: { padding: '10px 0' }, hidden: true });

  const sourceTabs = el('div', { class: 'segmented', style: { marginTop: '10px' } },
    el('button', { type: 'button', class: 'on', text: `My library`, onclick: () => setSource('local') }),
    el('button', { type: 'button', text: 'ExerciseDB', onclick: () => setSource('remote') }));

  const partChips = el('div', { class: 'chips', style: { marginTop: '10px' } },
    chip('All', true, () => setFilter('bodyPart', '')),
    ...BODY_PARTS.map((p) => chip(p, false, () => setFilter('bodyPart', p))));

  const equipChips = el('div', { class: 'chips', style: { marginTop: '8px' } },
    chip('Any equipment', true, () => setFilter('equipment', '')),
    ...EQUIPMENT.map((p) => chip(p, false, () => setFilter('equipment', p))));

  function chip(label, on, onclick) {
    return el('button', { type: 'button', class: `chip${on ? ' on' : ''}`, text: label, onclick });
  }

  function setFilter(key, value) {
    state[key] = value;
    const group = key === 'bodyPart' ? partChips : equipChips;
    const allLabel = key === 'bodyPart' ? 'All' : 'Any equipment';
    [...group.children].forEach((c) => c.classList.toggle('on', c.textContent === (value || allLabel)));
    run();
  }

  function setSource(next) {
    if (next === 'remote' && !edb.isReady()) {
      toast('Connect ExerciseDB in Settings first', 'err');
      navigate('settings');
      return;
    }
    state.source = next;
    [...sourceTabs.children].forEach((b, i) => b.classList.toggle('on', (i === 0) === (next === 'local')));
    run();
  }

  const runRemote = debounce(async () => {
    status.hidden = false;
    status.textContent = 'Searching ExerciseDB…';
    results.innerHTML = '';
    try {
      const list = await edb.search({ query: state.query, bodyPart: state.bodyPart, equipment: state.equipment, limit: 40 });
      status.hidden = true;
      if (!list.length) {
        results.append(emptyState({ title: 'No matches', text: 'Nothing in ExerciseDB matched that search.', iconPath: ICONS.search }));
        return;
      }
      for (const remote of list) results.append(remoteRow(remote));
    } catch (err) {
      status.hidden = false;
      status.textContent = err.message;
    }
  }, 350);

  function run() {
    if (state.source === 'remote') { runRemote(); return; }
    status.hidden = true;
    results.innerHTML = '';
    const list = searchLocal(state.query, state.bodyPart)
      .filter((e) => !state.equipment || e.equipment === state.equipment);
    if (!list.length) {
      results.append(emptyState({
        title: 'Nothing here',
        text: 'Search ExerciseDB for the movement, or create your own exercise.',
        iconPath: ICONS.search,
        action: el('button', { class: 'btn btn-ghost', type: 'button', text: 'Search ExerciseDB', onclick: () => setSource('remote') }),
      }));
      return;
    }
    for (const exercise of list) results.append(localRow(exercise));
  }

  function localRow(exercise) {
    return el('button', { class: 'row', type: 'button', onclick: () => openDetail(exercise.id) },
      thumb(exercise),
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title', text: exercise.name }),
        el('div', { class: 'row-sub', text: [exercise.target, exercise.equipment].filter(Boolean).join(' · ') })),
      icon(ICONS.chevron, { class: 'chev' }));
  }

  function remoteRow(remote) {
    return el('button', {
      class: 'row', type: 'button',
      onclick: () => { const rec = adoptRemote(remote); openDetail(rec.id); },
    },
      thumb({ name: remote.name, media: { imageUrl: remote.imageUrl } }),
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title', text: remote.name }),
        el('div', { class: 'row-sub', text: [remote.targets[0], remote.equipments[0]].filter(Boolean).join(' · ') })),
      icon(ICONS.chevron, { class: 'chev' }));
  }

  function openDetail(id) {
    const active = settings.active;
    openExerciseDetail(id, {
      onAdd: active ? (exerciseId) => {
        active.entries.push({
          exerciseId, note: '', restSec: settings.restDefault,
          sets: [{ weight: '', reps: '', done: false, warmup: false }],
        });
        saveSettings('active');
        toast(`Added to workout`, 'ok');
        navigate('workout');
      } : null,
    });
  }

  input.addEventListener('input', (e) => { state.query = e.target.value; run(); });

  root.append(
    el('div', { class: 'search-wrap' }, icon(ICONS.search), input),
    sourceTabs,
    partChips,
    equipChips,
    el('div', { class: 'flex', style: { marginTop: '12px', gap: '8px' } },
      el('button', { class: 'btn btn-ghost btn-sm grow', type: 'button', onclick: async () => { await createExerciseSheet(); run(); } },
        icon(ICONS.plus), 'New exercise'),
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: manageCustom }, 'Manage mine')),
    status,
    results);

  run();

  function manageCustom() {
    const custom = allExercises().filter((e) => !e.builtin);
    if (!custom.length) { toast('You have no custom exercises yet'); return; }
    menuSheet('Your exercises', custom.map((exercise) => ({
      label: exercise.name,
      onPick: () => menuSheet(exercise.name, [
        { label: 'Open', onPick: () => openDetail(exercise.id) },
        { label: 'Delete', danger: true, onPick: () => { deleteExercise(exercise.id); toast('Deleted'); run(); } },
      ]),
    })));
  }
}
