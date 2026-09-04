/* ExerciseDB (RapidAPI) adapter.
 *
 * Two things make this deliberately defensive:
 *
 *  1. RapidAPI listings differ in host, base path and search parameter between
 *     the GIF and the video edition, and the provider can change them. Rather
 *     than hard-coding a guess that silently breaks, Settings runs `probe()`,
 *     which tries the known shapes against the user's own subscription and
 *     stores whichever actually answers.
 *  2. Media needs the API key in a request header, so <img src> cannot fetch it
 *     directly. Everything goes through fetch() and is cached as a blob in the
 *     Cache Storage API, which also keeps the monthly request quota intact:
 *     an animation is downloaded once per device, not once per view.
 */

import { settings, saveSettings } from './state.js';
import { titleCase } from './util.js';

const MEDIA_CACHE = 'liftlog-media-v1';
const memoryCache = new Map();

const LIST_PATHS = ['/exercises', '/api/v1/exercises', '/api/v2/exercises', '/v1/exercises', '/v2/exercises'];
const SEARCH_STYLES = ['search', 'q', 'name', 'client'];

export const DEFAULT_MEDIA_TEMPLATE = '/image?exerciseId={id}&resolution=180';

/* Media lives behind a different route on every edition of this API, and the
   record only carries a bare file name. These are the shapes seen in the wild;
   probeMedia() tries them against the user's own subscription. */
export const MEDIA_CANDIDATES = [
  '/image?exerciseId={id}&resolution=180',
  '/image?exerciseId={id}',
  '/image?id={id}&resolution=180',
  '/gif?exerciseId={id}',
  '/image/{id}',
  '/images/{file}',
  '/image/{file}',
  '/media/{file}',
  '/exercises/{id}/image',
  '/exercises/image?exerciseId={id}',
];

/* Why the last media request failed, so the UI can say something specific
   instead of a shrug. */
let lastError = '';
export const lastMediaError = () => lastError;

export const cfg = () => settings.edb;

export const isConfigured = () => Boolean(cfg().host && cfg().key);

export const isReady = () => isConfigured() && Boolean(cfg().basePath);

