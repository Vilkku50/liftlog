/* Offline shell. The gym is exactly where the connection dies, so the whole app
   is cached and served cache-first; only the two APIs are always live. */

const CACHE = 'liftlog-shell-v2';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/app.css',
  './js/app.js',
  './js/router.js',
  './js/state.js',
  './js/seed.js',
  './js/util.js',
  './js/edb.js',
  './js/sync.js',
  './js/rest.js',
  './js/picker.js',
  './js/exercise-detail.js',
  './js/views/home.js',
  './js/views/routines.js',
  './js/views/workout.js',
  './js/views/history.js',
  './js/views/library.js',
  './js/views/settings.js',
  './js/session.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE && key.startsWith('liftlog-shell')).map((key) => caches.delete(key)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  // GitHub and RapidAPI responses must never be served from the shell cache:
  // one carries the live log, the other is authenticated per request.
  if (url.hostname === 'api.github.com' || url.hostname.endsWith('rapidapi.com')) return;
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }).catch(() => caches.match('./index.html'))),
  );
});
