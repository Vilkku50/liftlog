/* Browser walk-through of the whole app. Needs Playwright and a static server:
 *
 *   npx http-server -p 8181 -c-1 .
 *   SP=./screenshots node tests/e2e.mjs
 */
import { chromium, devices } from 'playwright';

const OUT = process.env.SP || 'screenshots';
await import('node:fs').then(({ mkdirSync }) => mkdirSync(OUT, { recursive: true }));
const BASE = 'http://127.0.0.1:8181';
const errors = [];

const browser = await chromium.launch(
  process.env.CHROME ? { executablePath: process.env.CHROME } : {},
);
const ctx = await browser.newContext({ ...devices['Pixel 7'] });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const step = async (name, fn) => {
  try { await fn(); console.log(`✓ ${name}`); }
  catch (e) { console.log(`✗ ${name}: ${e.message}`); errors.push(`${name}: ${e.message}`); }
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

await step('home renders with routines', async () => {
  await page.waitForSelector('text=Start empty workout');
  const count = await page.locator('.row-title', { hasText: 'Push' }).count();
  if (count === 0) throw new Error('starter routine missing');
});
await step('sync chip hidden until sync is configured', async () => {
  const visible = await page.locator('#sync-chip').isVisible();
  if (visible) throw new Error('sync chip shown while sync is off');
});
await page.screenshot({ path: `${OUT}/shot-home.png` });

await step('start workout from routine', async () => {
  await page.locator('button.row', { hasText: 'Push' }).first().click();
  await page.waitForSelector('.wk-head');
  const cards = await page.locator('.ex-card').count();
  if (cards !== 5) throw new Error(`expected 5 exercise cards, got ${cards}`);
});

await step('app bar shows the workout name', async () => {
  const title = await page.locator('#view-title').textContent();
  if (!title.startsWith('Push')) throw new Error(`title was "${title}"`);
});

await step('log a set', async () => {
  const first = page.locator('.ex-card').first();
  await first.locator('.set-in').nth(0).fill('80');
  await first.locator('.set-in').nth(1).fill('8');
  await first.locator('.set-check').first().click();
  await page.waitForSelector('.set-row.done');
  await page.waitForSelector('#rest-bar');
});
await page.screenshot({ path: `${OUT}/shot-workout.png` });

await step('rest timer counts down', async () => {
  const t1 = await page.locator('#rest-bar .rest-time').textContent();
  await page.waitForTimeout(1200);
  const t2 = await page.locator('#rest-bar .rest-time').textContent();
  if (t1 === t2) throw new Error(`timer stuck at ${t1}`);
});

await step('second set carries the previous numbers', async () => {
  const first = page.locator('.ex-card').first();
  await first.locator('.set-check').nth(1).click();
  const done = await page.locator('.ex-card').first().locator('.set-row.done').count();
  if (done !== 2) throw new Error(`expected 2 done sets, got ${done}`);
});

await step('add exercise via picker', async () => {
  await page.locator('button', { hasText: 'Add exercise' }).last().click();
  await page.waitForSelector('.sheet');
  await page.locator('.sheet input[type=search]').fill('lat pulldown');
  await page.waitForTimeout(250);
  await page.locator('.sheet .row').first().click();
  await page.locator('.sheet-foot .btn-primary').click();
  await page.waitForTimeout(300);
  const cards = await page.locator('.ex-card').count();
  if (cards !== 6) throw new Error(`expected 6 cards after adding, got ${cards}`);
});

await step('finish workout and see the summary', async () => {
  await page.locator('.wk-head button', { hasText: 'Finish' }).click();
  await page.waitForSelector('.sheet');
  await page.locator('.sheet-foot .btn-primary', { hasText: 'Finish' }).click();
  await page.waitForSelector('.sheet-head h3:has-text("Workout saved")');
});
await page.screenshot({ path: `${OUT}/shot-summary.png` });
await page.locator('.sheet-foot .btn-primary', { hasText: 'Done' }).click();
await page.waitForTimeout(300);

await step('rest timer is cleared when the workout ends', async () => {
  if (await page.locator('#rest-bar').count()) throw new Error('rest bar still on screen');
  const cls = await page.evaluate(() => document.body.className);
  if (cls.includes('resting')) throw new Error('body still marked resting');
});

await step('history lists the finished session', async () => {
  await page.locator('#tabbar .tab', { hasText: 'History' }).click();
  await page.waitForSelector('.segmented');
  const rows = await page.locator('.row-title').count();
  if (rows < 1) throw new Error('no workout listed');
});
await page.screenshot({ path: `${OUT}/shot-history.png` });

await step('stats tab renders charts', async () => {
  await page.locator('.segmented button', { hasText: 'Stats' }).click();
  await page.waitForSelector('svg.chart');
  await page.waitForSelector('text=Personal records');
});
await page.screenshot({ path: `${OUT}/shot-stats.png` });

await step('library searches locally', async () => {
  await page.locator('#tabbar .tab', { hasText: 'Library' }).click();
  await page.waitForSelector('input[type=search]');
  await page.locator('#view input[type=search]').fill('squat');
  await page.waitForTimeout(250);
  const n = await page.locator('#view .row').count();
  if (n < 2) throw new Error(`expected squat matches, got ${n}`);
});
await page.screenshot({ path: `${OUT}/shot-library.png` });

await step('exercise detail opens without a key', async () => {
  await page.locator('#view .row').first().click();
  await page.waitForSelector('.media-box');
  await page.waitForSelector('text=Connect ExerciseDB');
  await page.locator('.sheet-head .icon-btn').click();
});

await step('settings renders both integrations', async () => {
  await page.locator('#settings-btn').click();
  await page.waitForSelector('text=Exercise animations');
  await page.waitForSelector('text=Backup & sync');
});
await step('no tab is highlighted on settings', async () => {
  const n = await page.locator('#tabbar .tab.active').count();
  if (n !== 0) throw new Error(`${n} tabs still marked active`);
});
await page.screenshot({ path: `${OUT}/shot-settings.png` });

await step('routines editor saves a new routine', async () => {
  await page.locator('#tabbar .tab', { hasText: 'Routines' }).click();
  await page.locator('button', { hasText: 'New routine' }).click();
  await page.waitForSelector('.sheet');
  await page.locator('.sheet input.input').first().fill('Test Routine');
  await page.locator('.sheet button', { hasText: 'Add exercise' }).click();
  await page.waitForTimeout(200);
  await page.locator('.sheet input[type=search]').last().fill('bench');
  await page.waitForTimeout(300);
  await page.locator('.sheet .row').first().click();
  await page.locator('.sheet-foot .btn-primary').last().click();
  await page.waitForTimeout(200);
  await page.locator('.sheet-foot .btn-primary', { hasText: 'Save routine' }).click();
  await page.waitForTimeout(400);
  const found = await page.locator('.row-title', { hasText: 'Test Routine' }).count();
  if (!found) throw new Error('new routine not listed');
});
await page.screenshot({ path: `${OUT}/shot-routines.png` });

await step('starting again while a session runs offers resume', async () => {
  await page.locator('#tabbar .tab', { hasText: 'Home' }).click();
  await page.locator('button', { hasText: 'Start empty workout' }).click();
  await page.waitForSelector('.wk-head');
  await page.locator('#tabbar .tab', { hasText: 'Home' }).click();
  await page.locator('button', { hasText: 'Start empty workout' }).click();
  await page.waitForSelector('.sheet-head h3:has-text("already running")');
  await page.locator('.sheet button', { hasText: 'Resume' }).click();
  await page.waitForSelector('.wk-head');
  const title = await page.locator('#view-title').textContent();
  if (title !== 'Workout') throw new Error(`resumed into "${title}"`);
});

await step('resume banner appears away from the workout', async () => {
  await page.locator('#tabbar .tab', { hasText: 'History' }).click();
  await page.waitForTimeout(200);
  if (!(await page.locator('#resume-bar').isVisible())) throw new Error('resume banner hidden');
  await page.locator('#resume-bar').click();
  await page.waitForSelector('.wk-head');
  await page.locator('button', { hasText: 'Discard workout' }).click();
  await page.locator('.sheet-foot .btn-danger', { hasText: 'Discard' }).click();
  await page.waitForTimeout(300);
});

await step('state survives a reload', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.locator('#tabbar .tab', { hasText: 'History' }).click();
  await page.waitForTimeout(300);
  const rows = await page.locator('.row-title').count();
  if (rows < 1) throw new Error('history empty after reload');
});

