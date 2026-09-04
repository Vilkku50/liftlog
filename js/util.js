/* Small DOM + formatting helpers shared by every view. No framework: the app
   is small enough that direct DOM building stays readable and starts instantly
   on a phone. */

export function el(tag, props, ...kids) {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k in node && k !== 'list' && typeof v !== 'object') node[k] = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
  }
  append(node, kids);
  return node;
}

function append(node, kids) {
  for (const kid of kids) {
    if (kid === null || kid === undefined || kid === false) continue;
    if (Array.isArray(kid)) append(node, kid);
    else node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
}

/** Inline SVG icon from a path string, sized by CSS. */
export function icon(paths, opts = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', opts.viewBox || '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', opts.width || 2);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of [].concat(paths)) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  if (opts.class) svg.setAttribute('class', opts.class);
  return svg;
}

export const ICONS = {
  check: 'M4.5 12.5 9.5 17.5 19.5 7',
  plus: 'M12 5v14M5 12h14',
  chevron: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  close: 'M6 6l12 12M18 6 6 18',
  dots: 'M12 6.2v.01M12 12v.01M12 17.8v.01',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M15 4.5v5M9 14.5v5',
  trash: 'M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7',
  search: 'M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM20 20l-4.4-4.4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7.5V12l3 1.8',
  flame: 'M12 3s5 4.2 5 8.4A5 5 0 0 1 7 11.4C7 9 9 7.6 9 7.6s.3 2.1 1.6 2.1C11.9 9.7 12 6.4 12 3Z',
  dumbbell: 'M4 12h3M17 12h3M7.5 8.5v7M16.5 8.5v7M10.5 7v10M13.5 7v10M7.5 12h9',
  cloud: 'M7 18a4 4 0 0 1-.4-8A5.5 5.5 0 0 1 17.3 9.6 3.7 3.7 0 0 1 17 18H7Z',
  edit: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M18 13l-6 6-6-6',
};

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

export const nowIso = () => new Date().toISOString();

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  return wrapped;
}

/* ---------- formatting --------------------------------------------------- */

export function fmtClock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

export function fmtDuration(seconds) {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

export function fmtNum(n, decimals = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  const rounded = Math.round(n * 10 ** decimals) / 10 ** decimals;
  return String(rounded);
}

export function fmtVolume(kg) {
  if (kg >= 1000) return `${fmtNum(kg / 1000, kg >= 10000 ? 0 : 1)}k`;
  return String(Math.round(kg));
}

const DAY = 86400000;

export function fmtDate(iso, opts = {}) {
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(today) - startOf(d)) / DAY);
  if (!opts.absolute) {
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff > 1 && diff < 7) return d.toLocaleDateString('en-GB', { weekday: 'long' });
  }
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: sameYear ? undefined : 'numeric' });
}

export function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function monthKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', { month: 'long', year: sameYear ? undefined : 'numeric' });
}

/** Monday-based start of the ISO week containing `date`. */
export function weekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
}

export function titleCase(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export const initials = (name) => String(name || '?').trim().charAt(0).toUpperCase() || '?';

/* ---------- feedback ----------------------------------------------------- */

export function toast(message, kind = '') {
  const root = document.getElementById('toast-root');
  const node = el('div', { class: `toast ${kind}`.trim(), text: message });
  root.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .25s ease';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 260);
  }, kind === 'err' ? 4200 : 2200);
}

export function buzz(pattern = 12) {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}

/* ---------- sheets & dialogs --------------------------------------------- */

/**
 * Bottom sheet. `build(api)` receives { close, setFooter, body } and returns
 * body content. Returns a handle with .close().
 */
