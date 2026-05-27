# rotvollfjaerafrontyardultra

A small local web app that reads live data from a RaceResult event and
shows it in pickable dashboards.

- **Backend:** Python + FastAPI + Uvicorn ([backend/app/main.py](backend/app/main.py))
- **Frontend:** Vite + React + TypeScript ([frontend/](frontend))
- Python project managed by [uv](https://docs.astral.sh/uv/) via [pyproject.toml](pyproject.toml)

## Dashboards

The dashboard dropdown lists, in order: **Settings** (Timer set-up),
**Overview** (number of participants), **Leaderboard**,
**Dashboard** (race timer), **Jerseys**.

- **Overview** — live participant counters with auto-refresh, color
  coded for at-a-glance reading. Top row: *Starting runners*
  (yellow), *Starting Females (K)* (red) and *Starting Males (M)*
  (blue). Middle row mirrors the
  three coloured cells for runners *still in competition* per
  gender. The bottom row shows *Current loop* (teal), *Acc.
  distance (km)* (green) summed across every completed loop, and
  *Registered participants* (neutral). When the race is finished the same
  `⏮ ◀ Loop N / max ▶ ⏭ Live` playback bar appears and the still-in
  counters / acc. distance follow the selected loop.
- **Leaderboard** — sortable table polled every 10 s. Columns:
  Total Rank, Bib, Full Name, Club, Country (flag), Gender, Laps,
  Gap, Last (lap), Fastest, Slowest, Average, Total Time,
  Total Distance, Status. Distance uses the loop length for the
  current Timer mode (6.706 km backyard, 3 km frontyard). In frontyard
  mode, the current Pink/Green/Yellow jersey holder for each gender
  is tagged next to their name with a jersey-coloured pill showing
  the **number of loops** they have held that jersey. A trailing `~`
  means the leader is **LIKELY** (lead > half of the runner-up's max
  catch-up); `✓` means the jersey is **DECIDED** (mathematically
  uncatchable); `★` means **FINISHED** (the jersey's last loop has
  been completed). A short legend above the gender tables explains
  the symbols. When the backend flags the race as finished, a
  playback bar appears with `⏮ ◀ Loop N / max ▶ ⏭ Live` controls so
  you can step through loop-by-loop snapshots: rows where the
  runner's final lap count is below N − 1 are hidden, and remaining
  rows have their laps/distance clamped to N. The selected loop is
  shared (via `localStorage`) with the Race dashboard, so both views
  stay in sync. In Frontyard mode the **overall winner** row for each
  gender (the runner with the fastest lap on the highest loop that
  any runner finished within the loop's time limit, up to the Yellow
  jersey end-loop) gets a `🏆` prefix in front of their name. The
  marker only appears once the race is over (the snapshot has reached
  the Yellow end-loop, or the backend has flagged the race as
  finished).
- **Settings (Timer set-up)** — configure the race start time, mode and per-event
  options (see below). All settings are stored in `localStorage`, keyed
  by event ID, and picked up live by the Race dashboard (same browser,
  via the `storage` event and a 2 s poll fallback). For a *finished*
  race the start date and mode are auto-populated from the RaceResult
  metadata when the corresponding field is unset: the date comes from
  the landing page's schema.org JSON-LD `startDate` (time of day
  defaults to 09:00), and the mode is inferred from the event name
  (`frontyard` / `backyard` substring).