await step('service worker registered', async () => {
  const ok = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return Boolean(reg);
  });
  if (!ok) throw new Error('no service worker registration');
});

await step('the app shell never scrolls the page itself', async () => {
  for (const tab of ['Home', 'Routines', 'History', 'Library']) {
    await page.locator('#tabbar .tab', { hasText: tab }).click();
    await page.waitForTimeout(150);
    const m = await page.evaluate(() => ({
      overflow: getComputedStyle(document.body).overflow,
      slack: document.scrollingElement.scrollHeight - window.innerHeight,
      tabBottom: document.getElementById('tabbar').getBoundingClientRect().bottom,
      inner: window.innerHeight,
    }));
    if (m.overflow !== 'hidden') throw new Error(`${tab}: body overflow is ${m.overflow}`);
    if (m.slack > 1) throw new Error(`${tab}: page can scroll ${m.slack}px`);
    if (m.tabBottom > m.inner + 1) throw new Error(`${tab}: tab bar sits ${m.tabBottom - m.inner}px below the fold`);
  }
});

/* ---- animations, against a stand-in for the RapidAPI edition -------------- */

await step('a built-in exercise links itself to ExerciseDB and shows the animation', async () => {
  const { readFileSync } = await import('node:fs');
  const imageBytes = readFileSync(new URL('../icons/icon-192.png', import.meta.url));

  const ctx2 = await browser.newContext({ ...devices['Pixel 7'] });
  const p2 = await ctx2.newPage();
  const seen = [];

  // Stand in for the API: exercises on /api/v1/exercises, media on /images/{file}.
  await ctx2.route('https://fake.p.rapidapi.com/**', async (route) => {
    const u = new URL(route.request().url());
    seen.push(u.pathname);
    if (!route.request().headers()['x-rapidapi-key']) {
      return route.fulfill({ status: 401, body: 'no key' });
    }
    if (u.pathname === '/api/v1/exercises') {
      const q = (u.searchParams.get('q') || '').toLowerCase();
      const all = [{
        exerciseId: 'exr_1',
        name: 'Barbell Bench Press',
        bodyParts: ['chest'],
        targetMuscles: ['Pectoralis Major'],
        equipments: ['barbell'],
        imageUrl: 'bench.gif',
        instructions: ['Lie flat on the bench.', 'Press the bar to lockout.'],
        exerciseTips: ['Keep the shoulder blades retracted.'],
      }];
      const list = q ? all.filter((e) => e.name.toLowerCase().includes(q)) : all;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { exercises: list } }) });
    }
    if (u.pathname === '/images/bench.gif') {
      return route.fulfill({ status: 200, contentType: 'image/png', body: imageBytes });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"no route"}' });
  });

  await p2.addInitScript(() => {
    localStorage.setItem('liftlog.settings.v1', JSON.stringify({
      unit: 'kg', restDefault: 120, seeded: true,
      edb: {
        host: 'fake.p.rapidapi.com', key: 'k', basePath: '/api/v1/exercises',
        searchStyle: 'q', mediaTemplate: '/images/{file}', prefer: 'gif',
      },
      sync: { token: '', owner: '', repo: 'liftlog-data', path: 'liftlog.json', branch: 'main', enabled: false },
    }));
  });

  await p2.goto(BASE, { waitUntil: 'networkidle' });
  await p2.locator('#tabbar .tab', { hasText: 'Library' }).click();
  await p2.locator('#view input[type=search]').fill('barbell bench press');
  await p2.waitForTimeout(300);
  await p2.locator('#view .row').first().click();

  await p2.waitForSelector('.media-box img', { timeout: 8000 });
  const loaded = await p2.locator('.media-box img').evaluate((img) => img.complete && img.naturalWidth > 0);
  if (!loaded) throw new Error('the image element never decoded');

  await p2.waitForSelector('.instructions li');
  const steps = await p2.locator('.instructions li').count();
  if (steps !== 2) throw new Error(`expected 2 instruction steps, got ${steps}`);

  if (!seen.includes('/images/bench.gif')) throw new Error(`media route never requested; saw ${seen.join(', ')}`);

  // The discovered link must be stored, so the next open costs no search call.
  // Writes to localStorage are debounced, so give them a moment to land.
  await p2.waitForTimeout(600);
  const stored = await p2.evaluate(() => JSON.parse(localStorage.getItem('liftlog.db.v1') || '{}'));
  const linked = (stored.exercises || []).find((e) => e.id === 'sx-barbell-bench-press');
  if (!linked || linked.edbId !== 'exr_1') throw new Error('the ExerciseDB id was not saved onto the exercise');

  await p2.screenshot({ path: `${OUT}/shot-animation.png` });
  await ctx2.close();
});

