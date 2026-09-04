/* Exercise detail sheet: the animation, how to perform it, and what you have
   personally lifted on it. Media loads lazily and degrades to a clear message
   instead of a broken image when ExerciseDB is not connected. */

import { el, icon, ICONS, openSheet, toast, fmtDate, fmtNum, lineChart, initials } from './util.js';
import { settings, exerciseById, personalRecords, setsForExercise, e1rm } from './state.js';
import * as edb from './edb.js';

const detailCache = new Map();

export function mediaBox(exercise, remote = null) {
  const box = el('div', { class: 'media-box' });
  const source = remote || (exercise?.media ? { edbId: exercise.edbId, ...exercise.media } : null);

  if (!edb.isReady()) {
    box.append(el('div', { class: 'media-note' },
      el('div', { style: { marginBottom: '8px' } }, icon(ICONS.dumbbell, { width: 1.4 })),
      'Connect ExerciseDB in Settings to see the movement animation here.'));
    return box;
  }
  if (!source || (!source.edbId && !source.imageUrl)) {
    box.append(el('div', { class: 'media-note' }, 'No animation linked to this exercise. Add it again from the ExerciseDB tab in the picker to attach one.'));
    return box;
  }

  box.append(el('div', { class: 'spinner' }));
  const kind = settings.edb.prefer === 'video' ? 'video' : 'gif';
  edb.mediaObjectUrl({ edbId: source.edbId, name: exercise?.name || '', imageUrl: source.imageUrl || '', videoUrl: source.videoUrl || '' }, kind)
    .then(async (objUrl) => {
      // The GIF edition is the primary source; fall back to the other format
      // rather than showing nothing when only one of the two has this movement.
      const finalUrl = objUrl || await edb.mediaObjectUrl(
        { edbId: source.edbId, name: exercise?.name || '', imageUrl: source.imageUrl || '', videoUrl: source.videoUrl || '' },
        kind === 'gif' ? 'video' : 'gif',
      );
      box.innerHTML = '';
      if (!finalUrl) {
        box.append(el('div', { class: 'media-note' }, 'Animation could not be loaded. Your plan may not include media for this exercise.'));
        return;
      }
      const isVideo = kind === 'video' || /\.mp4/i.test(source.videoUrl || '');
      box.append(isVideo && !objUrl
        ? el('img', { src: finalUrl, alt: exercise?.name || '' })
        : isVideo
          ? el('video', { src: finalUrl, autoplay: true, loop: true, muted: true, playsinline: true })
          : el('img', { src: finalUrl, alt: exercise?.name || '' }));
    });
  return box;
}

export function openExerciseDetail(exerciseId, { onAdd = null } = {}) {
  const exercise = exerciseById(exerciseId);
  if (!exercise) { toast('Exercise not found', 'err'); return; }

  openSheet({ title: exercise.name, tall: true }, (api) => {
    const body = el('div', {});
    const tags = el('div', { class: 'taglist', style: { marginTop: '12px' } },
      exercise.target ? el('span', { class: 'tag primary', text: exercise.target }) : null,
      el('span', { class: 'tag', text: exercise.bodyPart }),
      el('span', { class: 'tag', text: exercise.equipment }));

    const guide = el('div', { style: { marginTop: '16px' } });
    body.append(mediaBox(exercise), tags, guide, historyBlock(exerciseId));

    if (onAdd) {
      api.setFooter(el('button', {
        class: 'btn btn-primary btn-block', type: 'button',
        onclick: () => { api.close(); onAdd(exerciseId); },
      }, icon(ICONS.plus), 'Add to workout'));
    }

    if (exercise.edbId && edb.isReady()) loadGuide(exercise.edbId, guide);
    else if (!exercise.edbId) {
      guide.append(el('p', { class: 'muted small', text: 'Step-by-step instructions come from ExerciseDB. Add this movement from the ExerciseDB tab in the exercise picker to link them.' }));
    }
    return body;
  });
}