- **Dashboard (race timer)** — live race clock and per-loop stats. The main
  clock shows the elapsed (or remaining) time as `dd.hh.mm.ss` and
  ticks every wall-clock second (self-correcting `setTimeout` aligned
  to the second boundary, so `:00` rollovers stay in lockstep with the
  system clock). Stat cards are colour-coded: *Loops completed*
  (green), *Current loop* (yellow), *Loop time-limit* (red), *Next
  loop time-limit* (purple), *Speed min:sec per km* (black). In
  Frontyard mode the top of the view also shows three **jersey holder**
  cards — one per colour, with the matching jersey image, top 3
  Women + top 3 Men after the last completed loop (name and total
  points / overall time). The #1 row in each gender section (the
  current jersey holder) is highlighted: the rank number is replaced
  by the jersey image (`/rosa.png`, `/grønn.png`, `/gul.png`), text
  is bolder and larger, and the row sits inside a jersey-coloured
  border. Each holder's name is followed by a jersey-coloured count
  pill showing how many loops they have worn that jersey. The gender
  sub-header carries a status pill: amber **`~ LIKELY`** when the
  leader's lead exceeds half of the runner-up's max remaining
  catch-up, blue **`✓ DECIDED`** when the standings are
  mathematically locked in, or dark **`★ FINISHED`** when the
  jersey's final loop has been completed. The yellow-jersey
  card also surfaces an **🏆 Overall winner** footer with the fastest
  finisher per gender on the highest loop completed within the time
  limit (see the Jerseys section below for the exact rule). The
  winner footer only appears once the race is over. The standings
  are driven by the live race clock (`Loops completed`), so the
  cards advance the moment the timer ticks past a loop boundary —
  independent of `/api/jerseys` poll freshness. The card heading
  reads `(after X of Y loops)` where Y is the configured end-loop
  for that jersey.
  Each section also surfaces two per-loop counters:
  - *Runners completed past loop* — cumulative count of runners who
    finished loop N−1.
  - *Runners starting this loop* — subset of the above who actually
    went out for loop N. Live: requires a non-DNF/DQ status. Replay:
    requires `finalLaps ≥ N` (they later completed it). The gap is the
    dropouts at the end of N−1.

  Two modes:
  - **Backyard** — fixed 60-minute loops. A `mm:ss` counter counts down
    from `60:00`; when it resets, *Loops completed* increments.
  - **Frontyard** — first loop is 30 minutes, each subsequent loop is
    one minute shorter. Two settings shape the schedule:
    - *Hold time-limit after loop* (1–26): from this loop onwards every
      loop reuses the same length (e.g. `Loop 17 (14 min)` keeps all
      following loops at 14 min).
    - *Maximum number of loops* (must be greater than the hold loop,
      capped at 27): the race ends after this many loops.

  When the backend flags the race as finished, a **Race finished**
  playback bar appears above the clock with `⏮ ◀ Loop N / max ▶ ⏭ Live`
  controls. Stepping rewrites the displayed elapsed time to the start
  of the chosen loop (+1 s), which in turn drives loops-completed,
  distance, jersey card, the per-loop counters and the leaderboard
  snapshot. Beeps are suppressed while scrubbing. The selected loop is
  persisted in `localStorage` so other tabs follow along.

### Timer options

Configured in the **Timer set-up** dashboard, persisted per event ID:

- *Race location* — shown in the header next to the Oslo clock.
- *Race start time* — `dd.mm.yyyy HH.mm.ss` (Europe/Oslo wall-clock).
- *Mode* — Backyard or Frontyard.
- *Hold time-limit after loop* and *Maximum number of loops*
  (Frontyard only).
- *Pink jersey at loop* (default 10), *Green jersey at loop*
  (default 15), *Yellow & Winner at loop* (default 27). When the
  current frontyard loop number matches one of these, the
  corresponding image(s) from `frontend/public/` are shown in the
  *Competition this loop* card on the Timer dashboard
  (`rosa.png`, `grønn.png`, and `gul.png` + `vinner.png`).
- *Beep / bell* checkbox — when enabled, the Timer dashboard plays
  three beeps at 3 min remaining, two at 2 min, one at 1 min, and a
  bell at every loop rollover (and on race finish in Frontyard).

### Jerseys

