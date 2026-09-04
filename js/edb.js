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
  return {
    edbId: id,
    name,
    bodyParts,
    targets,
    secondary,
    equipments,
    instructions: asArray(firstOf(raw, ['instructions', 'steps'])).map(String),
    tips: asArray(firstOf(raw, ['exerciseTips', 'tips'])).map(String),
    variations: asArray(firstOf(raw, ['variations'])).map(String),
    overview: firstOf(raw, ['overview', 'description']) || '',
    imageUrl: firstOf(raw, ['gifUrl', 'imageUrl', 'image', 'gif']) || '',
    videoUrl: firstOf(raw, ['videoUrl', 'video']) || '',
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

export async function getById(edbId) {
  const c = cfg();
  if (!isReady()) throw new ApiError('ExerciseDB is not connected yet.');
  const json = await request(`${c.basePath}/${encodeURIComponent(edbId)}`);
  const direct = normalize(json?.data ?? json);
  if (direct?.name) return direct;
  const list = listFrom(json).map(normalize).filter(Boolean);
  return list[0] || null;
}

/* ---------- media --------------------------------------------------------- */

function mediaEndpoint(exercise, kind) {
  const c = cfg();
  const file = kind === 'video' ? exercise.videoUrl : exercise.imageUrl;
  if (file && /^https?:\/\//i.test(file)) return { absolute: true, href: file };

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
 * Object URL for an exercise animation. Cached per device after the first
 * fetch. Resolves to null when the media cannot be loaded — callers show a
 * placeholder rather than an error.
 */
export async function mediaObjectUrl(exercise, kind = null) {
  const want = kind || (cfg().prefer === 'video' ? 'video' : 'gif');
  const cacheKey = `https://liftlog.media/${want}/${encodeURIComponent(exercise.edbId || exercise.name)}`;
  if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey);

  const store = await cacheStore();
  const hit = await store?.match(cacheKey);
  if (hit) {
    const objUrl = URL.createObjectURL(await hit.blob());
    memoryCache.set(cacheKey, objUrl);
    return objUrl;
  }

  const target = mediaEndpoint(exercise, want);
  try {
    const res = await fetch(target.href, target.absolute ? {} : { headers: headers(target.which) });
    if (!res.ok) throw new ApiError(`media HTTP ${res.status}`, res.status);
    const blob = await res.blob();
    if (blob.size < 64) throw new ApiError('empty media response');
    await store?.put(cacheKey, new Response(blob, { headers: { 'Content-Type': blob.type || 'image/gif' } }));
    const objUrl = URL.createObjectURL(blob);
    memoryCache.set(cacheKey, objUrl);
    return objUrl;
  } catch (err) {
    console.warn('media unavailable', exercise.name, err.message);
    return null;
  }
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
