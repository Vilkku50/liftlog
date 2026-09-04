/* Exercise detail sheet: the animation, how to perform it, and what you have
   personally lifted on it. Media loads lazily and degrades to a clear message
   instead of a broken image when ExerciseDB is not connected. */

import { el, icon, ICONS, openSheet, toast, debounce, fmtDate, fmtNum, lineChart, initials } from './util.js';
import { settings, exerciseById, upsertExercise, personalRecords, setsForExercise, e1rm } from './state.js';
import { navigate } from './router.js';
import * as edb from './edb.js';

const detailCache = new Map();
const linkCache = new Map();

/**
 * The built-in catalogue has no ExerciseDB ids, so an exercise you log every
 * week would never show an animation. Look the name up once, remember the match
 * on the exercise record, and it is instant (and synced) from then on.
 *
 * Only a confident match is accepted — see edb.nameScore. An unmatched exercise
 * says so and offers to be linked by hand, because a wrong demonstration is
 * worse than none.
 */
async function resolveLink(exercise) {
  if (exercise.edbId) return { exercise, detail: null, unmatched: false };
  if (!edb.isReady()) return { exercise, detail: null, unmatched: false };
  if (linkCache.has(exercise.id)) return linkCache.get(exercise.id);

  let match = null;
  try { match = await edb.findByName(exercise.name); } catch { /* offline or quota */ }
  if (!match) {
    const miss = { exercise, detail: null, unmatched: true };
    linkCache.set(exercise.id, miss);
    return miss;
  }
  const resolved = { exercise: linkExercise(exercise, match), detail: match, unmatched: false };
  linkCache.set(exercise.id, resolved);
  return resolved;
}

/** Attach an ExerciseDB match to a local exercise, permanently. */
export function linkExercise(exercise, match) {
  linkCache.delete(exercise.id);
  return upsertExercise({
    id: exercise.id,
    name: exercise.name,
    bodyPart: exercise.bodyPart,
    target: exercise.target,
    equipment: exercise.equipment,
    edbId: match.edbId,
    media: { imageUrl: match.imageUrl, videoUrl: match.videoUrl },
  });
}

/** A row thumbnail: the real image where we have one, the initial otherwise. */
export function thumb(exercise, className = 'lib-thumb') {
  const src = exercise?.media?.imageUrl;
  const box = el('div', { class: className });
  if (src && /^https?:\/\//i.test(src)) {
    const img = el('img', { src, alt: '', loading: 'lazy' });
    img.addEventListener('error', () => { img.remove(); box.textContent = initials(exercise.name); });
    box.append(img);
  } else {
    box.textContent = initials(exercise?.name);
  }
  return box;
}

/**
 * The video subscription is a separate catalogue, so an exercise linked through
 * the image API carries no video URL until we look it up there — once, then it
 * is stored alongside the image.
 */
async function videoUrlFor(exercise) {
  if (exercise.media?.videoUrl) return exercise.media.videoUrl;
  if (!edb.hasVideoApi()) return null;
  let found = null;
  try { found = await edb.findVideoUrl(exercise.name); } catch { /* leave it to the image */ }
  if (!found) return null;
  upsertExercise({
    id: exercise.id,
    name: exercise.name,
    bodyPart: exercise.bodyPart,
    target: exercise.target,
    equipment: exercise.equipment,
    edbId: exercise.edbId,
    media: { ...(exercise.media || {}), videoUrl: found },
  });
  return found;
}

