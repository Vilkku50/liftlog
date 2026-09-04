/* Backup and multi-device sync through a private GitHub repository.
 *
 * There is no server: the app talks to api.github.com directly (which sends
 * CORS headers, so a static page may call it) and keeps one JSON file in a
 * repo you own. Every sync is a commit, so the repo doubles as a full version
 * history of your training log.
 *
 * The token lives in localStorage on the device only — it is never written
 * into the synced document, and neither is the RapidAPI key.
 */

import { settings, exportDoc, replaceDb, saveSettings, subscribe, flushWrites } from './state.js';
import { debounce } from './util.js';

const API = 'https://api.github.com';
const AUTO_DELAY = 4000;

export const status = { state: 'disabled', message: '', at: '' };
const watchers = new Set();

export function onStatus(fn) {
  watchers.add(fn);
  fn(status);
  return () => watchers.delete(fn);
}

function setStatus(state, message = '') {
  status.state = state;
  status.message = message;
  status.at = new Date().toISOString();
  for (const fn of watchers) { try { fn(status); } catch (err) { console.error(err); } }
}

export const cfg = () => settings.sync;

export const isConfigured = () => Boolean(cfg().token && cfg().owner && cfg().repo);

/* ---------- base64 for UTF-8 --------------------------------------------- */

function toBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(b64) {
  const binary = atob(String(b64).replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/* ---------- GitHub calls -------------------------------------------------- */

async function gh(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg().token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (res.status === 401) throw new Error('GitHub rejected the token (401). It may be expired or mistyped.');
  if (res.status === 403) throw new Error('GitHub returned 403. The token is missing "Contents: Read and write" for this repository.');
  if (res.status === 404) { const e = new Error('Not found (404).'); e.status = 404; throw e; }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).message || ''; } catch { /* no body */ }
    const e = new Error(`GitHub error ${res.status}${detail ? `: ${detail}` : ''}`);
    e.status = res.status;
    throw e;
  }
  return res.status === 204 ? null : res.json();
}

/** Confirm the token works and the data repo is reachable. */
export async function verify() {
  if (!cfg().token) throw new Error('Paste an access token first.');
  const me = await gh('/user');
  if (!cfg().owner) { cfg().owner = me.login; saveSettings(); }
  try {
    const repo = await gh(`/repos/${cfg().owner}/${cfg().repo}`);
    if (!cfg().branch) { cfg().branch = repo.default_branch || 'main'; saveSettings(); }
    return { login: me.login, repo: repo.full_name, private: repo.private, branch: cfg().branch };
  } catch (err) {
    if (err.status === 404) {
      throw new Error(`Repository ${cfg().owner}/${cfg().repo} was not found, or the token has no access to it. Create it (private) on GitHub and give the token access.`);
    }
    throw err;
  }
}

const contentsPath = () =>
  `/repos/${cfg().owner}/${cfg().repo}/contents/${encodeURIComponent(cfg().path).replace(/%2F/g, '/')}`;

/** Read the remote document. Returns { doc: null } when the file does not exist yet. */
export async function pull() {
  const query = cfg().branch ? `?ref=${encodeURIComponent(cfg().branch)}` : '';
  try {
    const json = await gh(`${contentsPath()}${query}`);
    const doc = JSON.parse(fromBase64(json.content || ''));
    return { doc, sha: json.sha };
  } catch (err) {
    if (err.status === 404) return { doc: null, sha: '' };
    if (err instanceof SyntaxError) throw new Error('The file in the repository is not valid LiftLog JSON.');
    throw err;
  }
}

async function put(doc, sha, message) {
  const body = {
    message,
    content: toBase64(JSON.stringify(doc, null, 1)),
    ...(sha ? { sha } : {}),
    ...(cfg().branch ? { branch: cfg().branch } : {}),
  };
  const json = await gh(contentsPath(), { method: 'PUT', body: JSON.stringify(body) });
  return json.content?.sha || '';
}

