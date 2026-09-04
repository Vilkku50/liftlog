/* The logging screen — the one that has to work with one thumb, mid-set,
   without thinking. Everything else in the app exists to feed this view. */

import {
  el, icon, ICONS, fmtClock, fmtNum, fmtDate, toast, buzz,
  openSheet, confirmSheet, promptSheet, menuSheet, emptyState,
} from '../util.js';
import {
  settings, saveSettings, exerciseById, exerciseName, previousSets,
  finishWorkout, discardWorkout, e1rm, num, personalRecords, workoutVolume, workoutSetCount,
} from '../state.js';
import { pickExercises } from '../picker.js';
import { openExerciseDetail } from '../exercise-detail.js';
import { startRest, stopRest, primeAudio } from '../rest.js';
import { navigate } from '../router.js';

export const meta = {
  title: () => settings.active?.name || 'Workout',
  sub: () => (settings.active ? 'In progress' : ''),
};

export function render(root) {
  const active = settings.active;
  if (!active) {
    root.append(emptyState({
      title: 'No workout in progress',
      text: 'Start an empty session or pick one of your routines.',
      iconPath: ICONS.dumbbell,
      action: el('button', { class: 'btn btn-primary', type: 'button', text: 'Go to Home', onclick: () => navigate('home') }),
    }));
    return null;
  }

  // Records that existed before this session, so a PR badge means "beaten today".
  const baseline = new Map();

  const timerEl = el('div', { class: 'wk-timer mono', text: '0:00' });
  const statsEl = el('div', { class: 'row-sub' });
  const list = el('div', {});

  const head = el('div', { class: 'wk-head' },
    el('div', { class: 'grow', onclick: renameWorkout, style: { cursor: 'pointer' } },
      el('div', { class: 'flex', style: { gap: '8px' } }, timerEl),
      statsEl),
    el('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Workout options', onclick: openMenu }, icon(ICONS.dots)),
    el('button', { class: 'btn btn-sm btn-success', type: 'button', text: 'Finish', onclick: finish }));

  root.append(head, list,
    el('button', { class: 'btn btn-primary btn-block btn-lg', type: 'button', style: { marginTop: '4px' }, onclick: addExercise },
      icon(ICONS.plus), 'Add exercise'),
    el('button', { class: 'btn btn-danger btn-block', type: 'button', style: { marginTop: '10px' }, onclick: cancel },
      'Discard workout'),
    el('div', { style: { height: '70px' } }));

  renderEntries();
  updateHeader();
  const clock = setInterval(updateHeader, 1000);

  /* ---------- header ---------- */

  function elapsed() {
    return (Date.now() - new Date(active.startedAt)) / 1000;
  }

  function updateHeader() {
    timerEl.textContent = fmtClock(elapsed());
    const done = active.entries.flatMap((e) => e.sets.filter((s) => s.done));
    const volume = done.reduce((sum, s) => sum + num(s.weight) * num(s.reps), 0);
    statsEl.textContent = `${done.length} set${done.length === 1 ? '' : 's'} · ${Math.round(volume)} ${settings.unit} volume`;
  }

  async function renameWorkout() {
    const name = await promptSheet({ title: 'Workout name', label: 'Name', value: active.name });
    if (name) {
      active.name = name;
      saveSettings('active');
      document.getElementById('view-title').textContent = name;
      updateHeader();
    }
  }

  function openMenu() {
    menuSheet('Workout options', [
      { label: 'Rename workout', onPick: renameWorkout },
      { label: active.note ? 'Edit session note' : 'Add session note', onPick: editNote },
      { label: 'Discard workout', danger: true, onPick: cancel },
    ]);
  }

  async function editNote() {
    const note = await promptSheet({ title: 'Session note', label: 'Note', value: active.note, multiline: true });
    if (note !== null) { active.note = note; saveSettings('active'); }
  }

  /* ---------- entries ---------- */

  function renderEntries() {
    list.innerHTML = '';
    if (!active.entries.length) {
      list.append(emptyState({
        title: 'Empty session',
        text: 'Add the first exercise to start logging sets.',
        iconPath: ICONS.plus,
      }));
      return;
    }
    active.entries.forEach((entry, index) => list.append(exerciseCard(entry, index)));
  }

  function exerciseCard(entry, index) {
    const exercise = exerciseById(entry.exerciseId);
    const name = exercise?.name || 'Unknown exercise';
    if (!baseline.has(entry.exerciseId)) baseline.set(entry.exerciseId, personalRecords(entry.exerciseId));

    const prev = previousSets(entry.exerciseId);
    const body = el('tbody', {});
    const card = el('div', { class: 'ex-card' },
      el('div', { class: 'ex-head' },
        el('div', { class: 'ex-thumb', text: name.charAt(0).toUpperCase(), onclick: () => openExerciseDetail(entry.exerciseId) }),
        el('div', { class: 'grow', onclick: () => openExerciseDetail(entry.exerciseId) },
          el('div', { class: 'ex-name', text: name }),
          el('div', { class: 'ex-meta', text: prev ? `Last time ${fmtDate(prev.at)}` : 'First time logging this' })),
        el('button', {
          class: 'icon-btn plain', type: 'button', 'aria-label': `Options for ${name}`,
          onclick: () => exerciseMenu(entry, index),
        }, icon(ICONS.dots))),
      entry.note ? el('div', { class: 'ex-note' }, el('div', { class: 'small muted', text: entry.note })) : null,
      el('table', { class: 'set-table' },
        el('thead', {}, el('tr', {},
          el('th', { text: 'Set' }),
          el('th', { text: 'Previous' }),
          el('th', { text: settings.unit }),
          el('th', { text: 'Reps' }),
          el('th', { text: '' }))),
        body),
      el('div', { class: 'ex-actions' },
        el('button', { class: 'btn btn-sm btn-ghost', type: 'button', onclick: () => addSet(entry) }, icon(ICONS.plus), 'Add set')));

    entry.sets.forEach((set, i) => body.append(setRow(entry, set, i, prev)));
    return card;
  }

  function setRow(entry, set, index, prev) {
    const workingIndex = entry.sets.slice(0, index + 1).filter((s) => !s.warmup).length;
    const prevSet = prev?.sets?.filter((s) => !s.warmup)[workingIndex - 1];

    const weight = el('input', {
      class: 'set-in', type: 'text', inputmode: 'decimal', value: set.weight,
      placeholder: prevSet ? fmtNum(prevSet.weight) : '0',
      oninput: (e) => { set.weight = e.target.value; saveSettings('active'); },
    });
    const reps = el('input', {
      class: 'set-in', type: 'text', inputmode: 'numeric', value: set.reps,
      placeholder: prevSet ? String(prevSet.reps) : '0',
      oninput: (e) => { set.reps = e.target.value; saveSettings('active'); },
    });

    const row = el('tr', { class: `set-row${set.done ? ' done' : ''}` },
      el('td', {}, el('button', {
        class: `set-idx${set.warmup ? ' warm' : ''}`, type: 'button',
        text: set.warmup ? 'W' : String(workingIndex),
        onclick: () => setMenu(entry, set, index),
      })),
      el('td', {}, el('div', { class: 'set-prev', text: prevSet ? `${fmtNum(prevSet.weight)}×${prevSet.reps}` : '—' })),
      el('td', {}, weight),
      el('td', {}, reps),
      el('td', {}, el('button', {
        class: 'set-check', type: 'button', 'aria-label': 'Complete set',
        onclick: () => toggleDone(entry, set, row, weight, reps),
      }, icon(ICONS.check))));
    return row;
  }

  function toggleDone(entry, set, row, weightInput, repsInput) {
    primeAudio();
    if (!set.done) {
      // Empty fields adopt the placeholder (last time's numbers) so a repeat
      // set is one tap rather than two keyboards.
      if (!String(set.weight).trim()) set.weight = weightInput.placeholder === '0' ? '0' : weightInput.placeholder;
      if (!String(set.reps).trim()) set.reps = repsInput.placeholder === '0' ? '' : repsInput.placeholder;
      if (!String(set.reps).trim()) { toast('Enter the reps first', 'err'); repsInput.focus(); return; }
      weightInput.value = set.weight;
      repsInput.value = set.reps;
      set.done = true;
      row.classList.add('done');
      if (settings.vibrate) buzz(14);
      checkPr(entry, set);
      if (settings.restAuto && !set.warmup) startRest(entry.restSec || settings.restDefault);
    } else {
      set.done = false;
      row.classList.remove('done');
    }
    saveSettings('active');
    updateHeader();
  }

  function checkPr(entry, set) {
    if (set.warmup) return;
    const before = baseline.get(entry.exerciseId);
    const weight = num(set.weight), reps = num(set.reps);
    if (!before) {
      if (weight > 0) toast(`First log for ${exerciseName(entry.exerciseId)}`);
      return;
    }
    const est = e1rm(weight, reps);
    const bestBefore = e1rm(before.best1rm.weight, before.best1rm.reps);
    if (est > bestBefore * 1.001) {
      toast(`New PR · est. 1RM ${fmtNum(est, 0)} ${settings.unit}`, 'ok');
      buzz([20, 60, 20]);
      baseline.set(entry.exerciseId, { ...before, best1rm: { weight, reps } });
    } else if (weight > before.heaviest.weight) {
      toast(`Heaviest ever: ${fmtNum(weight)} ${settings.unit}`, 'ok');
      baseline.set(entry.exerciseId, { ...before, heaviest: { weight, reps } });
    }
  }

  function addSet(entry) {
    const last = entry.sets[entry.sets.length - 1];
    entry.sets.push({ weight: last ? last.weight : '', reps: last ? last.reps : '', done: false, warmup: false });
    saveSettings('active');
    renderEntries();
  }

  function setMenu(entry, set, index) {
    menuSheet(`Set ${index + 1}`, [
      { label: set.warmup ? 'Make it a working set' : 'Mark as warm-up', onPick: () => { set.warmup = !set.warmup; saveSettings('active'); renderEntries(); } },
      { label: 'Delete set', danger: true, onPick: () => { entry.sets.splice(index, 1); saveSettings('active'); renderEntries(); } },
    ]);
  }

  function exerciseMenu(entry, index) {
    menuSheet(exerciseName(entry.exerciseId), [
      { label: 'View instructions & animation', onPick: () => openExerciseDetail(entry.exerciseId) },
      { label: entry.note ? 'Edit note' : 'Add note', onPick: async () => {
        const note = await promptSheet({ title: 'Exercise note', label: 'Note', value: entry.note, multiline: true });
        if (note !== null) { entry.note = note; saveSettings('active'); renderEntries(); }
      } },
      { label: 'Rest timer for this exercise', onPick: async () => {
        const value = await promptSheet({ title: 'Rest', label: 'Seconds between sets', value: String(entry.restSec || settings.restDefault) });
        if (value) { entry.restSec = Math.max(0, parseInt(value, 10) || 0); saveSettings('active'); }
      } },
      index > 0 ? { label: 'Move up', onPick: () => { swap(index, index - 1); } } : null,
      index < active.entries.length - 1 ? { label: 'Move down', onPick: () => { swap(index, index + 1); } } : null,
      { label: 'Remove exercise', danger: true, onPick: () => {
        active.entries.splice(index, 1);
        saveSettings('active');
        renderEntries();
      } },
    ]);
  }

  function swap(a, b) {
    [active.entries[a], active.entries[b]] = [active.entries[b], active.entries[a]];
    saveSettings('active');
    renderEntries();
  }

  async function addExercise() {
    const ids = await pickExercises({ title: 'Add exercise' });
    if (!ids.length) return;
    for (const id of ids) {
      active.entries.push({
        exerciseId: id,
        note: '',
        restSec: settings.restDefault,
        sets: [{ weight: '', reps: '', done: false, warmup: false }],
      });
    }
    saveSettings('active');
    renderEntries();
  }

  /* ---------- finish / discard ---------- */

  async function finish() {
    const done = active.entries.flatMap((e) => e.sets.filter((s) => s.done));
    if (!done.length) {
      const discard = await confirmSheet({
        title: 'Nothing logged',
        message: 'No sets were completed. Discard this session?',
        confirmLabel: 'Discard', danger: true,
      });
      if (discard) { stopRest(); discardWorkout(); navigate('home'); }
      return;
    }
    const unfinished = active.entries.flatMap((e) => e.sets.filter((s) => !s.done)).length;
    const ok = await confirmSheet({
      title: 'Finish workout',
      message: unfinished
        ? `${done.length} sets logged. ${unfinished} unchecked set${unfinished === 1 ? '' : 's'} will be dropped.`
        : `${done.length} sets logged. Save this session?`,
      confirmLabel: 'Finish',
    });
    if (!ok) return;
    stopRest();
    const record = finishWorkout();
    navigate('home');
    if (record) summarySheet(record);
  }

  async function cancel() {
    const ok = await confirmSheet({
      title: 'Discard workout',
      message: 'Everything logged in this session will be lost.',
      confirmLabel: 'Discard', danger: true,
    });
    if (ok) { stopRest(); discardWorkout(); navigate('home'); }
  }

  return () => clearInterval(clock);
}

