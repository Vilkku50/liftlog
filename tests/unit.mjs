/* Logic tests for the parts a browser click-through cannot reach: the sync
 * merge, the GitHub round trip and ExerciseDB endpoint discovery. No
 * dependencies — run it with:
 *
 *   node tests/unit.mjs
 */

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
};
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true, platform: 'test', vibrate() {} }, configurable: true, writable: true,
});

let failures = 0;
const ok = (name, cond, extra = '') => {
  if (cond) console.log(`✓ ${name}`);
  else { console.log(`✗ ${name} ${extra}`); failures += 1; }
};
const eq = (name, a, b) => ok(name, JSON.stringify(a) === JSON.stringify(b), `\n   got ${JSON.stringify(a)}\n   want ${JSON.stringify(b)}`);

const BASE = new URL('../js', import.meta.url).href;
const sync = await import(`${BASE}/sync.js`);
const state = await import(`${BASE}/state.js`);
const edb = await import(`${BASE}/edb.js`);

/* ---------- merge --------------------------------------------------------- */

const local = {
  schema: 1,
  exercises: [],
  routines: [{ id: 'r1', name: 'Local newer', updatedAt: '2026-02-02T00:00:00Z' }],
  workouts: [
    { id: 'w1', name: 'only local', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'w2', name: 'deleted here', deleted: true, updatedAt: '2026-03-01T00:00:00Z' },
  ],
};
const remote = {
  schema: 1,
  exercises: [{ id: 'e1', name: 'remote only', updatedAt: '2026-01-01T00:00:00Z' }],
  routines: [{ id: 'r1', name: 'Remote older', updatedAt: '2026-01-01T00:00:00Z' }],
  workouts: [
    { id: 'w2', name: 'deleted here', updatedAt: '2026-02-01T00:00:00Z' },
    { id: 'w3', name: 'only remote', updatedAt: '2026-01-05T00:00:00Z' },
  ],
};
const merged = sync.mergeDocs(local, remote).doc;
eq('newer record wins the merge', merged.routines[0].name, 'Local newer');
ok('remote-only records are kept', merged.exercises.some((e) => e.id === 'e1') && merged.workouts.some((w) => w.id === 'w3'));
ok('a newer tombstone is not resurrected', merged.workouts.find((w) => w.id === 'w2').deleted === true);
eq('nothing is lost', merged.workouts.length, 3);
ok('no remote doc means no change', sync.mergeDocs(local, null).changed === false);

/* ---------- GitHub round trip (mocked) ------------------------------------ */

const commits = [];
let remoteFile = null;

globalThis.fetch = async (url, options = {}) => {
  const u = String(url);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.endsWith('/user')) return json({ login: 'tester' });
  if (u.includes('/repos/tester/liftlog-data/contents/')) {
    if (options.method === 'PUT') {
      const body = JSON.parse(options.body);
      if (remoteFile && body.sha !== remoteFile.sha) return json({ message: 'conflict' }, 409);
      remoteFile = { content: body.content, sha: `sha${commits.length + 1}` };
      commits.push(body.message);
      return json({ content: { sha: remoteFile.sha } });
    }
    if (!remoteFile) return json({ message: 'Not Found' }, 404);
    return json({ content: remoteFile.content, sha: remoteFile.sha });
  }
  if (u.includes('/repos/tester/liftlog-data')) return json({ full_name: 'tester/liftlog-data', private: true, default_branch: 'main' });
  return json({ message: 'unexpected ' + u }, 500);
};

state.loadAll();
Object.assign(state.settings.sync, { token: 'tok', owner: '', repo: 'liftlog-data', path: 'liftlog.json', branch: 'main', enabled: true });

const info = await sync.verify();
eq('verify resolves the account', info.login, 'tester');
eq('verify fills in the owner', state.settings.sync.owner, 'tester');

const startedWith = state.db.routines.length;
ok('starter routines exist before the first sync', startedWith === 3, `got ${startedWith}`);

const first = await sync.syncNow({ silent: false });
ok('first sync succeeds', first.ok);
eq('first sync creates one commit', commits.length, 1);

const pushed = JSON.parse(Buffer.from(remoteFile.content, 'base64').toString('utf8'));
eq('the pushed document carries the routines', pushed.routines.length, 3);
ok('no token is written to the repository', !JSON.stringify(pushed).includes('tok'));

await sync.syncNow();
eq('an unchanged sync makes no new commit', commits.length, 1);