export function openSheet({ title, tall = false, onClose } = {}, build) {
  const root = document.getElementById('sheet-root');
  const body = el('div', { class: 'sheet-body' });
  const foot = el('div', { class: 'sheet-foot', hidden: true });
  const sheet = el('div', { class: `sheet${tall ? ' tall' : ''}` });
  const backdrop = el('div', { class: 'sheet-backdrop' }, sheet);

  let closed = false;
  const close = (result) => {
    if (closed) return;
    closed = true;
    backdrop.style.transition = 'opacity .16s ease';
    backdrop.style.opacity = '0';
    setTimeout(() => backdrop.remove(), 170);
    document.removeEventListener('keydown', onKey);
    onClose?.(result);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

  const head = el('div', { class: 'sheet-head' },
    el('h3', { text: title || '' }),
    el('button', { class: 'icon-btn plain', type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon(ICONS.close)),
  );

  const api = {
    close,
    body,
    setTitle: (t) => { head.querySelector('h3').textContent = t; },
    setFooter: (...nodes) => {
      foot.innerHTML = '';
      if (nodes.length) { foot.hidden = false; append(foot, nodes); } else foot.hidden = true;
    },
  };

  const content = build(api);
  if (content) append(body, [content]);
  sheet.append(head, body, foot);
  root.append(backdrop);
  return api;
}

export function confirmSheet({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const sheet = openSheet({ title, onClose: () => { if (!done) resolve(false); } }, (api) => {
      api.setFooter(
        el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => api.close() }),
        el('button', {
          class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', text: confirmLabel,
          onclick: () => { done = true; api.close(); resolve(true); },
        }),
      );
      return el('p', { class: 'muted', text: message, style: { margin: '2px 0 6px', lineHeight: '1.5' } });
    });
    return sheet;
  });
}

/** Simple single-field prompt sheet. Resolves to the string, or null. */
export function promptSheet({ title, label, value = '', placeholder = '', confirmLabel = 'Save', multiline = false }) {
  return new Promise((resolve) => {
    let done = false;
    openSheet({ title, onClose: () => { if (!done) resolve(null); } }, (api) => {
      const input = el(multiline ? 'textarea' : 'input', { class: 'input', value, placeholder });
      const submit = () => { done = true; api.close(); resolve(input.value.trim()); };
      if (!multiline) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      api.setFooter(
        el('button', { class: 'btn btn-ghost', type: 'button', text: 'Cancel', onclick: () => api.close() }),
        el('button', { class: 'btn btn-primary', type: 'button', text: confirmLabel, onclick: submit }),
      );
      setTimeout(() => { input.focus(); input.select?.(); }, 90);
      return el('label', { class: 'field' }, label ? el('span', { class: 'label', text: label }) : null, input);
    });
  });
}

/** Action list sheet: [{label, danger, onPick}] */
export function menuSheet(title, actions) {
  openSheet({ title }, (api) =>
    el('div', { class: 'stack' },
      ...actions.filter(Boolean).map((a) =>
        el('button', {
          class: `btn btn-block ${a.danger ? 'btn-danger' : 'btn-ghost'}`,
          type: 'button',
          text: a.label,
          onclick: () => { api.close(); a.onPick(); },
        }))));
}

/* ---------- charts ------------------------------------------------------- */

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

/**
 * Line chart with a soft area fill. `points` = [{x: number, y: number, label}]
 * where x is a timestamp. Renders at a fixed viewBox and scales with CSS.
 */