await step('a full CDN media URL is shown even when fetch would be blocked by CORS', async () => {
  const { readFileSync } = await import('node:fs');
  const imageBytes = readFileSync(new URL('../icons/icon-512.png', import.meta.url));

  const ctx3 = await browser.newContext({ ...devices['Pixel 7'] });
  const p3 = await ctx3.newPage();
  let cdnHits = 0;

  await ctx3.route('https://fake.p.rapidapi.com/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname !== '/api/v1/exercises') {
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"no route"}' });
    }
    const q = (u.searchParams.get('q') || '').toLowerCase();
    // Shaped exactly like the real record: a full CDN URL, no instructions.
    const all = [{
      exerciseId: 'edb_0LC083m',
      name: 'barbell standing close grip curl',
      imageUrl: 'https://assets.example.test/media/d5xI91c.png',
      bodyParts: ['upper arms'],
      equipments: ['barbell'],
      targetMuscles: ['biceps'],
      secondaryMuscles: ['forearms'],
    }];
    const list = q ? all.filter((e) => e.name.includes(q)) : all;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { exercises: list } }) });
  });

  // Fulfilled without Access-Control-Allow-Origin: <img> can show it, fetch() cannot.
  await ctx3.route('https://assets.example.test/**', async (route) => {
    cdnHits += 1;
    return route.fulfill({ status: 200, contentType: 'image/png', body: imageBytes });
  });

  await p3.addInitScript(() => {
    localStorage.setItem('liftlog.settings.v1', JSON.stringify({
      unit: 'kg', restDefault: 120, seeded: true,
      edb: { host: 'fake.p.rapidapi.com', key: 'k', basePath: '/api/v1/exercises', searchStyle: 'q', mediaTemplate: '', prefer: 'gif' },
      sync: { token: '', owner: '', repo: 'liftlog-data', path: 'liftlog.json', branch: 'main', enabled: false },
    }));
  });

  await p3.goto(BASE, { waitUntil: 'networkidle' });
  await p3.locator('#tabbar .tab', { hasText: 'Library' }).click();
  // This movement is not in the built-in catalogue, so search ExerciseDB itself.
  await p3.locator('#view .segmented button', { hasText: 'ExerciseDB' }).click();
  await p3.locator('#view input[type=search]').fill('barbell standing close grip curl');
  await p3.waitForTimeout(600);
  await p3.locator('#view .row').first().click();

  await p3.waitForSelector('.media-box img', { timeout: 8000 });
  const shown = await p3.locator('.media-box img').evaluate((img) => ({
    src: img.src, decoded: img.complete && img.naturalWidth > 0,
  }));
  if (!shown.decoded) throw new Error('the CDN image never decoded');
  if (!shown.src.startsWith('https://assets.example.test/')) throw new Error(`expected the CDN URL, got ${shown.src}`);
  if (!cdnHits) throw new Error('the CDN was never asked for the image');

  await p3.waitForTimeout(400);   // let the sheet's entry animation settle
  await p3.screenshot({ path: `${OUT}/shot-cdn-media.png` });
  await ctx3.close();
});

