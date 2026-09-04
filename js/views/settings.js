/* Settings — units, the ExerciseDB connection and the GitHub backup.
   Both integrations are set up here rather than in code, so no key of yours
   ever ends up in a public repository. */

import { el, icon, ICONS, toast, confirmSheet, fmtDate } from '../util.js';
import { db, settings, saveSettings, allExercises, finishedWorkouts, activeRoutines } from '../state.js';
import { linkExercise } from '../exercise-detail.js';
import * as edb from '../edb.js';
import * as sync from '../sync.js';
import { navigate } from '../router.js';

export const meta = { title: 'Settings' };

const APP_VERSION = '1.0.0';

export function render(root) {
  root.append(
    trainingCard(),
    animationsCard(),
    syncCard(),
    dataCard(),
    el('p', { class: 'small muted center', style: { marginTop: '22px' } },
      `LiftLog ${APP_VERSION} · works offline · data stays on your device unless you connect sync`),
  );
}

/* ---------- training preferences ----------------------------------------- */

function trainingCard() {
  const unit = el('select', { class: 'select', onchange: (e) => { settings.unit = e.target.value; saveSettings(); } },
    el('option', { value: 'kg', text: 'Kilograms (kg)', selected: settings.unit === 'kg' }),
    el('option', { value: 'lb', text: 'Pounds (lb)', selected: settings.unit === 'lb' }));

  const rest = el('input', {
    class: 'input', type: 'text', inputmode: 'numeric', value: String(settings.restDefault),
    oninput: (e) => { settings.restDefault = Math.max(0, parseInt(e.target.value, 10) || 0); saveSettings(); },
  });

  return card('Training', [
    el('label', { class: 'field' }, el('span', { class: 'label', text: 'Weight unit' }), unit),
    el('label', { class: 'field' },
      el('span', { class: 'label', text: 'Default rest between sets (seconds)' }), rest,
      el('span', { class: 'hint', text: 'A routine can override this per exercise.' })),
    toggle('Start rest timer automatically', 'When you tick a working set.', 'restAuto'),
    toggle('Beep when rest ends', '', 'sound'),
    toggle('Vibrate', 'On completed sets and when rest ends.', 'vibrate'),
    toggle('Keep the screen on while training', 'Uses the browser wake lock where supported.', 'keepAwake'),
  ]);
}

function toggle(label, hint, key) {
  const sw = el('button', {
    class: `switch${settings[key] ? ' on' : ''}`, type: 'button', role: 'switch',
    'aria-checked': String(!!settings[key]), 'aria-label': label,
    onclick: (e) => {
      settings[key] = !settings[key];
      e.currentTarget.classList.toggle('on', settings[key]);
      e.currentTarget.setAttribute('aria-checked', String(settings[key]));
      saveSettings();
    },
  });
  return el('div', { class: 'switch-row' },
    el('div', { class: 'grow' },
      el('div', { class: 'sw-label', text: label }),
      hint ? el('div', { class: 'sw-hint', text: hint }) : null),
    sw);
}

/* ---------- ExerciseDB ---------------------------------------------------- */

