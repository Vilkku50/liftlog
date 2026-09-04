/* Exercise picker — one shared sheet used by the workout logger, the routine
   editor and the library. Searches the built-in catalogue instantly and, when
   ExerciseDB is connected, the 11k-exercise online catalogue as a second tab. */

import { el, icon, ICONS, debounce, initials, toast, openSheet, emptyState } from './util.js';
import { allExercises, upsertExercise } from './state.js';
import { BODY_PARTS, EQUIPMENT, slugify } from './seed.js';
import * as edb from './edb.js';

/** Local catalogue search: name, muscle and equipment all match. */
export function searchLocal(query, bodyPart = '') {
  const q = query.trim().toLowerCase();
  return allExercises()
    .filter((e) => !bodyPart || e.bodyPart === bodyPart)
    .filter((e) => !q || `${e.name} ${e.target} ${e.equipment}`.toLowerCase().includes(q))
    .sort((a, b) => {
      if (q) {
        const ai = a.name.toLowerCase().startsWith(q) ? 0 : 1;
        const bi = b.name.toLowerCase().startsWith(q) ? 0 : 1;
        if (ai !== bi) return ai - bi;
      }
      return a.name.localeCompare(b.name);
    });
}

/** Store an ExerciseDB result in the local catalogue so logs keep working offline. */
export function adoptRemote(remote) {
  const id = remote.edbId ? `edb-${remote.edbId}` : slugify(remote.name);
  return upsertExercise({
    id,
    name: remote.name,
    bodyPart: mapBodyPart(remote.bodyParts[0] || ''),
    target: remote.targets[0] || '',
    equipment: mapEquipment(remote.equipments[0] || ''),
    edbId: remote.edbId,
    media: { imageUrl: remote.imageUrl, videoUrl: remote.videoUrl },
  });
}

function mapBodyPart(name) {
  const n = name.toLowerCase();
  if (/chest|pector/.test(n)) return 'Chest';
  if (/back|lat|trap|spine/.test(n)) return 'Back';
  if (/leg|quad|hamstring|glute|calf|thigh/.test(n)) return 'Legs';
  if (/shoulder|delt/.test(n)) return 'Shoulders';
  if (/arm|bicep|tricep|forearm/.test(n)) return 'Arms';
  if (/waist|abs|core|oblique/.test(n)) return 'Core';
  if (/cardio/.test(n)) return 'Cardio';
  return 'Other';
}

function mapEquipment(name) {
  const n = name.toLowerCase();
  if (/barbell|ez|smith/.test(n)) return 'Barbell';
  if (/dumbbell/.test(n)) return 'Dumbbell';
  if (/cable/.test(n)) return 'Cable';
  if (/leverage|machine|sled|lever/.test(n)) return 'Machine';
  if (/body ?weight|assisted/.test(n)) return 'Bodyweight';
  if (/kettlebell/.test(n)) return 'Kettlebell';
  return 'Other';
}

/**
 * Open the picker. Resolves with an array of local exercise ids (empty if the
 * sheet was dismissed).
 */