function cleanHost(host) {
  return String(host || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function headers(which = 'primary') {
  const c = cfg();
  const host = which === 'video' && c.videoHost ? cleanHost(c.videoHost) : cleanHost(c.host);
  const key = which === 'video' && c.videoKey ? c.videoKey : c.key;
  return { 'x-rapidapi-key': key, 'x-rapidapi-host': host };
}

function url(path, params = {}, which = 'primary') {
  const c = cfg();
  const host = which === 'video' && c.videoHost ? cleanHost(c.videoHost) : cleanHost(c.host);
  const u = new URL(`https://${host}${path.startsWith('/') ? path : '/' + path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  }
  return u.toString();
}

async function request(path, params = {}, which = 'primary') {
  const res = await fetch(url(path, params, which), { headers: headers(which) });
  if (res.status === 401 || res.status === 403) throw new ApiError('Key rejected (401/403). Check the RapidAPI key and that you are subscribed to this API.', res.status);
  if (res.status === 429) throw new ApiError('Rate limit reached on your RapidAPI plan (429).', res.status);
  if (!res.ok) throw new ApiError(`Request failed: HTTP ${res.status}`, res.status);
  return res.json();
}

export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}

/* ---------- response normalisation --------------------------------------- */

/** Pull an array of exercises out of the various envelope shapes in the wild. */
function listFrom(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return [];
  for (const key of ['data', 'exercises', 'results', 'items']) {
    const v = json[key];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      for (const inner of ['exercises', 'data', 'results', 'items']) {
        if (Array.isArray(v[inner])) return v[inner];
      }
    }
  }
  return [];
}

const firstOf = (obj, keys) => {
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  return undefined;
};

const asArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

const MEDIA_RX = /\.(gif|webp|png|jpe?g|mp4|webm|mov)(\?|#|$)/i;

/**
 * Editions disagree on where media lives — gifUrl, imageUrl, a nested media
 * object, sometimes a bare file name and sometimes a full CDN URL. Rather than
 * guessing a field, walk the record and collect anything that looks like media.
 */
function collectMedia(raw) {
  const found = [];
  const walk = (value, key) => {
    if (typeof value === 'string') {
      if (value && !value.includes(' ') && MEDIA_RX.test(value)) found.push({ key, url: value });
    } else if (Array.isArray(value)) {
      value.forEach((v) => walk(v, key));
    } else if (value && typeof value === 'object') {
      Object.entries(value).forEach(([k, v]) => walk(v, k));
    }
  };
  Object.entries(raw).forEach(([k, v]) => walk(v, k));

  const isGif = (m) => /gif/i.test(m.key) || /\.gif(\?|#|$)/i.test(m.url);
  const isVideo = (m) => /video/i.test(m.key) || /\.(mp4|webm|mov)(\?|#|$)/i.test(m.url);
  return {
    gif: found.find(isGif)?.url || '',
    video: found.find(isVideo)?.url || '',
    still: found.find((m) => !isGif(m) && !isVideo(m))?.url || '',
    all: found,
  };
}

/** Map an upstream record to the shape the rest of the app understands. */
export function normalize(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(firstOf(raw, ['exerciseId', 'id', '_id', 'exercise_id']) ?? '');
  const name = titleCase(firstOf(raw, ['name', 'exerciseName', 'title']) ?? '');
  if (!id && !name) return null;
  const bodyParts = asArray(firstOf(raw, ['bodyParts', 'bodyPart', 'body_part'])).map(titleCase);
  const targets = asArray(firstOf(raw, ['targetMuscles', 'target', 'primaryMuscles'])).map(titleCase);
  const secondary = asArray(firstOf(raw, ['secondaryMuscles', 'secondary_muscles'])).map(titleCase);
  const equipments = asArray(firstOf(raw, ['equipments', 'equipment'])).map(titleCase);
  const media = collectMedia(raw);
  return {
    edbId: id,
    name,
    bodyParts,
    targets,
    secondary,
    equipments,
    media,
    instructions: asArray(firstOf(raw, ['instructions', 'steps'])).map(String),
    tips: asArray(firstOf(raw, ['exerciseTips', 'tips'])).map(String),
    variations: asArray(firstOf(raw, ['variations'])).map(String),
    overview: firstOf(raw, ['overview', 'description']) || '',
    // An animation beats a still, but a still beats nothing at all.
    imageUrl: media.gif || firstOf(raw, ['gifUrl', 'imageUrl', 'image', 'gif']) || media.still || '',
    videoUrl: media.video || firstOf(raw, ['videoUrl', 'video']) || '',
    raw,
  };
}

/* ---------- discovery ----------------------------------------------------- */

/**
 * Work out which base path and search parameter this subscription answers on.
 * Returns a log of everything tried so Settings can show what happened.
 */
export async function probe(onStep = () => {}) {
  const log = [];
  const note = (line) => { log.push(line); onStep(line); };
  if (!isConfigured()) throw new ApiError('Enter the RapidAPI host and key first.');

  let basePath = '';
  let sample = null;
  for (const path of LIST_PATHS) {
    try {
      note(`GET ${path}?limit=3 …`);
      const json = await request(path, { limit: 3, offset: 0 });
      const list = listFrom(json);
      if (list.length) {
        basePath = path;
        sample = list[0];
        note(`  ✓ ${list.length} exercises returned`);
        break;
      }
      note('  · responded, but no exercise array found');
    } catch (err) {
      note(`  · ${err.message}`);
      if (err.status === 401 || err.status === 403) throw err;
    }
  }
  if (!basePath) throw new ApiError('No working exercise endpoint found. Check the host against the RapidAPI code snippet.');

  // An API that ignores an unknown query parameter answers with its unfiltered
  // first page, which can easily look like a match. So a style only counts when
  // every row matches the term AND the page differs from the unfiltered one.
  let baseline = [];
  try {
    baseline = listFrom(await request(basePath, { limit: 8 })).map(normalize).filter(Boolean).map((e) => e.name);
  } catch { /* the loop below still works without a baseline */ }

  let searchStyle = 'client';
  for (const style of SEARCH_STYLES.filter((s) => s !== 'client')) {
    try {
      note(`Testing ?${style}=press …`);
      const json = await request(basePath, { [style]: 'press', limit: 8 });
      const names = listFrom(json).map(normalize).filter(Boolean).map((e) => e.name);
      const allMatch = names.length > 0 && names.every((n) => n.toLowerCase().includes('press'));
      if (allMatch && names.join('|') !== baseline.join('|')) {
        searchStyle = style;
        note(`  ✓ server-side search works with ?${style}=`);
        break;
      }
      note(allMatch ? '  · same page as the unfiltered request' : '  · parameter ignored');
    } catch (err) {
      note(`  · ${err.message}`);
    }
  }
  if (searchStyle === 'client') note('No server-side search parameter found — filtering results on the device.');

  const c = cfg();
  c.basePath = basePath;
  c.searchStyle = searchStyle;
  if (!c.mediaTemplate) c.mediaTemplate = DEFAULT_MEDIA_TEMPLATE;
  saveSettings();

  const first = normalize(sample);
  return { basePath, searchStyle, sample: first, log };
}

/* ---------- queries ------------------------------------------------------- */

export async function search({ query = '', bodyPart = '', equipment = '', limit = 30, offset = 0 } = {}) {
  const c = cfg();
  if (!isReady()) throw new ApiError('ExerciseDB is not connected yet. Open Settings → Exercise animations.');

  const params = { limit, offset };
  if (query && c.searchStyle && c.searchStyle !== 'client') params[c.searchStyle] = query;
  if (bodyPart) params.bodyPart = bodyPart.toLowerCase();
  if (equipment) params.equipment = equipment.toLowerCase();

  const json = await request(c.basePath, params);
  let list = listFrom(json).map(normalize).filter(Boolean);

  const q = query.trim().toLowerCase();
  if (q && (!c.searchStyle || c.searchStyle === 'client')) {
    list = list.filter((e) => e.name.toLowerCase().includes(q));
  }
  return list;
}

/** Not every edition exposes /exercises/{id}, so a 404 here is not an error. */
export async function getById(edbId) {
  const c = cfg();
  if (!isReady()) throw new ApiError('ExerciseDB is not connected yet.');
  try {
    const json = await request(`${c.basePath}/${encodeURIComponent(edbId)}`);
    const direct = normalize(json?.data ?? json);
    if (direct?.name) return direct;
    return listFrom(json).map(normalize).filter(Boolean)[0] || null;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

/* ---------- media --------------------------------------------------------- */

function mediaEndpoint(exercise, kind) {
  const c = cfg();
  const file = kind === 'video' ? exercise.videoUrl : exercise.imageUrl;
  if (file && /^https?:\/\//i.test(file)) return { absolute: true, href: file };
  // Nothing to build a request from.
  if (!file && !exercise.edbId) return { absolute: false, href: '' };

  const tpl = (kind === 'video' ? c.videoTemplate : c.mediaTemplate) || DEFAULT_MEDIA_TEMPLATE;
  const path = tpl
    .replace('{id}', encodeURIComponent(exercise.edbId))
    .replace('{file}', encodeURIComponent(file || ''))
    .replace('{res}', kind === 'video' ? '360' : '180');
  const which = kind === 'video' && c.videoHost ? 'video' : 'primary';
  return { absolute: false, href: url(path, {}, which), which };
}

async function cacheStore() {
  try { return await caches.open(MEDIA_CACHE); } catch { return null; }
}

/**
 * Where to show an exercise's media from, as { src, isVideo }.
 *
 * A full CDN URL is handed straight to the <img> tag: images are not subject to
 * CORS the way fetch() is, and the CDN serving this API's media sends no CORS
 * headers, so fetching it into a blob fails where the plain tag succeeds. Only
 * key-protected routes on the API host go through fetch, and those are cached
 * as blobs so an animation is downloaded once per device.
 */
export async function mediaSource(exercise, kind = null) {
  const want = kind || (cfg().prefer === 'video' ? 'video' : 'gif');
  const target = mediaEndpoint(exercise, want);
  if (!target.href) { lastError = 'this exercise has no media in the API record'; return null; }

  const looksVideo = /\.(mp4|webm|mov)(\?|#|$)/i.test(target.href) || (want === 'video' && !target.absolute);
  if (target.absolute) return { src: target.href, isVideo: looksVideo };

  const objUrl = await cachedBlobUrl(exercise, want, target);
  return objUrl ? { src: objUrl, isVideo: looksVideo } : null;
}

/** Fetch-and-cache path, for media that needs the API key in a request header. */
async function cachedBlobUrl(exercise, want, target) {
  const cacheKey = `https://liftlog.media/${want}/${encodeURIComponent(exercise.edbId || exercise.name)}`;
  if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey);

  const store = await cacheStore();
  const hit = await store?.match(cacheKey);
  if (hit) {
    const objUrl = URL.createObjectURL(await hit.blob());
    memoryCache.set(cacheKey, objUrl);
    return objUrl;
  }

  try {
    const res = await fetch(target.href, { headers: headers(target.which) });
    if (!res.ok) throw new ApiError(`the media route answered HTTP ${res.status}`, res.status);
    const blob = await res.blob();
    if (blob.size < 64) throw new ApiError('the media route returned an empty response');
    await store?.put(cacheKey, new Response(blob, { headers: { 'Content-Type': blob.type || 'image/gif' } }));
    const objUrl = URL.createObjectURL(blob);
    memoryCache.set(cacheKey, objUrl);
    return objUrl;
  } catch (err) {
    lastError = err instanceof TypeError
      ? 'the media request was blocked (CORS or no connection)'
      : err.message;
    console.warn('media unavailable', exercise.name, lastError);
    return null;
  }
}

/** True when the browser can actually paint this URL in an <img>. */
function imageLoads(src, timeoutMs = 8000) {
  if (typeof Image === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    const img = new Image();
    const finish = (ok) => { img.onload = null; img.onerror = null; resolve(ok); };
    const timer = setTimeout(() => finish(false), timeoutMs);
    img.onload = () => { clearTimeout(timer); finish(img.naturalWidth > 0); };
    img.onerror = () => { clearTimeout(timer); finish(false); };
    img.src = src;
  });
}

/**
 * Find the route that actually serves media on this subscription, and store it.
 * Returns a log of everything tried, because when none of them work the log is
 * what turns "no animation" into a fixable fact.
 */
export async function probeMedia(onStep = () => {}) {
  const log = [];
  const note = (line) => { log.push(line); onStep(line); };
  if (!isReady()) throw new ApiError('Run the endpoint test first.');

  const page = listFrom(await request(cfg().basePath, { limit: 10, offset: 0 }));
  if (!page.length) throw new ApiError('The exercises endpoint returned no records to test with.');
  const records = page.map(normalize).filter(Boolean);
  const sample = records.find((r) => r.imageUrl || r.videoUrl) || records[0];
  const raw = page[records.indexOf(sample)] ?? page[0];

  const gifs = records.filter((r) => r.media?.gif).length;
  const videos = records.filter((r) => r.media?.video).length;
  const stills = records.filter((r) => !r.media?.gif && !r.media?.video && r.media?.still).length;
  note(`Checked ${records.length} records: ${gifs} animated, ${videos} with video, ${stills} with a still image only.`);
  note(`Example: ${sample.name} (id ${sample.edbId || 'none'})`);
  note(`  image: ${sample.imageUrl || '(none)'}`);
  note(`  video: ${sample.videoUrl || '(none)'}`);

  // A full URL needs no template — but it does have to survive being shown.
  if (/^https?:\/\//i.test(sample.imageUrl)) {
    note('The record carries a full media URL — checking that it displays …');
    if (await imageLoads(sample.imageUrl)) {
      note('  ✓ displays directly, no template needed');
      cfg().mediaTemplate = '';
      saveSettings();
      await probeDetailRoute(sample, note);
      return { template: '', direct: true, sample, raw, log };
    }
    note('  · the browser could not display it (dead link, or hotlinking blocked)');
  }

  const check = async (href) => {
    const res = await fetch(href, { headers: headers('primary') });
    if (!res.ok) return `HTTP ${res.status}`;
    const blob = await res.blob();
    if (blob.size < 512) return `only ${blob.size} bytes back`;
    if (blob.type && !/^(image|video|application\/octet-stream)/.test(blob.type)) return `got ${blob.type}`;
    return { ok: true, type: blob.type || 'unknown', size: blob.size };
  };

  for (const tpl of MEDIA_CANDIDATES) {
    const href = url(tpl
      .replace('{id}', encodeURIComponent(sample.edbId))
      .replace('{file}', encodeURIComponent(sample.imageUrl || ''))
      .replace('{res}', '180'), {}, 'primary');
    note(`Trying ${tpl} …`);
    try {
      const result = await check(href);
      if (result.ok) {
        note(`  ✓ works (${result.type}, ${Math.round(result.size / 1024)} kB)`);
        cfg().mediaTemplate = tpl;
        saveSettings();
        await probeDetailRoute(sample, note);
        return { template: tpl, direct: false, sample, raw, log };
      }
      note(`  · ${result}`);
    } catch (err) {
      note(`  · ${err instanceof TypeError ? 'blocked (CORS)' : err.message}`);
    }
  }
  note('None of the known media routes answered with an image.');
  await probeDetailRoute(sample, note);
  return { template: '', direct: false, sample, raw, log };
}

/**
 * The list endpoint may return summaries only. Find out whether a per-exercise
 * route exists, so instructions are only requested when they can actually come.
 */
async function probeDetailRoute(sample, note) {
  if (!sample.edbId) return;
  note(`Checking ${cfg().basePath}/{id} for instructions …`);
  try {
    const detail = await getById(sample.edbId);
    if (!detail) {
      note('  · no per-exercise route on this plan');
      cfg().detailRoute = false;
    } else {
      note(detail.instructions.length
        ? `  ✓ returns ${detail.instructions.length} instruction steps`
        : '  · answers, but carries no instructions');
      cfg().detailRoute = true;
    }
  } catch (err) {
    note(`  · ${err.message}`);
    cfg().detailRoute = false;
  }
  saveSettings();
}

/** Best match for a name, used to attach animations to the built-in exercises. */
export async function findByName(name) {
  const list = await search({ query: name, limit: 25 });
  if (!list.length) return null;
  const want = name.trim().toLowerCase();
  return list.find((e) => e.name.toLowerCase() === want)
    || list.find((e) => e.name.toLowerCase().endsWith(want))
    || list.find((e) => e.name.toLowerCase().includes(want))
    || list[0];
}

export async function clearMediaCache() {
  for (const objUrl of memoryCache.values()) URL.revokeObjectURL(objUrl);
  memoryCache.clear();
  try { await caches.delete(MEDIA_CACHE); } catch { /* nothing cached */ }
}

export async function mediaCacheSize() {
  const store = await cacheStore();
  if (!store) return 0;
  return (await store.keys()).length;
}