function animationsCard() {
  const c = settings.edb;
  const host = field('RapidAPI host', c.host, 'exercisedb-….p.rapidapi.com', (v) => { c.host = v; saveSettings(); },
    'Copy the X-RapidAPI-Host value from the code snippet on the RapidAPI page of the API you subscribed to.');
  const key = field('RapidAPI key', c.key, 'your X-RapidAPI-Key', (v) => { c.key = v; saveSettings(); },
    'Stored only in this browser. It is never written to GitHub or sent anywhere except RapidAPI.', 'password');

  const prefer = el('select', { class: 'select', onchange: (e) => { c.prefer = e.target.value; saveSettings(); } },
    el('option', { value: 'gif', text: 'Image or GIF (lighter, loops)', selected: c.prefer !== 'video' }),
    el('option', { value: 'video', text: 'Video on the exercise page', selected: c.prefer === 'video' }));

  const log = el('pre', { class: 'code', hidden: true });
  const statusLine = el('div', { class: 'small', style: { marginTop: '10px' } });

  const testBtn = el('button', {
    class: 'btn btn-primary btn-block', type: 'button',
    onclick: async () => {
      testBtn.disabled = true;
      testBtn.textContent = 'Testing…';
      log.hidden = false;
      log.textContent = '';
      try {
        const result = await edb.probe((line) => { log.textContent += line + '\n'; });
        statusLine.innerHTML = '';
        statusLine.append(el('span', { class: 'tag primary', text: 'Connected' }),
          ' ', `endpoint ${result.basePath}, search “${result.searchStyle}”`);
        if (result.sample) log.textContent += `\nExample record: ${result.sample.name}\n`;
        toast('ExerciseDB connected', 'ok');
      } catch (err) {
        statusLine.textContent = err.message;
        log.textContent += `\n${err.message}\n`;
        toast('Could not connect', 'err');
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = 'Test connection & auto-detect';
      }
    },
  }, 'Test connection & auto-detect');

  const mediaBtn = el('button', {
    class: 'btn btn-ghost btn-block', type: 'button', style: { marginTop: '8px' },
    onclick: async () => {
      mediaBtn.disabled = true;
      mediaBtn.textContent = 'Testing media routes…';
      log.hidden = false;
      log.textContent = '';
      try {
        const result = await edb.probeMedia((line) => { log.textContent += line + '\n'; });
        if (result.direct) toast('Media works straight from the record URL', 'ok');
        else if (result.template) toast(`Media route found: ${result.template}`, 'ok');
        else {
          toast('No media route worked — see the log', 'err');
          log.textContent += `\nRaw record for support:\n${JSON.stringify(result.raw).slice(0, 1500)}\n`;
        }
      } catch (err) {
        log.textContent += `\n${err.message}\n`;
        toast('Media test failed', 'err');
      } finally {
        mediaBtn.disabled = false;
        mediaBtn.textContent = 'Find the media route';
      }
    },
  }, 'Find the media route');

  if (edb.isReady()) {
    statusLine.append(el('span', { class: 'tag primary', text: 'Connected' }), ' ', `endpoint ${c.basePath}`);
  } else if (edb.isConfigured()) {
    statusLine.textContent = 'Host and key saved — run the test to find the right endpoint.';
  } else {
    statusLine.textContent = 'Not connected. The app works fully without this; you just will not see animations.';
  }

  const linkBtn = el('button', {
    class: 'btn btn-ghost btn-block', type: 'button', style: { marginTop: '8px' },
    onclick: async () => {
      linkBtn.disabled = true;
      log.hidden = false;
      log.textContent = '';
      const write = (line) => { log.textContent += line + '\n'; };
      try {
        write('Downloading the catalogue …');
        const catalogue = await edb.fetchCatalogue({
          onProgress: (count, page) => {
            linkBtn.textContent = `Fetched ${count}…`;
            log.textContent = `Downloading the catalogue … ${count} exercises (${page} request${page === 1 ? '' : 's'})\n`;
          },
        });
        write(`Matching ${allExercises().length} of your exercises against ${catalogue.length} entries …`);
        let linked = 0;
        const missed = [];
        for (const exercise of allExercises()) {
          if (exercise.edbId) continue;
          const match = await edb.findByName(exercise.name, catalogue);
          if (match) { linkExercise(exercise, match); linked += 1; }
          else missed.push(exercise.name);
        }
        write(`\n✓ Linked ${linked} exercise${linked === 1 ? '' : 's'}.`);
        if (missed.length) {
          write(`\nNo confident match for ${missed.length} (open one and use “Choose the right exercise” to link it by hand):`);
          write(missed.join(', '));
        }
        toast(linked ? `Linked ${linked} exercises` : 'Nothing new to link', 'ok');
        // Deliberately no re-render here: it would wipe the report just written.
      } catch (err) {
        write(`\n${err.message}`);
        toast('Linking failed', 'err');
      } finally {
        linkBtn.disabled = false;
        linkBtn.textContent = 'Link my library to ExerciseDB';
      }
    },
  }, 'Link my library to ExerciseDB');

  const videoBtn = el('button', {
    class: 'btn btn-ghost btn-block', type: 'button', style: { marginTop: '8px' },
    onclick: async () => {
      videoBtn.disabled = true;
      videoBtn.textContent = 'Testing video API…';
      log.hidden = false;
      log.textContent = '';
      try {
        await edb.probeVideo((line) => { log.textContent += line + '\n'; });
        c.prefer = 'video';
        prefer.value = 'video';
        saveSettings();
        toast('Video API connected', 'ok');
      } catch (err) {
        log.textContent += `\n${err.message}\n`;
        toast('Video API test failed', 'err');
      } finally {
        videoBtn.disabled = false;
        videoBtn.textContent = 'Test the video API';
      }
    },
  }, 'Test the video API');

  const cacheLine = el('div', { class: 'small muted', style: { marginTop: '10px' } });
  edb.mediaCacheSize().then((n) => { cacheLine.textContent = `${n} animation${n === 1 ? '' : 's'} cached on this device.`; });

  const advanced = el('details', { style: { marginTop: '12px' } },
    el('summary', { class: 'small muted', style: { cursor: 'pointer', padding: '4px 0' }, text: 'Advanced endpoint settings' }),
    el('div', { style: { marginTop: '10px' } },
      field('Exercises path', c.basePath, '/exercises', (v) => { c.basePath = v; saveSettings(); },
        'Filled in automatically by the test above.'),
      field('Media URL template', c.mediaTemplate || edb.DEFAULT_MEDIA_TEMPLATE, edb.DEFAULT_MEDIA_TEMPLATE,
        (v) => { c.mediaTemplate = v; saveSettings(); },
        'Placeholders: {id} exercise id, {file} the file name from the record, {res} resolution.'),
      field('Video API host (optional)', c.videoHost, 'edb-with-videos-….p.rapidapi.com', (v) => { c.videoHost = v; saveSettings(); },
        'Only needed if your videos come from your second subscription.'),
      field('Video API key (optional)', c.videoKey, '', (v) => { c.videoKey = v; saveSettings(); }, '', 'password'),
      el('button', {
        class: 'btn btn-ghost btn-block btn-sm', type: 'button', style: { marginTop: '8px' },
        onclick: async () => { await edb.clearMediaCache(); cacheLine.textContent = '0 animations cached on this device.'; toast('Media cache cleared'); },
      }, 'Clear cached animations')));

  return card('Exercise animations', [
    el('p', { class: 'small muted', style: { marginTop: '-2px', marginBottom: '12px', lineHeight: '1.5' } },
      'Subscribe to an ExerciseDB API on RapidAPI, then paste the host and key from its code snippet. Run both tests below: the first finds the exercise endpoint, the second finds the route that serves the animations. Media is downloaded once per exercise and cached, so browsing does not eat your monthly quota.'),
    host, key,
    el('label', { class: 'field' }, el('span', { class: 'label', text: 'Preferred media' }), prefer),
    testBtn,
    edb.isConfigured() ? mediaBtn : null,
    edb.hasVideoApi() ? videoBtn : null,
    edb.isReady() ? linkBtn : null,
    statusLine, log, cacheLine, advanced,
  ]);
}

