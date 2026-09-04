/* The single source of truth.
 *
 * Everything the user creates lives in one JSON document in localStorage.
 * Records carry `updatedAt` and soft-delete tombstones so the GitHub sync in
 * sync.js can merge two devices without a server: newest write per record
 * wins, and deletions survive the merge instead of being resurrected.
 */

import { uid, nowIso, debounce } from './util.js';
import { SEED_EXERCISES } from './seed.js';

const KEY = 'liftlog.db.v1';
const SETTINGS_KEY = 'liftlog.settings.v1';
const SCHEMA = 1;

/** Synced document. Never put secrets in here — it is pushed to GitHub. */
export const db = {
  schema: SCHEMA,
  exercises: [],   // custom + adopted-from-ExerciseDB entries
  routines: [],
  workouts: [],    // finished workouts only
};

/** Device-local state. Holds tokens and the in-progress workout. Never synced. */
export const settings = {
  unit: 'kg',
  restDefault: 120,
  restAuto: true,
  sound: true,
  vibrate: true,
  keepAwake: true,
  plateStep: 2.5,
  edb: { host: '', key: '', basePath: '', searchStyle: '', mediaTemplate: '', videoTemplate: '', prefer: 'gif', videoHost: '', videoKey: '' },
  sync: { token: '', owner: '', repo: 'liftlog-data', path: 'liftlog.json', branch: 'main', enabled: false, lastSyncAt: '', sha: '' },
  active: null,     // workout in progress
  seeded: false,
};

const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(reason) {
  for (const fn of listeners) {
    try { fn(reason); } catch (err) { console.error('listener failed', err); }
  }
}

/* ---------- persistence -------------------------------------------------- */

const writeDb = debounce(() => {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (err) { console.error('Could not persist workout data', err); }
}, 250);

const writeSettings = debounce(() => {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
  catch (err) { console.error('Could not persist settings', err); }
}, 250);

/** Persist + notify. `reason` lets listeners decide whether to sync/re-render. */
export function save({ sync = true, reason = 'change' } = {}) {
  writeDb();
  writeSettings();
  emit(reason);
  if (sync) emit('dirty');
}

export function saveSettings(reason = 'settings') {
  writeSettings();
  emit(reason);
}

export function flushWrites() {
  writeDb.flush();
  writeSettings.flush();
}

function deepAssign(target, source) {
  for (const [k, v] of Object.entries(source || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') {
      deepAssign(target[k], v);
    } else if (v !== undefined) {
      target[k] = v;
    }
  }
}

export function loadAll() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      db.schema = parsed.schema || SCHEMA;
      db.exercises = parsed.exercises || [];
      db.routines = parsed.routines || [];
      db.workouts = parsed.workouts || [];
    }
  } catch (err) { console.error('Corrupt workout data, starting fresh', err); }

  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) deepAssign(settings, JSON.parse(raw));
  } catch (err) { console.error('Corrupt settings, using defaults', err); }

  if (!settings.seeded && db.routines.length === 0 && db.workouts.length === 0) {
    seedStarterRoutines();
    settings.seeded = true;
    writeSettings();
  }
}

/** Replace the synced document wholesale (used after a sync merge). */
export function replaceDb(next) {
  db.exercises = next.exercises || [];
  db.routines = next.routines || [];
  db.workouts = next.workouts || [];
  writeDb();
  emit('replaced');
}

export function exportDoc() {
  return { schema: SCHEMA, exercises: db.exercises, routines: db.routines, workouts: db.workouts };
}

/* ---------- exercises ---------------------------------------------------- */

/** Built-in catalogue + user-created entries, tombstones removed. */
export function allExercises() {
  const custom = db.exercises.filter((e) => !e.deleted);
  const overridden = new Set(custom.map((e) => e.id));
  return [...SEED_EXERCISES.filter((e) => !overridden.has(e.id)), ...custom];
}

export function exerciseById(id) {
  return allExercises().find((e) => e.id === id) || null;
}

export function exerciseName(id) {
  return exerciseById(id)?.name || 'Unknown exercise';
}