export function mediaBox(exercise, remote = null, { onRelink = null } = {}) {
  const box = el('div', { class: 'media-box' });

  if (!edb.isReady()) {
    box.append(el('div', { class: 'media-note' },
      el('div', { style: { marginBottom: '8px' } }, icon(ICONS.dumbbell, { width: 1.4 })),
      'Connect ExerciseDB in Settings to see the movement animation here.'));
    return box;
  }

  box.append(el('div', { class: 'spinner' }));
  const note = (text, action = null) => {
    box.innerHTML = '';
    box.append(el('div', { class: 'media-note' }, text,
      action ? el('div', { style: { marginTop: '12px' } }, action) : null));
  };

  (async () => {
    const link = remote ? { exercise, unmatched: false } : await resolveLink(exercise);
    const linked = link.exercise;

    if (link.unmatched) {
      note(`No confident match for “${exercise.name}” in ExerciseDB — showing nothing rather than the wrong movement.`,
        onRelink ? el('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Choose the right exercise', onclick: onRelink }) : null);
      return;
    }

    const source = remote || (linked.edbId || linked.media ? { edbId: linked.edbId, ...(linked.media || {}) } : null);
    if (!source || (!source.edbId && !source.imageUrl)) {
      note('This exercise has no media in the API record.');
      return;
    }

    // The exercise page prefers video when the video subscription is set up;
    // lists always stay on the lighter image.
    const wantVideo = settings.edb.prefer === 'video' && edb.hasVideoApi();
    const videoUrl = wantVideo && !remote ? await videoUrlFor(linked) : (source.videoUrl || '');

    const ref = { edbId: source.edbId, name: exercise.name, imageUrl: source.imageUrl || '', videoUrl: videoUrl || '' };
    const media = (videoUrl ? await edb.mediaSource(ref, 'video') : null)
      || await edb.mediaSource(ref, 'gif')
      || await edb.mediaSource(ref, 'video');

    if (!media) {
      note(`Could not load the media — ${edb.lastMediaError() || 'no reason given'}.`,
        el('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Open media settings', onclick: () => navigate('settings') }));
      return;
    }

    box.innerHTML = '';
    const shown = media.isVideo
      ? el('video', { src: media.src, autoplay: true, loop: true, muted: true, playsinline: true, controls: false })
      : el('img', { src: media.src, alt: exercise.name, loading: 'lazy' });
    shown.addEventListener('error', () => note('The media host did not serve this file to the app.',
      onRelink ? el('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Choose another exercise', onclick: onRelink }) : null));
    box.append(shown);
  })();

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
    const relink = () => openRelinkSheet(exercise, () => {
      api.close();
      openExerciseDetail(exerciseId, { onAdd });
    });

    body.append(mediaBox(exercise, null, { onRelink: relink }), tags, guide, historyBlock(exerciseId));

    if (onAdd) {
      api.setFooter(el('button', {
        class: 'btn btn-primary btn-block', type: 'button',
        onclick: () => { api.close(); onAdd(exerciseId); },
      }, icon(ICONS.plus), 'Add to workout'));
    }

    if (edb.isReady()) {
      resolveLink(exercise).then(({ exercise: linked, detail, unmatched }) => {
        if (detail?.instructions?.length) renderGuide(detail, guide);
        else if (linked.edbId) loadGuide(linked.edbId, guide);
        if (!unmatched) {
          guide.append(el('button', {
            class: 'btn btn-quiet btn-sm', type: 'button', style: { marginTop: '10px', padding: '4px 0' },
            text: 'Wrong movement shown? Pick another', onclick: relink,
          }));
        }
      });
    } else {
      guide.append(el('p', { class: 'muted small', text: 'Step-by-step instructions and animations come from ExerciseDB. Connect it in Settings to see them here.' }));
    }
    return body;
  });
}

/**
 * Manual override for the automatic name match: search ExerciseDB and pin the
 * chosen entry to this exercise for good.
 */
export function openRelinkSheet(exercise, onDone) {
  openSheet({ title: `Link “${exercise.name}”`, tall: true }, (api) => {
    const input = el('input', { class: 'input', type: 'search', value: exercise.name, placeholder: 'Search ExerciseDB…' });
    const results = el('div', { class: 'stack', style: { marginTop: '12px' } });
    const status = el('div', { class: 'center muted small', style: { padding: '10px 0' } });

    const run = debounce(async () => {
      status.hidden = false;
      status.textContent = 'Searching ExerciseDB…';
      results.innerHTML = '';
      try {
        const list = await edb.search({ query: input.value, limit: 40 });
        status.hidden = list.length > 0;
        if (!list.length) { status.textContent = 'Nothing matched that search.'; return; }
        for (const item of list) {
          results.append(el('button', {
            class: 'row', type: 'button',
            onclick: () => { linkExercise(exercise, item); api.close(); toast('Linked', 'ok'); onDone?.(); },
          },
            thumb({ name: item.name, media: { imageUrl: item.imageUrl } }),
            el('div', { class: 'row-main' },
              el('div', { class: 'row-title', text: item.name }),
              el('div', { class: 'row-sub', text: [item.targets[0], item.equipments[0]].filter(Boolean).join(' · ') })),
            icon(ICONS.chevron, { class: 'chev' })));
        }
      } catch (err) {
        status.hidden = false;
        status.textContent = err.message;
      }
    }, 320);

    input.addEventListener('input', run);
    run();
    return el('div', {},
      el('p', { class: 'small muted', style: { margin: '0 0 10px', lineHeight: '1.5' } },
        'Pick the entry that shows this movement. The choice is saved and used from now on.'),
      el('div', { class: 'search-wrap' }, icon(ICONS.search), input),
      status, results);
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
    renderGuide(detail, container);
  } catch (err) {
    container.innerHTML = '';
    container.append(el('p', { class: 'muted small', text: err.message }));
  }
}

/** Render one normalised ExerciseDB record: muscles, steps, cues, variations. */
function renderGuide(detail, container) {
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
