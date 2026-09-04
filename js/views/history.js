/* History and stats. Two tabs on one route: the log of what happened, and the
   numbers that say whether it is adding up to anything. */

import {
  el, icon, ICONS, fmtDate, fmtTime, fmtDuration, fmtVolume, fmtNum, monthKey, monthLabel,
  barChart, hBars, weekStart, openSheet, confirmSheet, emptyState,
} from '../util.js';
import {
  settings, finishedWorkouts, deleteWorkout, exerciseById, exerciseName,
  workoutVolume, workoutSetCount, workoutDuration, workingSets, e1rm, allExercises, setsForExercise,
} from '../state.js';
import { historyBlock } from '../exercise-detail.js';
import { navigate } from '../router.js';

export const meta = { title: 'History' };

export function render(root, params = {}) {
  const workouts = finishedWorkouts();
  let tab = params.tab === 'stats' ? 'stats' : 'log';

  const panel = el('div', { style: { marginTop: '14px' } });
  const tabs = el('div', { class: 'segmented' },
    el('button', { type: 'button', class: tab === 'log' ? 'on' : '', text: 'Log', onclick: () => setTab('log') }),
    el('button', { type: 'button', class: tab === 'stats' ? 'on' : '', text: 'Stats', onclick: () => setTab('stats') }));

  function setTab(next) {
    tab = next;
    [...tabs.children].forEach((b, i) => b.classList.toggle('on', (i === 0) === (next === 'log')));
    panel.innerHTML = '';
    panel.append(next === 'log' ? logPanel(workouts) : statsPanel(workouts));
  }

  root.append(tabs, panel);
  setTab(tab);

  if (params.open) {
    const workout = workouts.find((w) => w.id === params.open);
    if (workout) openWorkout(workout);
  }
}

/* ---------- log ----------------------------------------------------------- */

function logPanel(workouts) {
  if (!workouts.length) {
    return emptyState({
      title: 'No workouts yet',
      text: 'Finish your first session and it will be listed here, month by month.',
      iconPath: ICONS.clock,
    });
  }
  const wrap = el('div', {});
  let month = '';
  for (const workout of workouts) {
    const key = monthKey(workout.startedAt);
    if (key !== month) {
      month = key;
      const monthly = workouts.filter((w) => monthKey(w.startedAt) === key);
      wrap.append(el('div', { class: 'section-head', style: { marginTop: '18px' } },
        el('h2', { text: monthLabel(key) }),
        el('span', { class: 'small muted', text: `${monthly.length} workout${monthly.length === 1 ? '' : 's'}` })));
    }
    wrap.append(el('button', { class: 'row', type: 'button', onclick: () => openWorkout(workout) },
      el('div', { class: 'row-main' },
        el('div', { class: 'row-title', text: workout.name }),
        el('div', { class: 'row-sub', text: `${fmtDate(workout.startedAt)} · ${workoutSetCount(workout)} sets · ${fmtDuration(workoutDuration(workout))}` })),
      el('div', { class: 'row-side mono', text: `${fmtVolume(workoutVolume(workout))} ${settings.unit}` }),
      icon(ICONS.chevron, { class: 'chev' })));
  }
  return wrap;
}

export function openWorkout(workout) {
  openSheet({ title: workout.name, tall: true }, (api) => {
    api.setFooter(el('button', {
      class: 'btn btn-danger btn-block', type: 'button', text: 'Delete workout',
      onclick: async () => {
        if (await confirmSheet({ title: 'Delete workout', message: 'This session will be removed from your history.', confirmLabel: 'Delete', danger: true })) {
          deleteWorkout(workout.id);
          api.close();
          navigate('history');
        }
      },
    }));

    return el('div', {},
      el('div', { class: 'small muted', text: `${fmtDate(workout.startedAt, { absolute: true })} · ${fmtTime(workout.startedAt)}` }),
      el('div', { class: 'stat-grid', style: { marginTop: '12px' } },
        st(fmtDuration(workoutDuration(workout)), '', 'Duration'),
        st(String(workoutSetCount(workout)), '', 'Sets'),
        st(fmtVolume(workoutVolume(workout)), settings.unit, 'Volume')),
      workout.note ? el('div', { class: 'pill-info', style: { marginTop: '12px' }, text: workout.note }) : null,
      el('div', { style: { marginTop: '16px' } }, ...workout.entries.map((entry) =>
        el('div', { class: 'card', style: { marginBottom: '8px' } },
          el('div', { class: 'ex-name', text: exerciseName(entry.exerciseId) }),
          entry.note ? el('div', { class: 'small muted', style: { marginTop: '3px' }, text: entry.note }) : null,
          el('div', { class: 'stack', style: { marginTop: '8px' } },
            ...entry.sets.map((set, i) => el('div', { class: 'flex-between small' },
              el('span', { class: 'muted', text: set.warmup ? 'Warm-up' : `Set ${i + 1}` }),
              el('span', { class: 'mono', text: `${fmtNum(set.weight)} ${settings.unit} × ${set.reps}` }))))))));
  });
}

const st = (value, unit, key) =>
  el('div', { class: 'stat' },
    el('div', { class: 'stat-val' }, value, unit ? el('small', { text: unit }) : null),
    el('div', { class: 'stat-key', text: key }));