- **Jerseys** — points-and-time standings for the three frontyard
  jerseys: **Pink** (sprint points awarded at intermediate splits),
  **Green** (sprint points awarded at the end of each loop), and
  **Yellow** (fastest accumulated race time). The dashboard shows a
  6-table overview (Women on top, Men below, top 10 each) with a
  matching set of columns whose widths line up across the gender
  pair. The current holder of each jersey gets a jersey-coloured
  pill next to their name showing the **number of loops** they have
  held that jersey (instead of a plain letter). The table heading
  also carries a status badge:

  - **`~ LIKELY`** (amber) — the leader's lead exceeds **half** of
    the runner-up's maximum theoretical catch-up over the remaining
    loops. Same per-jersey math as DECIDED, but with a 0.5×
    threshold instead of 1×.
  - **`✓ DECIDED`** (blue) — the leader is mathematically
    uncatchable. For Pink the lead must exceed `remaining × 3` pts;
    for Green `remaining × 10` pts; for Yellow the runner-up must
    be more than `remaining × 10 min` behind on cumulative time
    (10 min is the assumed minimum lap time the runner-up could
    use to claw back).
  - **`★ FINISHED`** (dark) — the jersey's last contested loop has
    been completed.

  Blue (rather than green) is used for DECIDED so the badge never
  visually clashes with the green-jersey card.

  A **View** dropdown switches between *Overview* and the three detail
  views. Each detail view shows one jersey for both genders with a
  per-loop breakdown: points per loop for Pink/Green, and lap time +
  cumulative race time per loop for Yellow. In the per-loop cells
  the jersey-coloured count pill is rendered to the left of the
  time/points value to make the holder loops obvious at a glance.
  Each table heading is annotated with `(ends at loop N)` so
  spectators can see when the competition closes.

  In live mode the standings advance loop-by-loop driven by the
  race clock: the snapshot loop is the timer's `Loops completed`,
  so the tables flip to the new loop the moment the timer crosses a
  boundary. `/api/jerseys` is polled 5 seconds after every loop
  boundary (with a 10 s fallback cadence) so the underlying data
  catches up just after the snapshot advances.

  The Yellow detail view also displays an **🏆 Overall winner**
  banner above the per-gender tables, shown only once the race is
  over (the snapshot has reached the Yellow end-loop, or the backend
  has flagged the race as finished). The winner rule:

  * Search loops `L` from `min(snapshotLoop, jerseyYellow)` downward.
  * A runner of the requested sex counts on `L` only if their lap
    time on `L` is `> 0` and `≤` that loop's time limit (loop 1 =
    30 min, then −1 min per loop until *Hold time-limit after loop*,
    after which the length stays constant).
  * Among counting runners, the smallest `lapSec` on `L` wins.
  * If nobody counts on the top loop (e.g. solo timeout), fall back
    to `L−1`, and so on.

  Tie-breaking on equal-points jerseys uses the most recent
  contributing loop (Pink/Green); Yellow ties break on the fastest
  last completed loop. The shared **Race finished** replay control bar
  (`localStorage`) lets you scrub through historical loops in lockstep
  with the Race dashboard and Leaderboard.

The front page lets you type a RaceResult event ID, pick a dashboard
from a dropdown, and open it. A **← Back** button returns to the front
page. The chosen event ID and dashboard are remembered in
`localStorage`.

### URL routing

Each dashboard has a URL slug that matches its menu label, so you can
deep-link or bookmark a specific view:

| Menu         | URL slug       |
| ------------ | -------------- |
| Settings     | `/settings`    |
| Overview     | `/overview`    |
| Leaderboard  | `/leaderboard` |
| Dashboard    | `/dashboard`   |
| Jerseys      | `/jerseys`     |

Visiting `/<slug>` opens that dashboard using the last event ID stored
in `localStorage` (falling back to the first predefined event).
Appending an event ID — `/<slug>/<eventId>`, e.g. `/jerseys/374847` —
overrides the stored value for that visit. Submitting the front-page
form and pressing **← Back** update the URL via `history.pushState`,
and the browser back/forward buttons re-sync the dashboard via a
`popstate` listener. The FastAPI backend serves `index.html` for any
unknown path so client-side routing works in the Docker / production
build too.

## Run

### Backend

```powershell
uv run python .\server.py
```

The first run creates a `.venv` at the project root and installs the
Python dependencies declared in [pyproject.toml](pyproject.toml). The
server listens on http://127.0.0.1:8000 with auto-reload enabled.

Optional: copy [backend/.env.example](backend/.env.example) to
`backend/.env` to set a default event ID (used when no `event_id` query
parameter is supplied).

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The Vite dev server proxies `/api/*` to the
FastAPI backend on port 8000.

## Endpoints

- `GET /api/participants/count?event_id=<id>` →
  `{ "count": <int>, "eventName": <str>, "eventLocation": <str>, "eventId": <str> }`
- `GET /api/results?event_id=<id>&listname=<suffix>` →
  `{ "eventName": <str>, "eventLocation": <str>, "eventId": <str>,
     "raceFinished": <bool>, "eventStartTime": <str>,
     "eventMode": <"backyard" | "frontyard" | "">, "rows": [...] }`.
  Each row has: `place`, `bib`, `name`, `club`, `country`, `sex`,
  `totalRank`, `lapsCompleted`, `lastLap`, `fastestLap`, `slowestLap`,
  `averageLap`, `status`, `gap`, `lapsBehind`, `total`.