export function pickExercises({ title = 'Add exercise', multi = true } = {}) {
  return new Promise((resolve) => {
    const chosen = new Map();

    // Remote picks are copied into the local catalogue before they are returned,
    // so a logged set keeps its exercise name with no key and no network.
    const finish = (ids) => resolve(ids.map((id) => {
      const item = chosen.get(id);
      return item?.remote ? adoptRemote(item.remote).id : id;
    }));

    let source = 'local';
    let bodyPart = '';
    let done = false;

    openSheet({ title, tall: true, onClose: () => { if (!done) finish([]); } }, (api) => {
      const input = el('input', { class: 'input', type: 'search', placeholder: 'Search exercises…', autocomplete: 'off' });
      const results = el('div', { class: 'stack', style: { marginTop: '10px' } });
      const status = el('div', { class: 'center muted small', style: { padding: '6px 0' }, hidden: true });

      const sourceTabs = el('div', { class: 'segmented', style: { marginTop: '10px' } },
        el('button', { type: 'button', class: 'on', text: 'My library', onclick: () => setSource('local') }),
        el('button', {
          type: 'button', text: 'ExerciseDB',
          onclick: () => {
            if (!edb.isReady()) { toast('Connect ExerciseDB in Settings first', 'err'); return; }
            setSource('remote');
          },
        }));

      const partChips = el('div', { class: 'chips', style: { marginTop: '10px' } },
        chip('All', true, () => setPart('')),
        ...BODY_PARTS.map((p) => chip(p, false, () => setPart(p))));

      function chip(label, on, onclick) {
        return el('button', { type: 'button', class: `chip${on ? ' on' : ''}`, text: label, onclick });
      }

      function setPart(part) {
        bodyPart = part;
        [...partChips.children].forEach((c) => c.classList.toggle('on', c.textContent === (part || 'All')));
        run();
      }

      function setSource(next) {
        source = next;
        [...sourceTabs.children].forEach((b, i) => b.classList.toggle('on', (i === 0) === (next === 'local')));
        run();
      }

      function commit() {
        done = true;
        api.close();
        finish([...chosen.keys()]);
      }

      function updateFooter() {
        if (!multi) { api.setFooter(); return; }
        api.setFooter(
          el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => api.close() }),
          el('button', {
            class: 'btn btn-primary', type: 'button',
            text: chosen.size ? `Add ${chosen.size}` : 'Add',
            disabled: chosen.size === 0,
            onclick: commit,
          }));
      }

      function pick(exercise) {
        if (!multi) { chosen.set(exercise.id, exercise); commit(); return; }
        if (chosen.has(exercise.id)) chosen.delete(exercise.id);
        else chosen.set(exercise.id, exercise);
        renderRows(lastRows);
        updateFooter();
      }

      let lastRows = [];
      function renderRows(rows) {
        lastRows = rows;
        results.innerHTML = '';
        if (!rows.length) {
          results.append(emptyState({
            title: 'Nothing found',
            text: source === 'local'
              ? 'Try another word, switch to ExerciseDB, or create your own exercise.'
              : 'No matches in ExerciseDB for that search.',
            iconPath: ICONS.search,
          }));
          return;
        }
        for (const item of rows) {
          const on = chosen.has(item.id);
          results.append(el('button', {
            class: 'row', type: 'button',
            style: on ? { borderColor: 'var(--accent-line)', background: 'var(--accent-soft)' } : {},
            onclick: () => pick(item),
          },
            el('div', { class: 'lib-thumb', text: initials(item.name) }),
            el('div', { class: 'row-main' },
              el('div', { class: 'row-title', text: item.name }),
              el('div', { class: 'row-sub', text: [item.target, item.equipment].filter(Boolean).join(' · ') })),
            on ? icon(ICONS.check, { class: 'chev' }) : icon(ICONS.plus, { class: 'chev' })));
        }
      }

      const runRemote = debounce(async (query) => {
        status.hidden = false;
        status.textContent = 'Searching ExerciseDB…';
        try {
          const list = await edb.search({ query, bodyPart, limit: 40 });
          status.hidden = true;
          renderRows(list.map((r) => ({
            id: `edb-${r.edbId}`, name: r.name,
            target: r.targets[0] || r.bodyParts[0] || '',
            equipment: r.equipments[0] || '',
            remote: r,
          })));
        } catch (err) {
          status.hidden = false;
          status.textContent = err.message;
          results.innerHTML = '';
        }
      }, 350);

      function run() {
        const query = input.value;
        if (source === 'local') {
          status.hidden = true;
          renderRows(searchLocal(query, bodyPart));
        } else {
          runRemote(query);
        }
      }

      input.addEventListener('input', run);

      setTimeout(() => input.focus(), 120);
      run();
      updateFooter();

      return el('div', {},
        el('div', { class: 'search-wrap' }, icon(ICONS.search), input),
        sourceTabs,
        partChips,
        status,
        results,
        el('button', {
          class: 'btn btn-ghost btn-block', type: 'button', style: { marginTop: '12px' },
          onclick: async () => {
            const created = await createExerciseSheet();
            if (created) { chosen.set(created.id, created); if (!multi) commit(); else { run(); updateFooter(); } }
          },
        }, icon(ICONS.plus), 'Create custom exercise'));
    });
  });
}

/** Small form for user-defined exercises (machines your gym has, odd variations). */
export function createExerciseSheet(existing = null) {
  return new Promise((resolve) => {
    let done = false;
    openSheet({ title: existing ? 'Edit exercise' : 'New exercise', onClose: () => { if (!done) resolve(null); } }, (api) => {
      const name = el('input', { class: 'input', value: existing?.name || '', placeholder: 'e.g. Hammer Strength Row' });
      const part = el('select', { class: 'select' }, ...['Chest', ...BODY_PARTS.filter((b) => b !== 'Chest'), 'Other']
        .filter((v, i, a) => a.indexOf(v) === i)
        .map((p) => el('option', { value: p, text: p, selected: existing?.bodyPart === p })));
      const equip = el('select', { class: 'select' }, ...EQUIPMENT
        .map((p) => el('option', { value: p, text: p, selected: existing?.equipment === p })));
      const target = el('input', { class: 'input', value: existing?.target || '', placeholder: 'e.g. Latissimus dorsi' });

      api.setFooter(
        el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => api.close() }),
        el('button', {
          class: 'btn btn-primary', type: 'button', text: 'Save',
          onclick: () => {
            if (!name.value.trim()) { toast('Give the exercise a name', 'err'); return; }
            const rec = upsertExercise({
              id: existing?.id,
              name: name.value.trim(),
              bodyPart: part.value,
              equipment: equip.value,
              target: target.value.trim(),
            });
            done = true;
            api.close();
            resolve(rec);
          },
        }));

      return el('div', {},
        el('label', { class: 'field' }, el('span', { class: 'label', text: 'Name' }), name),
        el('label', { class: 'field' }, el('span', { class: 'label', text: 'Body part' }), part),
        el('label', { class: 'field' }, el('span', { class: 'label', text: 'Equipment' }), equip),
        el('label', { class: 'field' }, el('span', { class: 'label', text: 'Primary muscle (optional)' }), target));
    });
  });
}