/** Add (or update) an exercise the user created or adopted from ExerciseDB. */
export function upsertExercise(data) {
  const existing = data.id ? db.exercises.find((e) => e.id === data.id) : null;
  if (existing) {
    Object.assign(existing, data, { updatedAt: nowIso(), deleted: false });
    save();
    return existing;
  }
  const record = {
    id: data.id || uid(),
    name: data.name,
    bodyPart: data.bodyPart || 'Other',
    target: data.target || '',
    equipment: data.equipment || 'Other',
    edbId: data.edbId || '',
    media: data.media || null,
    custom: true,
    updatedAt: nowIso(),
  };
  db.exercises.push(record);
  save();
  return record;
}

export function deleteExercise(id) {
  const rec = db.exercises.find((e) => e.id === id);
  if (!rec) return;
  rec.deleted = true;
  rec.updatedAt = nowIso();
  save();
}

/* ---------- routines ----------------------------------------------------- */

export const activeRoutines = () => db.routines.filter((r) => !r.deleted);

export function upsertRoutine(data) {
  const existing = data.id ? db.routines.find((r) => r.id === data.id) : null;
  if (existing) {
    Object.assign(existing, data, { updatedAt: nowIso(), deleted: false });
    save();
    return existing;
  }
  const record = {
    id: uid(),
    name: data.name || 'New routine',
    note: data.note || '',
    items: data.items || [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  db.routines.push(record);
  save();
  return record;
}

export function deleteRoutine(id) {
  const rec = db.routines.find((r) => r.id === id);
  if (!rec) return;
  rec.deleted = true;
  rec.updatedAt = nowIso();
  save();
}

/* ---------- workouts ----------------------------------------------------- */

export const finishedWorkouts = () =>
  db.workouts.filter((w) => !w.deleted).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

export function deleteWorkout(id) {
  const rec = db.workouts.find((w) => w.id === id);
  if (!rec) return;
  rec.deleted = true;
  rec.updatedAt = nowIso();
  save();
}

/** Start a workout, optionally from a routine. Only one may be active. */
export function startWorkout(routine = null) {
  settings.active = {
    id: uid(),
    name: routine ? routine.name : 'Workout',
    routineId: routine ? routine.id : '',
    startedAt: nowIso(),
    note: '',
    entries: (routine?.items || []).map((item) => ({
      exerciseId: item.exerciseId,
      note: '',
      sets: Array.from({ length: Math.max(1, item.sets || 3) }, () => ({
        weight: '', reps: item.reps ? String(item.reps) : '', done: false, warmup: false,
      })),
      restSec: item.restSec || settings.restDefault,
    })),
  };
  saveSettings('active');
  return settings.active;
}

export function discardWorkout() {
  settings.active = null;
  saveSettings('active');
}

/** Move the active workout into history. Returns the stored record. */
export function finishWorkout() {
  const active = settings.active;
  if (!active) return null;
  const entries = active.entries
    .map((entry) => ({ ...entry, sets: entry.sets.filter((s) => s.done) }))
    .filter((entry) => entry.sets.length > 0);

  const record = {
    id: active.id,
    name: active.name,
    routineId: active.routineId,
    startedAt: active.startedAt,
    finishedAt: nowIso(),
    note: active.note,
    entries: entries.map((e) => ({
      exerciseId: e.exerciseId,
      note: e.note || '',
      sets: e.sets.map((s) => ({
        weight: num(s.weight),
        reps: num(s.reps),
        warmup: !!s.warmup,
      })),
    })),
    updatedAt: nowIso(),
  };
  db.workouts.push(record);
  settings.active = null;
  save({ reason: 'finished' });
  return record;
}

export const num = (v) => {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/* ---------- derived stats ------------------------------------------------ */

export const workingSets = (workout) =>
  workout.entries.flatMap((e) => e.sets.filter((s) => !s.warmup).map((s) => ({ ...s, exerciseId: e.exerciseId })));

export const workoutVolume = (workout) =>
  workingSets(workout).reduce((sum, s) => sum + s.weight * s.reps, 0);

export const workoutSetCount = (workout) => workingSets(workout).length;

export const workoutDuration = (workout) =>
  Math.max(0, (new Date(workout.finishedAt) - new Date(workout.startedAt)) / 1000);

/** Epley estimate. Reps of 1 return the lifted weight unchanged. */
export const e1rm = (weight, reps) => (reps > 0 ? weight * (1 + reps / 30) : 0);

/** Every logged working set for one exercise, newest first. */
export function setsForExercise(exerciseId) {
  const out = [];
  for (const w of finishedWorkouts()) {
    for (const entry of w.entries) {
      if (entry.exerciseId !== exerciseId) continue;
      for (const s of entry.sets) {
        if (!s.warmup) out.push({ ...s, at: w.startedAt, workoutId: w.id });
      }
    }
  }
  return out;
}

/** Personal records for one exercise: heaviest set, best estimated 1RM, best session volume. */
export function personalRecords(exerciseId) {
  const sets = setsForExercise(exerciseId);
  if (!sets.length) return null;
  let heaviest = sets[0], best1rm = sets[0];
  for (const s of sets) {
    if (s.weight > heaviest.weight || (s.weight === heaviest.weight && s.reps > heaviest.reps)) heaviest = s;
    if (e1rm(s.weight, s.reps) > e1rm(best1rm.weight, best1rm.reps)) best1rm = s;
  }
  const byWorkout = new Map();
  for (const s of sets) byWorkout.set(s.workoutId, (byWorkout.get(s.workoutId) || 0) + s.weight * s.reps);
  const bestVolume = Math.max(...byWorkout.values());
  return { heaviest, best1rm, bestVolume, totalSets: sets.length };
}

/** The sets logged for this exercise the previous time it was trained. */
export function previousSets(exerciseId, excludeWorkoutId = '') {
  for (const w of finishedWorkouts()) {
    if (w.id === excludeWorkoutId) continue;
    const entry = w.entries.find((e) => e.exerciseId === exerciseId);
    if (entry && entry.sets.length) return { sets: entry.sets, at: w.startedAt };
  }
  return null;
}

/* ---------- starter content ---------------------------------------------- */

function seedStarterRoutines() {
  const mk = (name, note, items) => ({
    id: uid(), name, note, items, createdAt: nowIso(), updatedAt: nowIso(),
  });
  db.routines.push(
    mk('Push · Chest, Shoulders, Triceps', 'Starter template — edit freely.', [
      { exerciseId: 'sx-barbell-bench-press', sets: 4, reps: 6, restSec: 180 },
      { exerciseId: 'sx-incline-dumbbell-press', sets: 3, reps: 10, restSec: 120 },
      { exerciseId: 'sx-seated-dumbbell-shoulder-press', sets: 3, reps: 10, restSec: 120 },
      { exerciseId: 'sx-cable-lateral-raise', sets: 3, reps: 15, restSec: 75 },
      { exerciseId: 'sx-triceps-pushdown', sets: 3, reps: 12, restSec: 75 },
    ]),
    mk('Pull · Back, Biceps', 'Starter template — edit freely.', [
      { exerciseId: 'sx-deadlift', sets: 3, reps: 5, restSec: 210 },
      { exerciseId: 'sx-pull-up', sets: 4, reps: 8, restSec: 150 },
      { exerciseId: 'sx-barbell-row', sets: 3, reps: 8, restSec: 150 },
      { exerciseId: 'sx-seated-cable-row', sets: 3, reps: 12, restSec: 105 },
      { exerciseId: 'sx-dumbbell-biceps-curl', sets: 3, reps: 12, restSec: 75 },
    ]),
    mk('Legs', 'Starter template — edit freely.', [
      { exerciseId: 'sx-back-squat', sets: 4, reps: 6, restSec: 210 },
      { exerciseId: 'sx-romanian-deadlift', sets: 3, reps: 10, restSec: 150 },
      { exerciseId: 'sx-leg-press', sets: 3, reps: 12, restSec: 120 },
      { exerciseId: 'sx-leg-curl', sets: 3, reps: 12, restSec: 90 },
      { exerciseId: 'sx-standing-calf-raise', sets: 4, reps: 15, restSec: 60 },
    ]),
  );
  writeDb();
}