- `GET /api/jerseys?event_id=<id>` →
  `{ "eventName": <str>, "eventId": <str>, "raceFinished": <bool>,
     "green": [...], "pink": [...], "yellow": [...] }`.
  Green/Pink entries: `{ bib, name, club, country, sex, points,
  perLoop: [{ loop, points }] }`. Yellow entries:
  `{ bib, name, club, country, sex, total, totalSec, lapsCompleted?,
  perLoop?: [{ loop, time, lapSec, totalSec }] }`. Per-lap times are
  pulled from the public RRPublish *Details* list when available.
- `GET /api/health` → `{ "status": "ok" }`.

  `raceFinished` is `true` when at least `len(rows) − 1` rows have a
  status matching `dnf|dns|dq|withdrawn` (i.e. a single survivor).
  `eventStartTime` is an ISO timestamp (`YYYY-MM-DDTHH:MM:SS`) scraped
  from the public landing page's schema.org `startDate`; if only a date
  is available the time defaults to `09:00:00`. Either field is `""`
  when not detectable.

  Without `listname` the backend fetches the `Resultatliste` list
  (which carries `NumberOfLaps`, `MinLap`, `AvgLap`, `MaxLap`, total
  time) and merges in `lastLap` from the `LIVE` list (the only list
  that publishes it), keyed by BIB. Passing `listname` (suffix match,
  e.g. `LIVE`) skips the merge and uses only that list.
- `GET /api/results/fields?event_id=<id>&listname=<suffix>` →
  debug helper: `DataFields` array + first raw row from the selected
  list, useful for mapping new RaceResult templates.
- `GET /api/results/lists?event_id=<id>&page=results` →
  debug helper: enumerates every list published on the page along with
  each list's `DataFields` and a sample row.
- `GET /api/health` → `{ "status": "ok" }`
- `GET /` redirects to `/api/participants/count`

`event_id` falls back to `RACERESULT_EVENT_ID` from `backend/.env` when
omitted.

## Deploy with Docker

The repository ships a multi-stage [Dockerfile](Dockerfile) that builds
the Vite/React bundle in a Node stage and serves it from the FastAPI
backend in a Python stage — one image, one process, one port.

### Build locally

```powershell
docker build -t rotvoll:latest .
```

The first build pulls `node:20-alpine` and `python:3.12-slim` from
Docker Hub; subsequent builds are cached. Expect a small image
(~150 MB) because the Node toolchain is discarded after `vite build`.

### Run locally

```powershell
docker run --rm -p 8000:8000 rotvoll:latest
```

Open http://localhost:8000 — the SPA loads and `/api/*` requests hit
the FastAPI inside the same container. No CORS or reverse-proxy
configuration is needed in this single-origin layout.

Stop with `Ctrl+C`.

All RaceResult settings are optional: leave them unset and type the
event ID in the UI, or bake one in via either an env file or inline
flags:

```powershell
# Option A — inline env vars
docker run --rm -p 8000:8000 `
  -e RACERESULT_EVENT_ID=12345 `
  rotvoll:latest

# Option B — env file (copy backend/.env.example to backend/.env first)
docker run --rm -p 8000:8000 --env-file backend/.env rotvoll:latest
```

### Push to a registry (e.g. GitHub Container Registry)

```powershell
# Log in once with a GitHub Personal Access Token that has write:packages
docker login ghcr.io -u <github-username>

docker tag rotvoll:latest ghcr.io/<github-username>/rotvoll:latest
docker push ghcr.io/<github-username>/rotvoll:latest
```

### Deploy to a container PaaS

Any container-aware platform can pull the image and run it. The
container honours `$PORT` so platforms that assign a port at runtime
(Cloud Run, Render, Fly.io, Azure Container Apps) work without
modification. Provide configuration via environment variables:

| Variable              | Purpose                                                                  |
| --------------------- | ------------------------------------------------------------------------ |
| `RACERESULT_EVENT_ID` | Default event ID when `?event_id=` is not supplied.                      |
| `RACERESULT_API_KEY`  | Optional bearer token for RaceResult.                                    |
| `RACERESULT_BASE`     | Override the RaceResult host (default `https://my.raceresult.com`).      |
| `CORS_ORIGINS`        | Comma-separated extra allowed origins. Not needed for single-origin deploys. |
| `DEV`                 | When `1`/`true`, also allow `http://localhost:5173` (Vite dev server) as a CORS origin. Leave unset in production. |
| `PORT`                | Override the listening port (default `8000`).                            |

The container runs as a non-root user (`app`) and has no persistent
state — every restart starts clean and re-fetches data from RaceResult
on demand.

