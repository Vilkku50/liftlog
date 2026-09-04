# LiftLog

A gym workout tracker that installs to your phone's home screen. Log every set
between sets, follow your own routines, watch the movement animation when you
are unsure of a lift, and keep the whole log backed up in a private GitHub
repository — with no server, no account and no build step.

**Live app:** `https://<username>.github.io/liftlog/`

## What it does

- **Log sets fast.** Weight and reps per set, one tap to complete, warm-up sets,
  per-exercise notes. The previous session's numbers sit next to every row and
  fill themselves in if you just tap the checkmark.
- **Rest timer.** Starts automatically on a completed working set, counts down
  from an absolute end time (so it stays right when the screen is off), and
  buzzes and beeps when it is time to lift again.
- **Routines.** Reusable templates — Push / Pull / Legs come pre-made — with
  target sets, reps and rest per exercise. Starting one pre-fills the session.
- **History and stats.** Every session by month, weekly volume, sets per body
  part, per-exercise estimated-1RM trend, and automatic personal records.
- **Exercise library.** 99 built-in movements that work offline plus ExerciseDB's
  full online catalogue, with animations, step-by-step instructions and
  coaching cues.
- **Works offline.** The whole app is cached by a service worker, so it runs in a
  basement gym with no signal. Nothing is lost when the connection drops.

## Install on your phone

1. Open the published URL in Chrome (Android) or Safari (iOS).
2. Menu → **Add to Home screen** / **Install app**.
3. It then runs full-screen with its own icon, like any other app.

To publish it yourself: push to `main` and the included workflow deploys to
GitHub Pages. If Pages has never been enabled on the repository, enable it under
*Settings → Pages → Source: GitHub Actions* (the workflow also attempts this
automatically).

## Setting up exercise animations (optional)

Animations and instructions come from an **ExerciseDB** API on RapidAPI. The app
is fully usable without it — you just get no animations.

1. Subscribe to an ExerciseDB API on RapidAPI (the GIF edition is the better fit;
   the video edition works too).
2. On the API's RapidAPI page, open the code snippet and copy the
   `X-RapidAPI-Host` and `X-RapidAPI-Key` values.
3. In LiftLog: **Settings → Exercise animations**, paste both, then press
   **Test connection & auto-detect**, and after it succeeds **Find the media
   route**.

Both steps matter. The two editions differ in base path and search
parameter, and providers change them, so the app does not hard-code a guess: it
tries `/exercises`, `/api/v1/exercises`, `/api/v2/exercises`, `/v1/exercises` and
`/v2/exercises` against *your* subscription, works out which search parameter is
honoured, and stores what actually answered. The log of what it tried is shown on
screen, so a failure tells you what to fix. If your plan uses a different media
route, override the URL template under *Advanced endpoint settings*.

The second button does the same job for media, which arrives in one of two
shapes depending on the edition:

- **A full CDN URL** (`https://assets.exercisedb.dev/media/….png`). It is handed
  straight to the `<img>` tag. That matters: the media CDN sends no CORS
  headers, so `fetch()` is blocked while the plain tag loads it fine — reading
  the image into a blob first would show nothing at all.
- **A bare file name**, served from a key-protected route on the API host. Those
  differ per edition, so the app tries the known shapes (`/image?exerciseId=…`,
  `/images/{file}`, `/media/{file}` and others) against your subscription and
  keeps whichever returns a real image. Because these need the key in a request
  header, they are fetched and cached as blobs in the Cache Storage API —
  downloaded **once per device**, so browsing costs no extra quota.

The same test also reports how many of the sampled records are animated versus
still images, and whether a per-exercise route exists for the step-by-step
instructions. If nothing works, it prints the raw record so the right route can
be added.

The 99 built-in exercises carry no ExerciseDB id, so the first time you open one
the app looks its name up once, stores the match on the exercise, and every
later open is instant and offline. That link syncs with the rest of your data,
so a second device does not spend the lookup again.

## Setting up backup and sync (optional)

Your data lives in this browser only until you connect sync. Sync keeps one JSON
file in a **private GitHub repository** you own; every save is a commit, so you
also get a complete version history of your training, and a second device picks
up the log by pasting the same token.

1. Create a new **private** repository — `liftlog-data` is the name the app
   expects by default. It can be empty.
2. GitHub → *Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token*.
3. **Repository access:** *Only select repositories* → `liftlog-data`.
4. **Repository permissions:** *Contents* → **Read and write**. Nothing else is
   needed.
5. Paste the token into **Settings → Backup & sync** and press **Connect and
   sync**.

After that the app pulls on launch and saves a few seconds after each change.
Two devices editing the same log merge per record by `updatedAt`, deletions are
tombstones so they are not resurrected by an older copy, and a push that races
another device retries against the fresh remote state.

### About the token

- It is stored in this browser's `localStorage` and is **never** written into the
  synced file, committed, or sent anywhere except `api.github.com`.
- Scope it to the one data repository. A fine-grained token expires (up to about
  a year), and reconnecting is just pasting a new one.
- The RapidAPI key is treated the same way: device-local, never synced.

Because the app is served from GitHub Pages as static files, there is no server
to hold secrets on your behalf — which is exactly why both keys are entered in
the app rather than baked into the source.

## Project layout

```
index.html            app shell: top bar, view container, tab bar
css/app.css           design tokens and every component style
js/app.js             bootstrap, shell wiring, wake lock, service worker
js/router.js          view registry and teardown
js/state.js           the data model, persistence, derived stats
js/seed.js            the 99 built-in exercises
js/session.js         starting a workout without losing a running one
js/sync.js            GitHub backup: pull, merge, push
js/edb.js             ExerciseDB adapter: discovery, search, media cache
js/rest.js            rest timer
js/picker.js          shared exercise picker
js/exercise-detail.js animation, instructions and your numbers per exercise
js/views/*.js         home, routines, workout, history, library, settings
sw.js                 offline shell cache
tests/                logic tests and a browser walk-through
```

No framework, no build step, no dependencies — the browser loads the ES modules
directly, which is also why it starts instantly on a phone.

## Data model

One JSON document, three collections (`exercises`, `routines`, `workouts`). Every
record carries `id` and `updatedAt`, and deletions set `deleted: true` instead of
removing the record — that is what makes a serverless two-device merge possible.
Device-local state (tokens, preferences, the workout in progress) is kept
separately and never synced.

## Tests

```bash
node tests/unit.mjs                       # merge, GitHub round trip, API discovery

npx http-server -p 8181 -c-1 --silent .   # in one shell
node tests/e2e.mjs                        # in another: full Playwright walk-through
```

The logic tests mock both `api.github.com` and an ExerciseDB-shaped API, so they
run offline and with no keys. Both suites also run in CI on every push.