/* ---------- merge --------------------------------------------------------- */

const newer = (a, b) => (new Date(a.updatedAt || 0) >= new Date(b.updatedAt || 0) ? a : b);

function mergeList(local = [], remote = []) {
  const byId = new Map();
  for (const rec of remote) if (rec?.id) byId.set(rec.id, rec);
  for (const rec of local) {
    if (!rec?.id) continue;
    const existing = byId.get(rec.id);
    byId.set(rec.id, existing ? newer(rec, existing) : rec);
  }
  return [...byId.values()];
}

/**
 * Last-write-wins per record, using each record's own updatedAt. Deletions are
 * tombstones, so a delete on one phone is not undone by an older copy on
 * another.
 */
export function mergeDocs(local, remote) {
  if (!remote) return { doc: local, changed: false };
  const doc = {
    schema: Math.max(local.schema || 1, remote.schema || 1),
    exercises: mergeList(local.exercises, remote.exercises),
    routines: mergeList(local.routines, remote.routines),
    workouts: mergeList(local.workouts, remote.workouts),
  };
  const changed = JSON.stringify(doc) !== JSON.stringify(local);
  return { doc, changed };
}

/* ---------- the sync loop ------------------------------------------------- */

let running = null;

/**
 * Pull, merge, push. Safe to call often: concurrent calls share one run, and a
 * push that races another device retries against the fresh remote state.
 */
export function syncNow({ silent = true } = {}) {
  if (!isConfigured()) {
    setStatus('disabled');
    return Promise.resolve({ ok: false, reason: 'not-configured' });
  }
  if (!navigator.onLine) {
    setStatus('offline', 'No connection — changes are saved on this device.');
    return Promise.resolve({ ok: false, reason: 'offline' });
  }
  if (running) return running;

  running = (async () => {
    setStatus('syncing');
    try {
      flushWrites();
      let attempt = 0;
      while (attempt < 3) {
        attempt += 1;
        const { doc: remote, sha } = await pull();
        const local = exportDoc();
        const { doc: merged } = mergeDocs(local, remote);

        const remoteStale = JSON.stringify(merged) !== JSON.stringify(remote);
        const localStale = JSON.stringify(merged) !== JSON.stringify(local);
        if (localStale) replaceDb(merged);

        if (!remoteStale) break;
        try {
          const newSha = await put(merged, sha, syncMessage(merged));
          cfg().sha = newSha;
          break;
        } catch (err) {
          // 409/422 mean another device wrote first — merge again against it.
          if ((err.status === 409 || err.status === 422) && attempt < 3) continue;
          throw err;
        }
      }
      cfg().lastSyncAt = new Date().toISOString();
      saveSettings();
      setStatus('ok');
      return { ok: true };
    } catch (err) {
      console.error('sync failed', err);
      setStatus('error', err.message);
      if (!silent) throw err;
      return { ok: false, reason: err.message };
    } finally {
      running = null;
    }
  })();
  return running;
}

function syncMessage(doc) {
  const workouts = doc.workouts.filter((w) => !w.deleted).length;
  const device = navigator.userAgentData?.platform || navigator.platform || 'device';
  return `LiftLog sync — ${workouts} workout${workouts === 1 ? '' : 's'} (${device})`;
}

/* ---------- automatic triggers -------------------------------------------- */

const autoSync = debounce(() => { if (cfg().enabled) syncNow(); }, AUTO_DELAY);

export function startAutoSync() {
  subscribe((reason) => {
    if (reason === 'dirty' || reason === 'finished') autoSync();
  });
  window.addEventListener('online', () => { if (cfg().enabled) syncNow(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && cfg().enabled) autoSync.flush();
  });
  if (cfg().enabled && isConfigured()) syncNow();
  else setStatus(isConfigured() ? 'paused' : 'disabled');
}

export const lastSyncLabel = () => {
  const at = cfg().lastSyncAt;
  if (!at) return 'never';
  const mins = Math.round((Date.now() - new Date(at)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};