/* ---------- stats --------------------------------------------------------- */

function statsPanel(workouts) {
  if (!workouts.length) {
    return emptyState({ title: 'Nothing to measure yet', text: 'Stats appear once you have logged a session.', iconPath: ICONS.flame });
  }
  const wrap = el('div', {});
  const now = new Date();
  const monthCount = workouts.filter((w) => monthKey(w.startedAt) === monthKey(now.toISOString())).length;

  wrap.append(el('div', { class: 'stat-grid' },
    st(String(workouts.length), '', 'Workouts'),
    st(String(monthCount), '', 'This month'),
    st(String(streakWeeks(workouts)), '', 'Week streak')));

  /* Volume per week, three months back. */
  const weeks = [];
  const start = weekStart(now);
  for (let i = 11; i >= 0; i--) {
    const from = new Date(start);
    from.setDate(from.getDate() - i * 7);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    const value = workouts.filter((w) => { const d = new Date(w.startedAt); return d >= from && d < to; })
      .reduce((sum, w) => sum + workoutVolume(w), 0);
    weeks.push({ label: i === 0 ? 'now' : i % 3 === 0 ? `-${i}w` : '', value, muted: value === 0 });
  }
  wrap.append(el('div', { class: 'section' },
    el('div', { class: 'section-head' }, el('h2', { text: `Weekly volume (${settings.unit})` })),
    el('div', { class: 'card', style: { padding: '12px 8px 4px' } }, barChart(weeks, { height: 130 }))));

  /* Where the work actually went, last 28 days. */
  const since = new Date(now);
  since.setDate(since.getDate() - 28);
  const recent = workouts.filter((w) => new Date(w.startedAt) >= since);
  const byPart = new Map();
  for (const w of recent) {
    for (const set of workingSets(w)) {
      const part = exerciseById(set.exerciseId)?.bodyPart || 'Other';
      byPart.set(part, (byPart.get(part) || 0) + 1);
    }
  }
  const parts = [...byPart.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  if (parts.length) {
    wrap.append(el('div', { class: 'section' },
      el('div', { class: 'section-head' },
        el('h2', { text: 'Sets per body part' }),
        el('span', { class: 'small muted', text: 'last 28 days' })),
      el('div', { class: 'card' }, hBars(parts))));
  }

  /* Per-exercise progression. */
  const trained = [...new Set(workouts.flatMap((w) => w.entries.map((e) => e.exerciseId)))]
    .map((id) => exerciseById(id))
    .filter(Boolean)
    .sort((a, b) => setsForExercise(b.id).length - setsForExercise(a.id).length);

  if (trained.length) {
    const detail = el('div', { style: { marginTop: '10px' } });
    const select = el('select', { class: 'select', onchange: (e) => showExercise(e.target.value) },
      ...trained.map((ex) => el('option', { value: ex.id, text: ex.name })));

    function showExercise(id) {
      detail.innerHTML = '';
      detail.append(historyBlock(id));
    }

    wrap.append(el('div', { class: 'section' },
      el('div', { class: 'section-head' }, el('h2', { text: 'Exercise progress' })),
      select, detail));
    showExercise(trained[0].id);
  }

  /* All-time bests, ranked by estimated 1RM. */
  const prs = allExercises()
    .map((ex) => {
      const sets = setsForExercise(ex.id);
      if (!sets.length) return null;
      const best = sets.reduce((a, b) => (e1rm(b.weight, b.reps) > e1rm(a.weight, a.reps) ? b : a));
      return { name: ex.name, weight: best.weight, reps: best.reps, est: e1rm(best.weight, best.reps), at: best.at };
    })
    .filter(Boolean)
    .sort((a, b) => b.est - a.est)
    .slice(0, 12);

  if (prs.length) {
    wrap.append(el('div', { class: 'section' },
      el('div', { class: 'section-head' },
        el('h2', { text: 'Personal records' }),
        el('span', { class: 'small muted', text: 'best est. 1RM' })),
      el('div', { class: 'card' }, el('div', { class: 'stack' },
        ...prs.map((pr) => el('div', { class: 'flex-between', style: { padding: '6px 0', borderBottom: '1px solid var(--line-soft)' } },
          el('div', { class: 'grow', style: { minWidth: 0 } },
            el('div', { class: 'small', style: { fontWeight: '600' }, text: pr.name }),
            el('div', { class: 'small muted', text: `${fmtNum(pr.weight)} ${settings.unit} × ${pr.reps} · ${fmtDate(pr.at)}` })),
          el('div', { class: 'mono', style: { fontWeight: '700' }, text: `${fmtNum(pr.est, 0)}` })))))));
  }

  return wrap;
}

/** Consecutive weeks, counting back from this one, containing at least one workout. */
function streakWeeks(workouts) {
  const weeks = new Set(workouts.map((w) => weekStart(new Date(w.startedAt)).getTime()));
  let streak = 0;
  const cursor = weekStart(new Date());
  // This week not yet trained should not break a streak that is otherwise alive.
  if (!weeks.has(cursor.getTime())) cursor.setDate(cursor.getDate() - 7);
  while (weeks.has(cursor.getTime())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 7);
  }
  return streak;
}