/** Post-workout summary — the small reward that makes logging worth it. */
export function summarySheet(record) {
  const duration = Math.max(0, (new Date(record.finishedAt) - new Date(record.startedAt)) / 1000);
  openSheet({ title: 'Workout saved' }, (api) => {
    api.setFooter(el('button', { class: 'btn btn-primary btn-block', type: 'button', text: 'Done', onclick: () => api.close() }));
    return el('div', {},
      el('div', { class: 'stat-grid' },
        el('div', { class: 'stat' },
          el('div', { class: 'stat-val' }, fmtClock(duration)),
          el('div', { class: 'stat-key', text: 'Duration' })),
        el('div', { class: 'stat' },
          el('div', { class: 'stat-val' }, String(workoutSetCount(record))),
          el('div', { class: 'stat-key', text: 'Sets' })),
        el('div', { class: 'stat' },
          el('div', { class: 'stat-val' }, String(Math.round(workoutVolume(record))), el('small', { text: settings.unit })),
          el('div', { class: 'stat-key', text: 'Volume' }))),
      el('div', { class: 'stack', style: { marginTop: '14px' } },
        ...record.entries.map((entry) => el('div', { class: 'flex-between small', style: { padding: '7px 2px', borderBottom: '1px solid var(--line-soft)' } },
          el('span', { class: 'grow', text: exerciseName(entry.exerciseId) }),
          el('span', { class: 'muted mono', text: `${entry.sets.length} × ${bestSet(entry)}` })))));
  });
}

function bestSet(entry) {
  const best = entry.sets.reduce((a, b) => (e1rm(b.weight, b.reps) > e1rm(a.weight, a.reps) ? b : a), entry.sets[0]);
  return `${fmtNum(best.weight)}×${best.reps}`;
}
