/* Minimal view router. Views are plain modules exporting `render(root, params)`;
   returning a function from render registers a teardown (timers, listeners). */

const routes = new Map();
let currentName = '';
let currentParams = {};
let teardown = null;

export function registerRoute(name, mod) {
  routes.set(name, mod);
}

export const currentRoute = () => currentName;

export function navigate(name, params = {}) {
  const mod = routes.get(name);
  if (!mod) { console.error('unknown route', name); return; }

  if (teardown) { try { teardown(); } catch (err) { console.error(err); } teardown = null; }
  currentName = name;
  currentParams = params;

  const root = document.getElementById('view');
  root.innerHTML = '';
  root.scrollTop = 0;

  const title = typeof mod.meta?.title === 'function' ? mod.meta.title(params) : mod.meta?.title || '';
  document.getElementById('view-title').textContent = title;
  const sub = typeof mod.meta?.sub === 'function' ? mod.meta.sub(params) : mod.meta?.sub || '';
  const subEl = document.getElementById('view-sub');
  subEl.textContent = sub;
  subEl.hidden = !sub;

  for (const tab of document.querySelectorAll('#tabbar .tab')) {
    tab.classList.toggle('active', tab.dataset.route === name);
  }

  try {
    const result = mod.render(root, params);
    if (typeof result === 'function') teardown = result;
  } catch (err) {
    console.error('view failed', err);
    root.append(Object.assign(document.createElement('div'), {
      className: 'pill-warn',
      textContent: `This screen failed to load: ${err.message}`,
    }));
  }
  history.replaceState({ name, params }, '', `#${name}`);
  window.dispatchEvent(new CustomEvent('route', { detail: { name, params } }));
}

/** Re-run the current view, e.g. after a sync replaced the data underneath it. */
export function refresh() {
  if (currentName) navigate(currentName, currentParams);
}

export function routeFromHash() {
  const name = location.hash.replace(/^#/, '');
  return routes.has(name) ? name : '';
}