// A second device adds a workout straight into the file.
const other = JSON.parse(Buffer.from(remoteFile.content, 'base64').toString('utf8'));
other.workouts.push({ id: 'w-remote', name: 'From the other phone', startedAt: '2026-03-01T10:00:00Z', finishedAt: '2026-03-01T11:00:00Z', entries: [], updatedAt: '2026-03-01T11:00:00Z' });
remoteFile = { content: Buffer.from(JSON.stringify(other)).toString('base64'), sha: 'sha-other' };

await sync.syncNow();
ok('a workout added elsewhere is pulled in', state.db.workouts.some((w) => w.id === 'w-remote'));

/* ---------- UTF-8 through base64 ------------------------------------------ */

state.upsertRoutine({ name: 'Jalkapäivä — hauis & selkä', items: [] });
await sync.syncNow();
const withUtf8 = JSON.parse(Buffer.from(remoteFile.content, 'base64').toString('utf8'));
ok('non-ASCII names survive the round trip', withUtf8.routines.some((r) => r.name === 'Jalkapäivä — hauis & selkä'));

/* ---------- ExerciseDB discovery + normalisation --------------------------- */

const V2_SAMPLE = {
  exerciseId: 'exr_41n2hZZdH9uyYFGZ',
  name: 'Lever Pec Deck Fly',
  imageUrl: 'Lever-Pec-Deck-Fly-Chest.png',
  equipments: ['LEVERAGE MACHINE'],
  bodyParts: ['CHEST'],
  exerciseType: 'STRENGTH',
  targetMuscles: ['Pectoralis Major Clavicular Head'],
  secondaryMuscles: ['Deltoid Anterior'],
  videoUrl: 'Lever-Pec-Deck-Fly-Chest.mp4',
  instructions: ['Sit on the pec deck machine.', 'Push the levers together.'],
  exerciseTips: ['Controlled movements.'],
  variations: ['Cable Crossover'],
};

const shaped = edb.normalize(V2_SAMPLE);
eq('v2 id is read', shaped.edbId, 'exr_41n2hZZdH9uyYFGZ');
eq('equipment is title-cased', shaped.equipments, ['Leverage Machine']);
eq('body parts are title-cased', shaped.bodyParts, ['Chest']);
eq('instructions come through', shaped.instructions.length, 2);
eq('tips come through', shaped.tips.length, 1);

// A legacy-shaped record from the older API must also work.
const legacy = edb.normalize({ id: '0025', name: 'barbell bench press', bodyPart: 'chest', target: 'pectorals', equipment: 'barbell', gifUrl: 'https://cdn/x.gif', instructions: ['Lie down.'] });
eq('legacy single-value fields become arrays', legacy.bodyParts, ['Chest']);
eq('legacy gif url is used as the image', legacy.imageUrl, 'https://cdn/x.gif');

// Discovery: this fake API answers only on /api/v1/exercises and only honours ?q=
const catalogue = [
  { exerciseId: '1', name: 'Bench Press', bodyParts: ['chest'] },
  { exerciseId: '2', name: 'Overhead Press', bodyParts: ['shoulders'] },
  { exerciseId: '3', name: 'Barbell Row', bodyParts: ['back'] },
];
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  if (u.pathname !== '/api/v1/exercises') return json({ message: 'no route' }, 404);
  const q = u.searchParams.get('q');
  const list = q ? catalogue.filter((e) => e.name.toLowerCase().includes(q.toLowerCase())) : catalogue;
  return json({ success: true, data: { exercises: list } });
};
Object.assign(state.settings.edb, { host: 'fake.p.rapidapi.com', key: 'k', basePath: '', searchStyle: '' });

const found = await edb.probe();
eq('discovery finds the working path', found.basePath, '/api/v1/exercises');
eq('discovery finds the search parameter', found.searchStyle, 'q');

const results = await edb.search({ query: 'press' });
eq('search returns normalised matches', results.map((r) => r.name), ['Bench Press', 'Overhead Press']);

// With no server-side search, filtering must still happen on the device.
state.settings.edb.searchStyle = 'client';
const clientSide = await edb.search({ query: 'row' });
eq('client-side filtering works as a fallback', clientSide.map((r) => r.name), ['Barbell Row']);

console.log(failures ? `\n${failures} failing check(s)` : '\nall checks passed');
process.exit(failures ? 1 : 0);