async function loadGuide(edbId, container) {
  container.append(el('div', { class: 'spinner' }));
  try {
    let detail = detailCache.get(edbId);
    if (!detail) {
      detail = await edb.getById(edbId);
      if (detail) detailCache.set(edbId, detail);
    }
    container.innerHTML = '';
    if (!detail) { container.append(el('p', { class: 'muted small', text: 'No details returned for this exercise.' })); return; }

    if (detail.secondary?.length) {
      container.append(el('div', { class: 'taglist', style: { marginBottom: '14px' } },
        ...detail.secondary.slice(0, 6).map((m) => el('span', { class: 'tag', text: m }))));
    }
    if (detail.overview) container.append(el('p', { class: 'small muted', style: { lineHeight: '1.55' }, text: detail.overview }));
    if (detail.instructions.length) {
      container.append(section('How to perform'));
      container.append(el('ol', { class: 'instructions' }, ...detail.instructions.map((s) => el('li', { text: s }))));
    }
    if (detail.tips.length) {
      container.append(section('Coaching cues'));
      container.append(el('ul', { class: 'tips' }, ...detail.tips.map((s) => el('li', { text: s }))));
    }
    if (detail.variations.length) {
      container.append(section('Variations'));
      container.append(el('ul', { class: 'tips' }, ...detail.variations.map((s) => el('li', { text: s }))));
    }
  } catch (err) {
    container.innerHTML = '';
    container.append(el('p', { class: 'muted small', text: err.message }));
  }
}

const section = (title) =>
  el('h4', { text: title, style: { fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--dim)', margin: '18px 0 9px' } });

/** Personal bests and the estimated-1RM trend for this exercise. */
export function historyBlock(exerciseId) {
  const pr = personalRecords(exerciseId);
  const wrap = el('div', {});
  wrap.append(section('Your numbers'));
  if (!pr) {
    wrap.append(el('p', { class: 'muted small', text: 'No logged sets yet. They will show up here after your first session.' }));
    return wrap;
  }
  const unit = settings.unit;
  wrap.append(el('div', { class: 'stat-grid' },
    stat(`${fmtNum(pr.heaviest.weight)}`, unit, 'Heaviest set'),
    stat(`${fmtNum(e1rm(pr.best1rm.weight, pr.best1rm.reps), 0)}`, unit, 'Best est. 1RM'),
    stat(String(pr.totalSets), '', 'Sets logged')));

  const sets = setsForExercise(exerciseId);
  const byDay = new Map();
  for (const s of sets) {
    const day = s.at.slice(0, 10);
    const est = e1rm(s.weight, s.reps);
    if (est > (byDay.get(day) || 0)) byDay.set(day, est);
  }
  const points = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, y]) => ({ x: new Date(day).getTime(), y }));
  if (points.length > 1) {
    wrap.append(el('div', { class: 'card', style: { marginTop: '10px', padding: '10px 8px 4px' } },
      lineChart(points, { yLabel: `est. 1RM (${unit})` })));
  }
  const recent = sets.slice(0, 6);
  if (recent.length) {
    wrap.append(el('div', { class: 'stack', style: { marginTop: '10px' } },
      ...recent.map((s) => el('div', { class: 'flex-between small', style: { padding: '5px 2px', borderBottom: '1px solid var(--line-soft)' } },
        el('span', { class: 'muted', text: fmtDate(s.at) }),
        el('span', { class: 'mono', text: `${fmtNum(s.weight)} ${unit} × ${s.reps}` })))));
  }
  return wrap;
}

const stat = (value, unit, key) =>
  el('div', { class: 'stat' },
    el('div', { class: 'stat-val' }, value, unit ? el('small', { text: unit }) : null),
    el('div', { class: 'stat-key', text: key }));

export const thumbFor = (exercise) => el('div', { class: 'lib-thumb', text: initials(exercise.name) });
