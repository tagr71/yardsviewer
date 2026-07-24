# yardsviewer

A web app that reads live data from [RaceResult](https://my.raceresult.com)
events and shows it in a set of race dashboards — Overview, Leaderboard,
Timer and Jersey standings — for both **Backyard Ultra** and **Frontyard Ultra**
events. The backend polls RaceResult every 10 s (or at loop boundaries
when a start time is configured) and auto-detects event mode, start time
and location from the event's public page.

- **Backend:** Python + FastAPI + Uvicorn ([backend/app/main.py](backend/app/main.py))
- **Frontend:** Vite + React + TypeScript ([frontend/](frontend))
- Python project managed by [uv](https://docs.astral.sh/uv/) via [pyproject.toml](pyproject.toml)

## Event selection

On load the **Event** dropdown shows a "Select an event…" placeholder —
no event is pre-selected and nothing is restored from `localStorage`, so
the user must always make a conscious choice. Predefined events:

| Label | ID |
|---|---|
| Rotvollfjæra Frontyard Ultra 2026 | 374847 |
| Hell Backyard Ultra 2026 | 337633 |
| Rondane Backyard Ultra 2026 | 352401 |

Selecting a predefined event immediately opens its **Settings** dashboard.
Choosing **Other…** reveals a 6-character alphanumeric ID input; the
**Open** button is enabled only when exactly 6 characters have been
entered.

## Dashboards

The dashboard dropdown lists, in order: **Settings**, **Overview**,
**Leaderboard**, **Dashboard** (race timer), **Jerseys**.

- **Overview** — live participant counters with auto-refresh.
  Colour-coded cells for starting runners (yellow), starting females
  (red) and males (blue); a second row mirrors the three cells for
  runners still in competition per gender; the bottom row shows the
  current loop (teal), accumulated distance summed across completed
  loops (green) and registered participants (neutral). Before the
  race starts (no completed loops yet) the still-in counters equal the
  starting counts — RaceResult pre-populates all registered runners as
  DNF before the race begins, so the dashboard uses DNS-only exclusion
  instead of the usual DNF/DNS/DQ filter. When the race is finished a
  `⏮ ◀ Loop N / max ▶ ⏭ Live` playback bar appears and the still-in
  counters / accumulated distance follow the selected loop.
- **Leaderboard** — sortable, 10 s-polled table:
  Total Rank, Bib, Full Name, Club, Country (flag), Gender, Laps,
  Gap, Last (lap), Fastest, Slowest, Average, Total Time,
  Total Distance, Status. Distance uses the loop length for the
  current Timer mode (6.706 km backyard, 3 km frontyard). In
  frontyard mode the current Pink/Green/Yellow jersey holder for
  each gender is tagged next to their name with a jersey-coloured
  pill showing the number of loops they have held that jersey. A
  trailing `~` means **LIKELY**, `✓` **DECIDED**, `★` **FINISHED**
  (see [Jerseys](#jerseys) for the exact rules). A short legend
  above the gender tables explains the symbols. When the race is
  finished a playback bar appears with `⏮ ◀ Loop N / max ▶ ⏭ Live`
  controls: rows where the runner's final lap count is below N − 1
  are hidden, remaining rows have laps/distance clamped to N, and
  the selected loop is shared with the Race dashboard via
  `localStorage`. In frontyard mode the **overall winner** — the
  single runner (sex-independent) with the fastest lap on the
  highest loop any runner finished within the loop's time limit, up
  to the Yellow end-loop — gets a `🏆` prefix next to their name
  once the race is decided.
- **Settings (Timer set-up)** — race start time, mode and per-event
  options (see [Timer options](#timer-options)). All settings are
  stored in `localStorage`, keyed by event ID, and picked up live by
  the Race dashboard via the `storage` event plus a 2 s poll
  fallback. Settings are always editable regardless of race status.
  On every fresh page load (new browser session) the start time, mode
  and location are auto-populated from RaceResult metadata when not
  already set: the date comes from the landing page (JSON-LD
  `startDate` or plain text `DD/MM/YYYY`); the mode is inferred from
  the event name (`frontyard` / `backyard` substring); the location
  is taken from the event config. When no explicit start time is
  published, the default is **09:00** for backyard events and
  **10:00** for frontyard. The "user-edited" guard uses
  `sessionStorage`, so the server value wins on every page reload but
  manual edits are preserved within the session. When the results
  list is not yet published (e.g. a future event) the endpoint falls
  back to the participants list to recover the event date and
  location.
- **Dashboard (race timer)** — live race clock (`dd.hh.mm.ss`,
  ticked every wall-clock second via a self-correcting `setTimeout`)
  plus per-loop stat cards: *Loops completed* (green), *Current
  loop* (yellow), *Loop time-limit* (red), *Next loop time-limit*
  (purple), *Speed min:sec per km* (black). In frontyard mode the
  top of the view also shows three **jersey holder** cards — one per
  colour, with the matching jersey image, top 3 Women + top 3 Men
  after the last completed loop. The current holder row in each
  gender section is highlighted: the rank number is replaced by the
  jersey image (`/rosa.png`, `/grønn.png`, `/gul.png`), the text is
  bolder, and the row sits inside a jersey-coloured border. Each
  holder's name is followed by a count pill showing how many loops
  they have worn that jersey. The gender sub-header carries the
  same `~ LIKELY` / `✓ DECIDED` / `★ FINISHED` status pill used in
  the Leaderboard. The yellow card surfaces an **🏆 Overall winner**
  footer with the single fastest finisher (sex-independent) on the
  highest loop completed within the time limit, shown once the race
  is decided. The
  standings are driven by the live race clock so the cards advance
  the moment the timer ticks past a loop boundary — independent of
  `/api/jerseys` poll freshness. Each section also surfaces two
  per-loop counters: *Runners completed past loop* (cumulative count
  who finished loop N − 1) and *Runners starting this loop* (subset
  that actually went out for loop N; live = non-DNS/DQ for loop 1 so
  pre-race DNF placeholders don't distort the count, non-DNF/DQ for
  loop 2+; replay = `finalLaps ≥ N`).

  Two modes:
  - **Backyard** — fixed 60-minute loops; a `mm:ss` counter counts
    down from `60:00` and *Loops completed* increments on each
    rollover.
  - **Frontyard** — loop 1 is 30 minutes; each subsequent loop is
    one minute shorter, controlled by:
    - *Hold time-limit after loop* (1–26): from this loop onwards
      every loop reuses the same length.
    - *Maximum number of loops* (> hold loop, ≤ 27): the race ends
      after this many loops.

  When the backend flags the race as finished, a **Race finished**
  playback bar appears above the clock with `⏮ ◀ Loop N / max ▶ ⏭
  Live` controls. Stepping rewrites the displayed elapsed time to
  the start of the chosen loop + 1 s, which in turn drives
  loops-completed, distance, the jersey cards, per-loop counters and
  the leaderboard snapshot. Beeps are suppressed while scrubbing.
  The selected loop is persisted in `localStorage` so other tabs
  follow along.

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
  corresponding image(s) from `frontend/public/` (`rosa.png`,
  `grønn.png`, `gul.png` + `vinner.png`) are shown in the
  *Competition this loop* card on the Timer dashboard.
- *Beep / bell* — when enabled, the Timer dashboard plays three
  beeps at 3 min remaining, two at 2 min, one at 1 min, and a bell
  at every loop rollover (and on race finish in Frontyard).

### Jerseys

Points-and-time standings for the three frontyard jerseys: **Pink**
(sprint points at intermediate splits), **Green** (sprint points at
loop ends), and **Yellow** (fastest accumulated race time). The
overview shows a 6-table grid (Women on top, Men below, top 10
each). The current holder of each jersey gets a jersey-coloured pill
next to their name showing the number of loops they have held that
jersey. Each table heading carries a status badge:

- **`~ LIKELY`** (amber) — leader's lead exceeds **half** of the
  runner-up's maximum theoretical catch-up over the remaining loops.
- **`✓ DECIDED`** (blue) — leader is mathematically uncatchable.
  Pink: lead > `remaining × 3` pts. Green: lead > `remaining × 10`
  pts. Yellow: runner-up more than `remaining × 10 min` behind on
  cumulative time (10 min = assumed minimum lap time the chaser
  could use to claw back).
- **`★ FINISHED`** (dark) — the jersey's last contested loop has
  been completed.

Blue (not green) is used for DECIDED so the badge never clashes
with the green-jersey card.

A **View** dropdown switches between *Overview* and three detail
views. Each detail view shows one jersey for both genders with a
per-loop breakdown: points per loop for Pink/Green, lap time +
cumulative race time per loop for Yellow. The jersey-coloured count
pill is rendered to the left of the per-loop value to make holder
loops obvious. Each table heading is annotated with `(ends at loop
N)`.

The active detail view is also mirrored to the URL as a `?view=`
query parameter so individual jerseys are deep-linkable and
shareable:

| View         | URL                            |
| ------------ | ------------------------------ |
| Overview     | `/jerseys/<eventId>`           |
| Pink details | `/jerseys/<eventId>?view=pink` |
| Green details| `/jerseys/<eventId>?view=green`|
| Yellow details| `/jerseys/<eventId>?view=yellow`|

On first load the URL wins over the per-event `localStorage`
preference, so a shared link always opens the intended jersey.
Switching views updates the URL via `history.replaceState`
(`overview` is the default and is kept implicit — no `?view=` in the
canonical URL), and the browser back/forward buttons re-sync the
view through a `popstate` listener.

In live mode the snapshot loop is the timer's `Loops completed`, so
the tables flip the moment the timer crosses a boundary;
`/api/jerseys` is polled 5 s after every loop boundary (with a 10 s
fallback cadence). Tie-breaking on equal points uses the most
recent contributing loop (Pink/Green); Yellow ties break on the
fastest last completed loop. The shared **Race finished** replay
bar (`localStorage`) lets you scrub historical loops in lockstep
with the Race dashboard and Leaderboard.

**Yellow jersey cap** — the comparison strategy depends on whether
per-loop split data is available for that sex in the yellow list:

* **Per-loop data available** (populated by the backend from the
  RRPublish Details list): `cap = min(sexMaxLaps, snapshotLoop)`.
  Runners whose `lapsCompleted` exceeds `cap` and have no per-loop
  breakdown are excluded because their `totalSec` spans more laps
  and cannot be compared fairly. Historical replay is accurate — the
  yellow holder advances loop by loop.
* **No per-loop data** (Details list unpublished or unavailable for
  the event): `cap = sexMaxLaps`. Only runners who reached the
  sex's maximum lap count participate, compared on their final
  `totalSec`. The same final standings are shown at every replay
  loop — an honest approximation given the data limitation.

The backend sorts yellow entries by laps DESC then total time ASC,
mirroring RaceResult's own "Gul trøye" ranking. Per-loop data is
loaded by `_fetch_details_list`, which discovers the Details sub-page
slug (e.g. `details1`) from the results page config, the real list
name from the RRPublish config, and the correct contest ID from the
RRPublish `contests` map — then fetches the full dataset with `r=all`
from the event's server.

The Jerseys overview and the Yellow detail view both display an
**🏆 Overall winner** banner above the per-gender tables, and the
winner's row in every jersey table is prefixed with a `🏆` next to
the runner's name. The trophy is only revealed once the race is
actually decided — see *Winner gating* below. The winner rule
(sex-independent):

1. Search loops `L` from `min(snapshotLoop, jerseyYellow)` downward.
2. A runner counts on `L` only if their lap time on `L` is `> 0`
   and `≤` that loop's time limit (loop 1 = 30 min, then −1 min per
   loop until *Hold time-limit after loop*, then constant).
3. The smallest `lapSec` on `L` wins — across all runners regardless
   of sex.
4. If nobody counts on the top loop (e.g. solo timeout), fall back
   to `L − 1`, and so on.

**Winner gating** — the trophy is awarded only when the race is
finished:

* the backend has flagged the race as finished, *or*
* the winner's decisive loop equals the configured Yellow & Winner
  end-loop, *or*
* the winner's decisive loop is strictly below `snapshotLoop`,
  meaning a later loop attempt produced no qualifying finishers
  (all DNF'd inside the time limit) and the race naturally ended
  one loop earlier.

Mid-race "current leader" states show no trophy.

The front page lets you pick a predefined event or type a custom
6-character alphanumeric RaceResult event ID, pick a dashboard from a
dropdown, and open it. The chosen event ID and dashboard are saved in
`localStorage` so other tabs / deep links continue to work, but the
dropdown always starts empty on a fresh load.

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

Visiting `/<slug>/<eventId>` — e.g. `/jerseys/374847` — opens that
dashboard for the given event. The event ID segment accepts up to
10 alphanumeric characters. Submitting the front-page form updates
the URL via `history.pushState`, and the browser back/forward buttons
re-sync the dashboard via a `popstate` listener. The FastAPI backend
serves `index.html` for any unknown path so client-side routing works
in the Docker / production build too.

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
  `averageLap`, `status`, `gap`, `lapsBehind`, `total`,
  `perLoop?: [{ loop, time, lapSec, totalSec }]` (present when the
  RaceResult Details list is published for the event).
- `GET /api/jerseys?event_id=<id>` →
  `{ "eventName": <str>, "eventId": <str>, "raceFinished": <bool>,
     "green": [...], "pink": [...], "yellow": [...] }`.
  Green/Pink entries: `{ bib, name, club, country, sex, points,
  perLoop: [{ loop, points }] }`. Yellow entries:
  `{ bib, name, club, country, sex, total, totalSec, lapsCompleted?,
  perLoop?: [{ loop, time, lapSec, totalSec }] }`. Per-lap times are
  pulled from the public RRPublish *Details* list when available.
- `GET /api/health` → `{ "status": "ok" }`.

  `raceFinished` is `true` when at least `len(rows) − 1` rows carry a
  `dnf|dns|dq|withdrawn` status **and** the last standing runner has
  completed at least one loop (preventing false positives when an
  organiser pre-populates the list with everyone marked DNF before the
  race starts). When the results list is not yet published the endpoint
  falls back to the participants list for event metadata and returns
  `rows: []` with `raceFinished: false`.
  `eventStartTime` is an ISO timestamp (`YYYY-MM-DDTHH:MM:SS`) from
  the public landing page (JSON-LD `startDate` or plain-text
  `DD/MM/YYYY`); when no explicit time is found the default is
  `09:00:00` for backyard events and `10:00:00` for frontyard. Either
  field is `""` when not detectable.

  Without `listname` the backend fetches the `Resultatliste` list
  (which carries `NumberOfLaps`, `MinLap`, `AvgLap`, `MaxLap`, total
  time) and merges in `lastLap` from the `LIVE` list (the only list
  that publishes it), keyed by BIB. Passing `listname` (suffix match,
  e.g. `LIVE`) skips the merge and uses only that list.
- `GET /` — in the production Docker build, serves the Vite SPA
  (`index.html`). In local dev (no `frontend/dist/` present) redirects
  to `/api/participants/count`.

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

### Deploy to Google Cloud Run

The repository includes a [`deploy.ps1`](deploy.ps1) script and a
[`cloudbuild.yaml`](cloudbuild.yaml) that build the image in the cloud
(no local Docker required) and deploy it to Cloud Run.

**One-time setup** (PowerShell, `gcloud` CLI required):

```powershell
gcloud auth login
gcloud config set project <PROJECT_ID>
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

**Deploy / redeploy:**

1. Open [`deploy.ps1`](deploy.ps1) and fill in your `RACERESULT_EVENT_ID` (and
   optionally `RACERESULT_API_KEY`).
2. Run:

```powershell
.\deploy.ps1
```

Cloud Build compiles the Dockerfile in the cloud (~2–3 min), pushes the image
to Artifact Registry, and deploys a new Cloud Run revision. The service URL is
printed at the end.

> `deploy.ps1` is listed in `.gitignore` so your credentials are never
> committed to version control.

### Deploy to any other container PaaS

Any container-aware platform can pull the image and run it. The
container honours `$PORT` so platforms that assign a port at runtime
(Render, Fly.io, Azure Container Apps) work without
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
  hold past `lockAfter`), the broad `isRaceOver` gate (raceFinished
  OR snapshot ≥ jerseyYellow), `computeOverallWinner` itself
  (sex-independent fastest-lap selection on the highest loop
  completed within the time limit, solo-timeout fall-back,
  `jerseyYellow` capping, lap-limit enforcement with custom
  `lockAfter`), and the strict `isWinnerFinal` gate that withholds
  the trophy until the race is actually decided (end-loop reached or
  a later loop attempt produced no qualifying finishers).

A green run prints `122 passed`.

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

