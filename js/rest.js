/* Rest timer. Kept as its own module because it must survive re-renders of the
   workout view and keep counting while the phone is in a pocket — so the
   countdown is derived from an absolute end time, not from tick counting. */

import { el, fmtClock, buzz } from './util.js';
import { settings } from './state.js';

let endsAt = 0;
let total = 0;
let ticker = null;
let bar = null;
let audioCtx = null;

export const isResting = () => endsAt > Date.now();

export function startRest(seconds) {
  if (!seconds || seconds <= 0) return;
  total = seconds;
  endsAt = Date.now() + seconds * 1000;
  ensureBar();
  document.body.classList.add('resting');
  tick();
  clearInterval(ticker);
  ticker = setInterval(tick, 250);
}

export function stopRest() {
  clearInterval(ticker);
  ticker = null;
  endsAt = 0;
  bar?.remove();
  bar = null;
  document.body.classList.remove('resting');
}

function addTime(seconds) {
  if (!endsAt) return;
  endsAt += seconds * 1000;
  total += seconds;
  tick();
}

function ensureBar() {
  if (bar) return;
  const time = el('div', { class: 'rest-time', text: '0:00' });
  const fill = el('div', { class: 'rest-fill', style: { width: '100%' } });
  bar = el('div', { id: 'rest-bar' },
    el('div', { class: 'grow' },
      el('div', { class: 'rest-label', text: 'Rest' }),
      time),
    el('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: '+15s', onclick: () => addTime(15) }),
    el('button', { class: 'btn btn-sm btn-ghost', type: 'button', text: 'Skip', onclick: stopRest }),
    fill);
  bar._time = time;
  bar._fill = fill;
  document.body.append(bar);
}

function tick() {
  if (!bar) return;
  const left = (endsAt - Date.now()) / 1000;
  if (left <= 0) {
    bar._time.textContent = '0:00';
    bar._fill.style.width = '0%';
    finish();
    return;
  }
  bar._time.textContent = fmtClock(left);
  bar._fill.style.width = `${Math.max(0, (left / total) * 100)}%`;
}

function finish() {
  clearInterval(ticker);
  ticker = null;
  endsAt = 0;
  if (settings.vibrate) buzz([90, 70, 90]);
  if (settings.sound) beep();
  if (bar) {
    bar._time.textContent = 'Go';
    bar.style.borderColor = 'var(--success)';
    setTimeout(stopRest, 2500);
  }
}

/** Two short tones through WebAudio — no asset to download or cache. */
function beep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;
    [0, 0.22].forEach((offset, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = i === 0 ? 660 : 880;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.2);
    });
  } catch { /* audio blocked until first gesture — not worth surfacing */ }
}

/** Prime the audio context on a real user gesture so the first beep is not muted. */
export function primeAudio() {
  if (!settings.sound || audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume?.();
  } catch { /* ignore */ }
}
