/* Bootstrap: wire the shell (tab bar, resume banner, sync chip), register the
   routes and start the background services. */

import { loadAll, settings, subscribe, flushWrites } from './state.js';
import { beginWorkout } from './session.js';
import { registerRoute, navigate, currentRoute, refresh, routeFromHash } from './router.js';
import { fmtClock, toast } from './util.js';
import * as sync from './sync.js';

import * as home from './views/home.js';
import * as routines from './views/routines.js';
import * as workout from './views/workout.js';
import * as history from './views/history.js';
import * as library from './views/library.js';
import * as settingsView from './views/settings.js';

loadAll();

registerRoute('home', home);
registerRoute('routines', routines);
registerRoute('workout', workout);
registerRoute('history', history);
registerRoute('library', library);
registerRoute('settings', settingsView);

/* ---------- shell wiring -------------------------------------------------- */

for (const tab of document.querySelectorAll('#tabbar .tab')) {
  tab.addEventListener('click', () => {
    if (tab.dataset.action === 'start') {
      beginWorkout();
      return;
    }
    navigate(tab.dataset.route);
  });
}

document.getElementById('settings-btn').addEventListener('click', () => navigate('settings'));

const resumeBar = document.getElementById('resume-bar');
resumeBar.addEventListener('click', () => navigate('workout'));

function updateResumeBar() {
  const active = settings.active;
  const show = Boolean(active) && currentRoute() !== 'workout';
  resumeBar.hidden = !show;
  if (!show) return;
  const seconds = (Date.now() - new Date(active.startedAt)) / 1000;
  resumeBar.querySelector('.resume-text').textContent = active.name;
  resumeBar.querySelector('.resume-time').textContent = fmtClock(seconds);
}
setInterval(updateResumeBar, 1000);
window.addEventListener('route', updateResumeBar);

/* ---------- sync chip ----------------------------------------------------- */

const chip = document.getElementById('sync-chip');
chip.addEventListener('click', () => {
  if (!sync.isConfigured()) { navigate('settings'); return; }
  sync.syncNow().then((r) => toast(r.ok ? 'Synced' : `Sync: ${r.reason}`, r.ok ? 'ok' : 'err'));
});

sync.onStatus((status) => {
  chip.hidden = status.state === 'disabled';
  chip.className = `sync-chip ${status.state === 'ok' ? 'ok' : status.state === 'syncing' ? 'syncing' : status.state === 'error' ? 'err' : ''}`.trim();
  chip.querySelector('.sync-label').textContent = {
    ok: 'Synced', syncing: 'Syncing', error: 'Sync', offline: 'Offline', paused: 'Paused',
  }[status.state] || 'Sync';
  chip.title = status.message || `Sync ${status.state}`;
});

/* ---------- data-driven refreshes ----------------------------------------- */

subscribe((reason) => {
  if (reason === 'replaced') {
    // A sync merged remote changes in — re-render so the screen is not stale.
    if (currentRoute() !== 'workout') refresh();
  }
  if (reason === 'active') updateResumeBar();
});

window.addEventListener('pagehide', flushWrites);

/* ---------- keep the screen awake while training -------------------------- */

let wakeLock = null;

async function updateWakeLock() {
  const want = settings.keepAwake && Boolean(settings.active) && document.visibilityState === 'visible';
  try {
    if (want && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* denied or unsupported — not worth interrupting the user */ }
}
document.addEventListener('visibilitychange', updateWakeLock);
setInterval(updateWakeLock, 5000);

/* ---------- start --------------------------------------------------------- */

sync.startAutoSync();
navigate(settings.active ? 'workout' : (routeFromHash() || 'home'));
updateResumeBar();
updateWakeLock();

window.addEventListener('hashchange', () => {
  const name = routeFromHash();
  if (name && name !== currentRoute()) navigate(name);
});

/* ---------- service worker ------------------------------------------------- */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // A new shell means new code; take it on the next launch rather than
      // swapping views out from under a set that is being logged.
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller && !settings.active) {
            worker.postMessage({ type: 'SKIP_WAITING' });
          }
        });
      });
    }).catch((err) => console.warn('service worker registration failed', err));

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  });
}