/* ---------- GitHub sync --------------------------------------------------- */

function syncCard() {
  const c = settings.sync;
  const statusLine = el('div', { class: 'small', style: { marginTop: '10px', minHeight: '20px' } });

  const token = field('Access token', c.token, 'github_pat_…', (v) => { c.token = v.trim(); saveSettings(); },
    'A fine-grained personal access token with “Contents: Read and write” on your data repository only. It is stored on this device and never committed.', 'password');
  const owner = field('GitHub user', c.owner, 'your-username', (v) => { c.owner = v.trim(); saveSettings(); },
    'Filled in automatically when you connect.');
  const repo = field('Data repository', c.repo, 'liftlog-data', (v) => { c.repo = v.trim(); saveSettings(); },
    'A private repository you own. Create it empty on GitHub first.');
  const path = field('File in the repository', c.path, 'liftlog.json', (v) => { c.path = v.trim() || 'liftlog.json'; saveSettings(); });

  const connectBtn = el('button', {
    class: 'btn btn-primary btn-block', type: 'button',
    onclick: async () => {
      connectBtn.disabled = true;
      connectBtn.textContent = 'Connecting…';
      try {
        const info = await sync.verify();
        owner.querySelector('input').value = settings.sync.owner;
        c.enabled = true;
        saveSettings();
        statusLine.innerHTML = '';
        statusLine.append(
          el('span', { class: 'tag primary', text: info.private ? 'Private repo' : 'Public repo' }),
          ' ', `${info.repo} as ${info.login}`);
        if (!info.private) toast('That repository is public — anyone can read your log', 'err');
        await sync.syncNow({ silent: false });
        toast('Sync connected', 'ok');
        navigate('settings');
      } catch (err) {
        statusLine.textContent = err.message;
        toast('Could not connect', 'err');
      } finally {
        connectBtn.disabled = false;
        connectBtn.textContent = 'Connect and sync';
      }
    },
  }, 'Connect and sync');

  const syncBtn = el('button', {
    class: 'btn btn-ghost btn-block', type: 'button', style: { marginTop: '8px' },
    onclick: async () => {
      syncBtn.disabled = true;
      const result = await sync.syncNow();
      syncBtn.disabled = false;
      toast(result.ok ? 'Synced' : `Sync failed: ${result.reason}`, result.ok ? 'ok' : 'err');
      navigate('settings');
    },
  }, icon(ICONS.cloud), 'Sync now');

  if (sync.isConfigured()) {
    statusLine.append(
      el('span', { class: `tag${sync.status.state === 'error' ? '' : ' primary'}`, text: labelForState(sync.status.state) }),
      ' ', `last sync ${sync.lastSyncLabel()}`,
      sync.status.message ? el('div', { class: 'small muted', style: { marginTop: '4px' }, text: sync.status.message }) : null);
  } else {
    statusLine.textContent = 'Not connected. Your data currently lives only in this browser.';
  }

  const help = el('details', { style: { marginTop: '12px' } },
    el('summary', { class: 'small muted', style: { cursor: 'pointer', padding: '4px 0' }, text: 'How do I create the token?' }),
    el('ol', { class: 'instructions', style: { marginTop: '10px' } },
      el('li', { text: 'On GitHub, create a new private repository — liftlog-data is the default name here.' }),
      el('li', { text: 'Open Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.' }),
      el('li', { text: 'Under Repository access choose “Only select repositories” and pick liftlog-data.' }),
      el('li', { text: 'Under Repository permissions set Contents to “Read and write”. No other permission is needed.' }),
      el('li', { text: 'Generate the token, copy it, and paste it above. Reconnect when it expires.' })));

  return card('Backup & sync', [
    el('p', { class: 'small muted', style: { marginTop: '-2px', marginBottom: '12px', lineHeight: '1.5' } },
      'Your training log is kept in one JSON file in a private GitHub repository. Every save is a commit, so you get a full history and can open the app on another device by pasting the same token.'),
    token, owner, repo, path,
    settings.sync.token ? toggleSync() : null,
    connectBtn,
    sync.isConfigured() ? syncBtn : null,
    statusLine, help,
  ]);
}