await step('bulk linking fills the library with thumbnails, and a bad match can be fixed by hand', async () => {
  const { readFileSync } = await import('node:fs');
  const imageBytes = readFileSync(new URL('../icons/icon-192.png', import.meta.url));

  const ctx4 = await browser.newContext({ ...devices['Pixel 7'] });
  const p4 = await ctx4.newPage();

  // A catalogue that covers some built-ins exactly, and offers only a decoy for
  // Back Extension — the case that used to show the wrong movement.
  const catalogue = [
    { exerciseId: 'c1', name: 'barbell bench press', imageUrl: 'https://assets.example.test/m/1.png', bodyParts: ['chest'], targetMuscles: ['pectorals'], equipments: ['barbell'] },
    { exerciseId: 'c2', name: 'back squat', imageUrl: 'https://assets.example.test/m/2.png', bodyParts: ['upper legs'], targetMuscles: ['quads'], equipments: ['barbell'] },
    { exerciseId: 'c3', name: 'lever seated leg curl', imageUrl: 'https://assets.example.test/m/3.png', bodyParts: ['upper legs'], targetMuscles: ['hamstrings'], equipments: ['leverage machine'] },
    { exerciseId: 'c4', name: 'dumbbell lying triceps extension', imageUrl: 'https://assets.example.test/m/4.png', bodyParts: ['upper arms'], targetMuscles: ['triceps'], equipments: ['dumbbell'] },
  ];

  await ctx4.route('https://fake.p.rapidapi.com/**', async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname !== '/api/v1/exercises') {
      return route.fulfill({ status: 404, contentType: 'application/json', body: '{"message":"no route"}' });
    }
    const q = (u.searchParams.get('q') || '').toLowerCase();
    const offset = Number(u.searchParams.get('offset') || 0);
    const list = q ? catalogue.filter((e) => e.name.includes(q)) : catalogue.slice(offset);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { exercises: list } }) });
  });
  await ctx4.route('https://assets.example.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: imageBytes }));

  await p4.addInitScript(() => {
    localStorage.setItem('liftlog.settings.v1', JSON.stringify({
      unit: 'kg', restDefault: 120, seeded: true,
      edb: { host: 'fake.p.rapidapi.com', key: 'k', basePath: '/api/v1/exercises', searchStyle: 'q', mediaTemplate: '', prefer: 'gif' },
      sync: { token: '', owner: '', repo: 'liftlog-data', path: 'liftlog.json', branch: 'main', enabled: false },
    }));
  });
  await p4.goto(BASE, { waitUntil: 'networkidle' });

  await p4.locator('#settings-btn').click();
  await p4.locator('button', { hasText: 'Link my library to ExerciseDB' }).click();
  await p4.waitForSelector('.code:has-text("Linked")', { timeout: 20000 });
  const report = await p4.locator('.code').textContent();
  if (!/Linked [1-9]/.test(report)) throw new Error(`nothing was linked: ${report}`);
  if (!report.includes('Back Extension')) throw new Error('Back Extension should be reported as unmatched');

  await p4.locator('#tabbar .tab', { hasText: 'Library' }).click();
  await p4.waitForTimeout(400);
  const thumbs = await p4.locator('#view .row .lib-thumb img').count();
  if (thumbs < 3) throw new Error(`expected thumbnails on the linked rows, found ${thumbs}`);
  await p4.screenshot({ path: `${OUT}/shot-library-thumbs.png` });

  // The unmatched exercise must refuse to guess, and offer a manual fix.
  await p4.locator('#view input[type=search]').fill('back extension');
  await p4.waitForTimeout(300);
  await p4.locator('#view .row').first().click();
  await p4.waitForSelector('text=No confident match');
  await p4.locator('.sheet button', { hasText: 'Choose the right exercise' }).click();
  await p4.waitForSelector('.sheet-head h3:has-text("Link")');
  await p4.locator('.sheet input[type=search]').last().fill('extension');
  await p4.waitForTimeout(500);
  await p4.locator('.sheet .row').first().click();
  await p4.waitForSelector('.media-box img', { timeout: 8000 });
  const decoded = await p4.locator('.media-box img').evaluate((img) => img.complete && img.naturalWidth > 0);
  if (!decoded) throw new Error('the hand-picked exercise did not show its media');

  await ctx4.close();
});

await browser.close();
console.log('\n--- errors ---');
console.log(errors.length ? errors.join('\n') : 'none');
process.exit(errors.length ? 1 : 0);