## Testing

The jersey ranking pipeline ships with a deterministic end-to-end unit
test plus a CLI script that replays the same simulated race
loop-by-loop. Both consume the shared
[frontend/src/dashboards/simulateRace.ts](frontend/src/dashboards/simulateRace.ts)
module, so any seed reproduces identical fixtures in both places.

### Prerequisites

- Node 18+.
- Install frontend deps once: `cd frontend; npm install`.

### Unit tests

```powershell
cd frontend
npm test           # one-shot run
npm run test:watch # re-run on change
```

What the suite asserts:

- **Jersey rankings** ([frontend/src/dashboards/__tests__/jerseyRanking.test.ts](frontend/src/dashboards/__tests__/jerseyRanking.test.ts)):
  A fictive 20-runner / 10-loop / 30-minute-mass-start race is
  generated from a fixed seed (`12345`) via the shared simulator.
  For every loop `k = 1..10` and every (jersey, sex) combination
  (pink/green/yellow × K/M), the test compares the **rank-1 holder
  plus the full top-3 ordering** computed two ways:
  - **(A)** Direct sort of raw simulated times into 3/2/1 (pink, by
    800 m split) and 10/8/6/4/2/1 (green, by lap finish) ladders, with
    yellow ranked by accumulated lap time.
  - **(B)** The same data fed through `rankByPoints` / `rankYellow`
    from `frontend/src/dashboards/jerseyRanking.ts` (the module the
    real dashboards use).

  Two extra cases exercise the tie-break paths explicitly: pink/green
  ties resolve to the runner with most points on the snapshot loop;
  yellow ties resolve to the fastest lap on the snapshot loop.
- **DECIDED / FINISHED status**
  ([frontend/src/dashboards/__tests__/jerseyStatus.test.ts](frontend/src/dashboards/__tests__/jerseyStatus.test.ts)):
  exercises `computeJerseyStatus` for FINISHED triggers, null/no-data
  edge cases, the boundary math for pink (×3), green (×10), and
  yellow (×10 min) leads, and confirms the `raceFinished` flag does
  **not** short-circuit DECIDED during playback.
- **Overall winner**
  ([frontend/src/dashboards/__tests__/jerseyWinner.test.ts](frontend/src/dashboards/__tests__/jerseyWinner.test.ts)):
  covers `frontyardLoopLengthSec` (loop-1 = 30 min, shrink per loop,
  hold past `lockAfter`), the `isRaceOver` gate (raceFinished OR
  snapshot ≥ jerseyYellow), and `computeWinner` itself — fastest-lap
  selection on the highest loop completed within the time limit,
  solo-timeout fall-back, sex filtering (own field + lookup
  fallback), `jerseyYellow` capping, and lap-limit enforcement with
  custom `lockAfter`.

A green run prints `111 passed`.

### Loop-by-loop simulation script

Replay the same race interactively and watch jersey ownership evolve:

```powershell
cd frontend
npm run simulate:jerseys
```

Defaults: 20 runners, 10 loops, seed 42, prints all three jerseys for
both sexes (top 5 each). All flags are optional; pass them after `--`
so npm forwards them to the script:

| Flag           | Values                            | Default | Purpose                                                        |
| -------------- | --------------------------------- | ------- | -------------------------------------------------------------- |
| `--runners=N`  | integer ≥ 2                       | `20`    | Total runners (split half K, half M).                          |
| `--loops=N`    | integer ≥ 1                       | `10`    | Number of mass-start loops to simulate.                        |
| `--seed=N`     | any integer                       | `42`    | RNG seed — same seed produces the same race.                   |
| `--jersey=...` | `pink` \| `green` \| `yellow` \| `all` | `all`   | Which jersey(s) to display.                                    |
| `--sex=...`    | `K` \| `M` \| `both`              | `both`  | Which gender(s) to display.                                    |
| `--top=N`      | integer ≥ 1                       | `5`     | Rows shown per (jersey, sex) table.                            |

Example — focus on the pink jersey for Women over a short race:

```powershell
npm run simulate:jerseys -- --runners=20 --loops=4 --seed=42 --jersey=pink --sex=K --top=3
```

Each loop section ends with a `→ JERSEY SEX holder change: bib X → bib Y`
line whenever the rank-1 runner changes from the previous loop, so the
shifting jersey ownership is easy to spot. The script does not touch
the backend — it computes everything locally from the seeded
simulation.