function toggleSync() {
  const c = settings.sync;
  const sw = el('button', {
    class: `switch${c.enabled ? ' on' : ''}`, type: 'button', role: 'switch', 'aria-checked': String(!!c.enabled),
    'aria-label': 'Automatic sync',
    onclick: (e) => {
      c.enabled = !c.enabled;
      e.currentTarget.classList.toggle('on', c.enabled);
      saveSettings();
      if (c.enabled) sync.syncNow();
    },
  });
  return el('div', { class: 'switch-row' },
    el('div', { class: 'grow' },
      el('div', { class: 'sw-label', text: 'Sync automatically' }),
      el('div', { class: 'sw-hint', text: 'Pulls on launch and saves a few seconds after each change.' })),
    sw);
}

const labelForState = (state) => ({
  ok: 'Synced', syncing: 'Syncing', error: 'Error', offline: 'Offline', paused: 'Paused', disabled: 'Off',
}[state] || state);

/* ---------- data ---------------------------------------------------------- */

function dataCard() {
  const workouts = finishedWorkouts();
  const rows = el('div', { class: 'stat-grid', style: { marginBottom: '14px' } },
    stat(String(workouts.length), 'Workouts'),
    stat(String(activeRoutines().length), 'Routines'),
    stat(String(allExercises().length), 'Exercises'));

  const oldest = workouts[workouts.length - 1];

  return card('Your data', [
    rows,
    oldest ? el('p', { class: 'small muted', text: `Training logged since ${fmtDate(oldest.startedAt, { absolute: true })}.` }) : null,
    el('button', {
      class: 'btn btn-danger btn-block', type: 'button', style: { marginTop: '12px' },
      onclick: async () => {
        const ok = await confirmSheet({
          title: 'Erase local data',
          message: 'Deletes every workout, routine and custom exercise stored in this browser. If sync is connected, the copy in GitHub is kept and will be pulled back on the next sync.',
          confirmLabel: 'Erase', danger: true,
        });
        if (!ok) return;
        db.exercises = []; db.routines = []; db.workouts = [];
        settings.active = null;
        settings.seeded = false;
        saveSettings();
        localStorage.removeItem('liftlog.db.v1');
        location.reload();
      },
    }, icon(ICONS.trash), 'Erase data on this device'),
  ]);
}

const stat = (value, key) =>
  el('div', { class: 'stat' },
    el('div', { class: 'stat-val', text: value }),
    el('div', { class: 'stat-key', text: key }));

/* ---------- shared -------------------------------------------------------- */

function card(title, children) {
  return el('div', { class: 'section' },
    el('div', { class: 'section-head' }, el('h2', { text: title })),
    el('div', { class: 'card' }, ...children.filter(Boolean)));
}

function field(label, value, placeholder, onChange, hint = '', type = 'text') {
  const input = el('input', {
    class: 'input', type, value: value || '', placeholder, autocomplete: 'off',
    autocapitalize: 'none', spellcheck: false,
    oninput: (e) => onChange(e.target.value),
  });
  return el('label', { class: 'field' },
    el('span', { class: 'label', text: label }),
    input,
    hint ? el('span', { class: 'hint', text: hint }) : null);
}
