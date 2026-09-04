/* Home — what you came to do (start training) above everything you might want
   to read about (this week, recent sessions). */

import { el, icon, ICONS, fmtDate, fmtDuration, fmtVolume, barChart, weekStart, emptyState } from '../util.js';
import {
  settings, activeRoutines, finishedWorkouts,
  workoutVolume, workoutSetCount, workoutDuration, exerciseName,
} from '../state.js';
import { navigate } from '../router.js';
import { beginWorkout } from '../session.js';

export const meta = {
  title: 'LiftLog',
  sub: () => new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
};

export function render(root) {
  const workouts = finishedWorkouts();
  const routines = activeRoutines();

  root.append(el('button', {
    class: 'btn btn-primary btn-block btn-lg', type: 'button',
    onclick: () => beginWorkout(),
  }, icon(ICONS.plus), 'Start empty workout'));

  /* ---- routines ---- */
  root.append(el('div', { class: 'section' },
    el('div', { class: 'section-head' },
      el('h2', { text: 'Routines' }),
      el('button', { type: 'button', text: 'Manage', onclick: () => navigate('routines') })),
    routines.length
      ? el('div', {}, ...routines.slice(0, 4).map((routine) => el('button', {
        class: 'row', type: 'button',
        onclick: () => beginWorkout(routine),
      },
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title', text: routine.name }),
          el('div', { class: 'row-sub', text: routine.items.map((i) => exerciseName(i.exerciseId)).slice(0, 3).join(' · ') || 'No exercises yet' })),
        el('span', { class: 'chip on', text: 'Start' }))))
      : emptyState({
        title: 'No routines yet',
        text: 'Build a routine and every session starts pre-filled with your exercises and last numbers.',
        iconPath: ICONS.dumbbell,
        action: el('button', { class: 'btn btn-ghost', type: 'button', text: 'Create routine', onclick: () => navigate('routines') }),
      })));

  /* ---- this week ---- */
  const weekFrom = weekStart(new Date());
  const thisWeek = workouts.filter((w) => new Date(w.startedAt) >= weekFrom);
  const volume = thisWeek.reduce((sum, w) => sum + workoutVolume(w), 0);
  const sets = thisWeek.reduce((sum, w) => sum + workoutSetCount(w), 0);

  root.append(el('div', { class: 'section' },
    el('div', { class: 'section-head' },
      el('h2', { text: 'This week' }),
      el('button', { type: 'button', text: 'Stats', onclick: () => navigate('history', { tab: 'stats' }) })),
    el('div', { class: 'stat-grid' },
      tile(String(thisWeek.length), '', 'Workouts'),
      tile(String(sets), '', 'Sets'),
      tile(fmtVolume(volume), settings.unit, 'Volume')),
    weeklyChart(workouts)));

  /* ---- recent ---- */
  root.append(el('div', { class: 'section' },
    el('div', { class: 'section-head' },
      el('h2', { text: 'Recent workouts' }),
      workouts.length > 3 ? el('button', { type: 'button', text: 'All', onclick: () => navigate('history') }) : null),
    workouts.length
      ? el('div', {}, ...workouts.slice(0, 3).map((w) => el('button', {
        class: 'row', type: 'button', onclick: () => navigate('history', { open: w.id }),
      },
        el('div', { class: 'row-main' },
          el('div', { class: 'row-title', text: w.name }),
          el('div', { class: 'row-sub', text: `${fmtDate(w.startedAt)} · ${workoutSetCount(w)} sets · ${fmtDuration(workoutDuration(w))}` })),
        el('div', { class: 'row-side mono', text: `${fmtVolume(workoutVolume(w))} ${settings.unit}` }))))
      : el('p', { class: 'muted small center', style: { padding: '18px 0' }, text: 'Your finished sessions will appear here.' })));
}

const tile = (value, unit, key) =>
  el('div', { class: 'stat' },
    el('div', { class: 'stat-val' }, value, unit ? el('small', { text: unit }) : null),
    el('div', { class: 'stat-key', text: key }));

/** Eight-week volume trend — enough history to see a trend, few enough bars to read on a phone. */
function weeklyChart(workouts) {
  const weeks = [];
  const start = weekStart(new Date());
  for (let i = 7; i >= 0; i--) {
    const from = new Date(start);
    from.setDate(from.getDate() - i * 7);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    const value = workouts
      .filter((w) => { const d = new Date(w.startedAt); return d >= from && d < to; })
      .reduce((sum, w) => sum + workoutVolume(w), 0);
    weeks.push({ label: i === 0 ? 'now' : `-${i}w`, value, muted: value === 0 });
  }
  if (!weeks.some((w) => w.value > 0)) return null;
  return el('div', { class: 'card', style: { marginTop: '10px', padding: '12px 8px 4px' } },
    el('div', { class: 'stat-key', style: { padding: '0 6px 6px' }, text: `Weekly volume (${settings.unit})` }),
    barChart(weeks, { height: 120 }));
}