export function lineChart(points, { height = 150, yLabel = '' } = {}) {
  const W = 320, H = height, padL = 34, padR = 8, padT = 12, padB = 20;
  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}` });
  if (points.length === 0) return svg;

  const grad = svgEl('linearGradient', { id: 'llgrad', x1: '0', y1: '0', x2: '0', y2: '1' });
  grad.append(svgEl('stop', { offset: '0', 'stop-color': '#2e7bff', 'stop-opacity': '0.32' }));
  grad.append(svgEl('stop', { offset: '1', 'stop-color': '#2e7bff', 'stop-opacity': '0' }));
  const defs = svgEl('defs');
  defs.append(grad);
  svg.append(defs);

  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  let yMin = Math.min(...ys), yMax = Math.max(...ys);
  if (yMin === yMax) { yMin -= 1; yMax += 1; }
  const pad = (yMax - yMin) * 0.12;
  yMin = Math.max(0, yMin - pad); yMax += pad;

  const sx = (x) => padL + (xMax === xMin ? (W - padL - padR) / 2 : ((x - xMin) / (xMax - xMin)) * (W - padL - padR));
  const sy = (y) => padT + (1 - (y - yMin) / (yMax - yMin)) * (H - padT - padB);

  for (let i = 0; i <= 2; i++) {
    const v = yMin + ((yMax - yMin) * i) / 2;
    const y = sy(v);
    svg.append(svgEl('line', { class: 'grid', x1: padL, y1: y, x2: W - padR, y2: y }));
    const t = svgEl('text', { class: 'axis', x: 2, y: y + 3 });
    t.textContent = fmtNum(v, v < 20 ? 1 : 0);
    svg.append(t);
  }

  const d = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const areaD = `${d} L${sx(points[points.length - 1].x).toFixed(1)},${H - padB} L${sx(points[0].x).toFixed(1)},${H - padB} Z`;
  svg.append(svgEl('path', { class: 'area', d: areaD }));
  svg.append(svgEl('path', { class: 'line', d }));
  points.forEach((p) => svg.append(svgEl('circle', { class: 'dot', cx: sx(p.x).toFixed(1), cy: sy(p.y).toFixed(1), r: points.length > 30 ? 1.6 : 2.6 })));

  const first = svgEl('text', { class: 'axis', x: padL, y: H - 6 });
  first.textContent = fmtDate(new Date(xMin).toISOString(), { absolute: true });
  const last = svgEl('text', { class: 'axis', x: W - padR, y: H - 6, 'text-anchor': 'end' });
  last.textContent = fmtDate(new Date(xMax).toISOString(), { absolute: true });
  svg.append(first, last);
  if (yLabel) {
    const yl = svgEl('text', { class: 'axis', x: 2, y: 9 });
    yl.textContent = yLabel;
    svg.append(yl);
  }
  return svg;
}

/** Vertical bar chart. `bars` = [{label, value, muted}] */
export function barChart(bars, { height = 130 } = {}) {
  const W = 320, H = height, padT = 10, padB = 18;
  const svg = svgEl('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}` });
  if (!bars.length) return svg;
  const max = Math.max(...bars.map((b) => b.value), 1);
  const slot = W / bars.length;
  const bw = Math.min(slot * 0.62, 26);
  bars.forEach((b, i) => {
    const h = ((b.value / max) * (H - padT - padB)) || 0;
    const x = i * slot + (slot - bw) / 2;
    svg.append(svgEl('rect', {
      class: `bar${b.muted ? ' dim' : ''}`,
      x: x.toFixed(1), y: (H - padB - h).toFixed(1), width: bw.toFixed(1), height: Math.max(h, 1.5).toFixed(1), rx: 3,
    }));
    if (b.label) {
      const t = svgEl('text', { class: 'axis', x: (i * slot + slot / 2).toFixed(1), y: H - 5, 'text-anchor': 'middle' });
      t.textContent = b.label;
      svg.append(t);
    }
  });
  return svg;
}

/** Horizontal labelled bars, used for per-muscle set counts. */
export function hBars(items) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return el('div', { class: 'stack' },
    ...items.map((i) => el('div', {},
      el('div', { class: 'flex-between', style: { fontSize: '12.5px', marginBottom: '3px' } },
        el('span', { text: i.label }),
        el('span', { class: 'muted mono', text: String(i.value) })),
      el('div', { style: { height: '7px', background: 'var(--surface-2)', borderRadius: '99px', overflow: 'hidden' } },
        el('div', {
          style: {
            height: '100%', width: `${(i.value / max) * 100}%`,
            background: i.color || 'var(--accent)', borderRadius: '99px',
          },
        })))));
}

export function emptyState({ title, text, action, iconPath }) {
  return el('div', { class: 'empty' },
    iconPath ? icon(iconPath, { width: 1.5 }) : null,
    el('h3', { text: title }),
    text ? el('p', { text }) : null,
    action || null);
}
