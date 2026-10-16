# yardsviewer

A web app that reads live data from [RaceResult](https://my.raceresult.com)
events and shows it in a set of race dashboards — Overview, Leaderboard,
Timer and Jersey standings — for both **Backyard Ultra** and **Frontyard Ultra**
events. Live dashboards refresh results every 10 s, with loop-boundary
refreshes when a start time is configured. The backend fetches RaceResult
data on demand and auto-detects event mode, start time and location from
the event's public page.

- **Backend:** Python + FastAPI + Uvicorn ([backend/app/main.py](backend/app/main.py))
- **Frontend:** Vite + React + TypeScript ([frontend/](frontend))
- Python project managed by [uv](https://docs.astral.sh/uv/) via [pyproject.toml](pyproject.toml)

## Logos

The navigation bar shows two logos:

- **Upper-left** — club/organiser logo. Replace `frontend/public/logo.png` to change it.
- **Upper-right** — event-specific logo. Place the image in
  `frontend/public/logos/<filename>` and set `logoFile` on the matching entry
  in `PREDEFINED_EVENTS` in [App.tsx](frontend/src/App.tsx). Empty by default
  for events without a configured logo.
  The World Team Championship event (`423509`) uses the uploaded Backyard
  Ultra Norway logo with flags. Its optional `logoBackground` is white so
  the transparent black lettering stays readable in night mode.

## Event selection

At the root URL, the **Event** dropdown shows a "Select an event…"
placeholder. No event is restored from `localStorage`; a dashboard deep
link restores its event from the URL instead. Predefined events:

| Label | ID |
|---|---|
| Rotvollfjæra Frontyard Ultra 2026 | 374847 |
| Hell Backyard Ultra 2026 | 337633 |
| Rondane Backyard Ultra 2026 | 352401 |
| Muruvik Backyard Ultra 2026 | 361312 |
| Backyard Ultra Norway - World Team Championship 2026 | 423509 |

Selecting a predefined event immediately opens the selected dashboard;
**Settings** is the initial dashboard choice.
Choosing **Other…** reveals a 6-character alphanumeric ID input; the
**Open** button is enabled only when exactly 6 characters have been
entered.

### Pre-Race Data

Production dashboards read RaceResult's published data; the Norway event has
no application-side simulator. Organizers may publish trial results before
race day. Before `eventStartTime`, `/api/results` keeps the entrants and DNS
statuses but clears lap counts, splits, times and ranks, and reports
`raceFinished: false`. LIVE and lap-detail requests are skipped until the
scheduled start, interpreted in `Europe/Oslo` with daylight-saving support.
Normal result collection resumes automatically at that instant.

The schedule comes from RaceResult metadata. When only a date is published,
the existing defaults are 09:00 for backyard and 10:00 for frontyard events;
confirm these against the organizer's schedule. This guard does not delete
trial data at RaceResult: the organizer must reset its published results
before the live event.

## Display options

The shared header's **Automatic day/night** switch enables a Norwegian-time
schedule: night mode from **17:00 to 08:00**, and day mode from **08:00 to
17:00**. It uses `Europe/Oslo`, including daylight-saving changes, and
updates while the page is open. Automatic mode is initially On; an explicitly
saved Off choice is preserved. In manual mode, the **Night mode** switch
chooses between white backgrounds
with dark text and black backgrounds with light text; day is the initial
manual default. Returning to manual mode restores the saved manual choice.
Both settings persist across navigation, event changes and reloads, and
synchronize between tabs.

Four independent display switches remember their settings across events.
Participant information, the Leaderboard plot and cumulative loops default to **On**;
Dashboard top-15 results default to **Off**. Explicit saved choices are
preserved:

- **Overview: Show participant info** controls the starting and remaining
  detailed counts, female/male breakdowns and registered count. Turning it
  off shows the total **Still in**, current loop, **Acc. loops**, accumulated
  distance and replay controls. Accumulated loops and distance follow the
  selected replay loop and include completed loops from retired runners.
- **Dashboard: Show top-15** (default Off) adds a compact results table beneath
  the timer: bib, name, last/fastest/average lap and accumulated time. Enabling it
  compacts timer and jersey panels; disabling it restores their spacious
  layout.
- **Leaderboard: Show top-15 plot** displays each selected runner's lap time
  against loop number at the bottom of the page, below the sortable results
  table. Fifteen distinct colors, supplemented by matching line patterns in
  the plot and upper-right legend, stay with runners as ranks change. Colored
  name tags connect to each runner's last available plotted point; full names
  are also available in the legend and on hover. The results table scrolls
  independently so the bottom plot stays visible on desktop and laptop.
- **Leaderboard: Show cumulative loops** is available only for races with
  at most 15 original starters (DNS entries are excluded). It adds a
  **Cumulative Loops** column immediately after **Country**, showing the
  race-wide sum of completed laps through the viewed loop on each row.
  All starters remain visible, including retired runners. **Total Rank**
  uses completed laps only, with shared dense ranks and numeric bib order
  within each tie; times never break ties. For 15 first-loop finishers the
  total is 15 and everyone ranks 1. If one runner stops before completing
  loop 2, the total is 29, the 14 finishers rank 1 and the retired runner
  ranks 2. Turning the mode off restores normal sorting and replay filtering.

The Leaderboard plot switch is disabled whenever more than 15 runners remain
in the viewed live or replay snapshot. Replay uses the same count as the replay
controls: runners present at the start of the viewed loop, not just its finishers.
Its saved preference is retained while disabled.
Opening the plot refreshes lap history for all runners and plots
each remaining runner's individual lap times from loop 1 through the viewed
completed loop, without changing the replay position. Loading and request
errors are shown before the plot is drawn.

Both top-15 views select up to 15 remaining runners from overall standings,
independently of the full Leaderboard's sorting or gender grouping. Live
withdrawn/DNF/DNS/DQ runners are excluded; pre-race DNF placeholders are
retained. Replay uses only runners and times from the selected completed
loop, and final views retain the last-loop finishers. Live snapshots advance
after completed loops, with continued polling for late corrections.

The plot prefers RaceResult's published per-loop data, using an advertised
**Details-API** results list when available. Otherwise it reads up to 15
participant-view histories per request, prioritizing active runners followed
by runners with the most completed loops, with at most four requests in flight.
This also loads full top-15 histories for finished races with larger starting
fields. A missing **Last Lap** is filled from the published split matching that
runner's completed-loop count. Without Details-API, this recovery is limited to
the selected 15 runners. The legacy Details page remains a fallback. These are
published individual lap times, not estimates from aggregate totals. While the
Leaderboard is open, each results poll also records valid last-lap times
against the runner's published completed-loop count. These observations are
saved in this browser's `localStorage`, separately for each event and configured
race start time, and remain available after navigation or reload. Recording
continues when the plot is hidden or replay is selected; replay still displays
only the selected completed loops. Published Details splits override recorded
values when available.

When published lap history is unavailable, only observed laps are recorded:
opening the Leaderboard late, closing it, or missing a poll can leave gaps.
The recorded history is not shared between devices
or the local and Cloud Run sites, and changing the configured start time
selects a separate history. If browser storage is unavailable, observations
last only while the Leaderboard stays mounted. Missing splits remain gaps,
and isolated observations appear as points. Events with neither published
splits nor valid observed last-lap times show **Lap split data unavailable**;
aggregate fastest/average times are never used to invent lap history.

The compact Dashboard fits 15 rows without scrolling at **1366 x 768** and
**1920 x 1080**, including frontyard jersey standings and replay controls.
The complete plot and legend also fit those viewports; the full Leaderboard
table remains scrollable. Smaller screens use a readable, scrollable layout.

## Dashboards

The dashboard dropdown lists, in order: **Settings**, **Overview**,
**Leaderboard**, **Dashboard** (race timer), **Jerseys**.

- **Overview** — live participant counters with auto-refresh.
  Colour-coded cells for starting runners (yellow), starting females
  (red) and males (blue); a second row mirrors the three cells for
  runners still in competition per gender — each cell's label includes
  the percentage still in (e.g. `Still in (75.6%)`); the bottom row
  shows the current loop (teal), accumulated distance summed across
  completed loops (green) and registered participants (neutral).
  With **Show participant info** off, a responsive metrics grid shows
  **Still in**, **Current loop**, **Acc. loops** and **Acc. distance (km)**.
  The accumulated totals include all starters' completed loops, including
  retired runners, and exclude DNS entries. Before
  the race starts (no completed loops yet) the still-in counters equal
  the starting counts — RaceResult pre-populates all registered runners
  as DNF before the race begins, so the dashboard uses DNS-only
  exclusion instead of the usual DNF/DNS/DQ filter. Once completed loops
  are available, a `⏮ ◀ Loop N / max ▶ ⏭ Live` playback bar appears.
  The still-in counters, accumulated loops in the compact view and
  accumulated distance follow the selected loop.
- **Leaderboard** — sortable, 10 s-polled table:
  Total Rank, Bib, Full Name, Club, Country (flag), Laps,
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
  already set. This auto-population runs on **all dashboards** (not
  just Settings), so the race clock works correctly on a fresh device
  without requiring the user to visit Settings first. The date comes
  from the landing page (JSON-LD `startDate` or plain text
  `DD/MM/YYYY`); the mode is inferred from the event name (`frontyard`
  / `backyard` substring); the location is taken from the event config.
  When no explicit start time is published, the default is **09:00**
  for backyard events and **10:00** for frontyard. The "user-edited" guard uses
  `sessionStorage`, so the server value wins on every page reload but
  manual edits are preserved within the session. When the results
  list is not yet published (e.g. a future event) the endpoint falls
  back to the participants list to recover the event date and
  location.
- **Dashboard (race timer)** — live race clock (`dd.hh.mm.ss`,
  ticked every wall-clock second) alongside the current Oslo
  wall-clock time (`hh:mm:ss`). Per-loop stat cards depend on mode:

  The completed-loop and completed-distance cards also show totals across
  all runners in parentheses, including retired runners but excluding DNS
  entries. Live totals use published completed laps; replay totals are
  capped at the Dashboard's completed-loop count. Both totals are zero
  before the start, and distance uses the selected mode's loop length.

  **Backyard mode** — *Loops completed* (green), *Current loop*
  (yellow), *Distance completed* (green, accumulated km across all
  completed loops), *Distance this loop* (yellow, target distance
  when the current loop ends), *Remaining min:sec of loop* (colour
  turns yellow at 6 min, red at 3 min). Two runner counters:
  *Runners completed past loop (X%)* — historical count of runners
  who finished loop N−1, percentage of all starting runners;
  *Runners started, not finished (X%)* — runners who started loop N
  but have not yet completed it, percentage of those who started.

  **Frontyard mode** — same clock plus jersey holder cards (one per
  colour, top 3 Women + top 3 Men). *Speed min:sec per km* card shows
  required pace for the current loop length. Same two runner counters
  as backyard.

  In frontyard mode the top of the view also shows three **jersey
  holder** cards — one per colour, with the matching jersey image, top
  3 Women + top 3 Men after the last completed loop. The current holder
  row in each gender section is highlighted: the rank number is
  replaced by the jersey image (`/rosa.png`, `/grønn.png`, `/gul.png`),
  the text is bolder, and the row sits inside a jersey-coloured border.
  Each holder's name is followed by a count pill showing how many loops
  they have worn that jersey. The gender sub-header carries the
  same `~ LIKELY` / `✓ DECIDED` / `★ FINISHED` status pill used in
  the Leaderboard. The yellow card surfaces an **🏆 Overall winner**
  footer with the single fastest finisher (sex-independent) on the
  highest loop completed within the time limit, shown once the race
  is decided. The standings are driven by the live race clock so the
  cards advance the moment the timer ticks past a loop boundary —
  independent of `/api/jerseys` poll freshness.

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
re-sync the active dashboard via a `popstate` listener. Event/dashboard
choices are also saved in `localStorage`, but the URL, not these saved
choices, determines the initial view. The FastAPI backend
serves `index.html` for any unknown path so client-side routing works
in the Docker / production build too.

## Run

Requirements: **Python 3.12+**, [uv](https://docs.astral.sh/uv/), and
**Node.js 22.12+ (22.x), 24.x, or 26+** with npm. Docker and CI use Node 24.
Run the backend and frontend in separate
terminals from the repository root.

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

The first build pulls `node:24-alpine` and `python:3.12-slim` from
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
to Artifact Registry; the deployment script then deploys a new Cloud Run
revision and prints the service URL. The Cloud Build configuration itself
only builds and pushes the image.

> `deploy.ps1` is listed in `.gitignore` so your credentials are never
> committed to version control.

For an existing service, the following direct commands deploy the exact
built image without changing its runtime environment variables or access
policy. Run from the repository root, with an authenticated `gcloud` CLI:

The Norway deployment uses project `backyardultranorway2026`, service
`yardsviewer`, in `europe-north1`. The older Rondane project hosts a separate
deployment. Check the project configured in your local deployment script;
the commands below explicitly target Norway.

```powershell
$projectId = "backyardultranorway2026"
$region = "europe-north1"
$buildId = gcloud builds submit . --config cloudbuild.yaml --project $projectId --suppress-logs --format="value(id)"
if ($LASTEXITCODE -ne 0) { throw "Cloud Build failed" }
$digest = gcloud builds describe $buildId --project $projectId --format="value(results.images[0].digest)"
if ($LASTEXITCODE -ne 0 -or -not $digest) { throw "Built image digest unavailable" }
$image = "$region-docker.pkg.dev/$projectId/cloud-run-source-deploy/yardsviewer"
gcloud run deploy yardsviewer --image "$image@$digest" --project $projectId --region $region
if ($LASTEXITCODE -ne 0) { throw "Cloud Run deployment failed" }
gcloud run services describe yardsviewer --project $projectId --region $region --format="yaml(status.latestReadyRevisionName,status.traffic,status.url)"
```

Build success alone does not confirm deployment. Verify that the new revision
is ready and receives traffic, then check `/api/health` and the deployed UI.
The source upload must exclude private `.env` files and `deploy.ps1`; the
repository's ignore rules cover these files.

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

The frontend has five Vitest suites covering jersey rankings, status and
winner rules, top-15 snapshots and plots, and display preferences. The
jersey ranking pipeline also has a CLI script that replays a simulated
race loop-by-loop. The simulation tests and CLI consume the shared
[frontend/src/dashboards/simulateRace.ts](frontend/src/dashboards/simulateRace.ts)
module, so any seed reproduces identical fixtures in both places.
These fixtures use fictitious runners and are development-only: neither
the app nor the backend imports them or substitutes them for event data.

### Prerequisites

- Node 22.12+ (22.x), 24.x, or 26+.
- Install frontend dependencies once: `npm --prefix frontend ci` from the
  repository root.

### Unit tests

```powershell
cd frontend
npm test           # one-shot run
npm run test:watch # re-run on change
```

Backend regression tests use Python's standard `unittest` framework:

```powershell
uv run python -m unittest discover -s backend/tests -v
```

They cover published Details-API lists, participant-view lap history,
partial request failures, capped history requests for large fields, missing
split positions, malformed upstream JSON, numeric cell validation, empty
participant lists, static-file path containment, and pre-race data suppression
with exact summer/winter Oslo start boundaries.

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
- **Top-15 snapshots and plot helpers**
  ([frontend/src/dashboards/__tests__/raceResults.test.ts](frontend/src/dashboards/__tests__/raceResults.test.ts)):
  covers remaining-runner eligibility, overall selection, replay caps,
  late data, missing lap counts and splits, stable colors, dash patterns,
  last-point labels and contrasting tag text. Live-recording tests cover
  observed-only history, missed-loop gaps, corrections, published-split
  precedence, and storage isolation by event and start time. Malformed or
  unavailable browser storage must not break recording. Historical
  snapshots must not borrow future ranks or times or sum incomplete history.
  Cumulative-loop coverage checks original starter counts, shared dense ranks,
  numeric bib ordering, retained retirees, and race-wide replay totals.
- **Display preferences and automatic theme**
  ([frontend/src/dashboards/__tests__/displayPreferences.test.ts](frontend/src/dashboards/__tests__/displayPreferences.test.ts)):
  covers validated storage values, unavailable storage, automatic-On
  defaults, saved Off choices, manual theme restoration, and the exact
  08:00/17:00 boundaries in Norwegian summer and winter time, including
  daylight-saving transition dates.

A successful run has no failed tests across all five suites. The test
count can grow as coverage is added.

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

## Development

### Source ownership

| Area | Owning source |
| --- | --- |
| Backend endpoints and RaceResult parsing | [backend/app/main.py](backend/app/main.py) |
| Event menu, routing and shared header | [frontend/src/App.tsx](frontend/src/App.tsx) |
| Theme schedule, storage synchronization and display switches | [frontend/src/theme.tsx](frontend/src/theme.tsx) |
| Theme tokens and responsive layouts | [frontend/src/styles.css](frontend/src/styles.css) |
| Remaining-runner selection, cumulative standings, snapshots, split storage and plot helpers | [frontend/src/dashboards/raceResults.ts](frontend/src/dashboards/raceResults.ts) |
| Results polling, live split collection and results table | [frontend/src/dashboards/Leaderboard.tsx](frontend/src/dashboards/Leaderboard.tsx) |
| Lazy-loaded chart, runner tags and matching legend | [frontend/src/dashboards/Top15Plot.tsx](frontend/src/dashboards/Top15Plot.tsx) |
| Shared clocks, race settings and replay controls | [frontend/src/dashboards/timerCore.tsx](frontend/src/dashboards/timerCore.tsx) |
| Jersey standings and winner rules | [frontend/src/dashboards/jerseyRanking.ts](frontend/src/dashboards/jerseyRanking.ts) |

### Display preferences

These keys are global, not keyed by event ID. Values are JSON-encoded
in `localStorage` and validated before use:

| Key | Default | Meaning |
| --- | --- | --- |
| `raceresult.themeAutomatic` | `true` | Use the Europe/Oslo day/night schedule |
| `raceresult.theme` | `"day"` | Saved manual theme: `"day"` or `"night"` |
| `raceresult.overview.showParticipantInfo` | `true` | Show detailed participant counts |
| `raceresult.dashboard.showTop15` | `false` | Show compact top-15 results |
| `raceresult.leaderboard.showTop15Plot` | `true` | Show the bottom lap-time plot |
| `raceresult.leaderboard.showCumulativeLoops` | `true` | Use cumulative totals and shared lap ranks when at most 15 runners started |

Updates notify same-tab consumers through `raceresult.preferenceChanged`
and other tabs through the browser's `storage` event. Invalid or missing
values use the documented defaults. Storage failures must not prevent
controls from working in the current tab. Automatic theme refreshes every
second and on focus/visibility changes; it never overwrites the manual
theme preference. Race configuration and replay position remain per-event.

### Live split storage

Leaderboard polling merges valid published Details splits with observed
last-lap values before rendering. A last-lap observation requires a positive
integer completed-loop count and a valid lap time. It is assigned only to
that loop; missed loops are never interpolated. Published Details values
take precedence within each poll, and repeated or corrected observations
replace the same bib/loop entry rather than duplicating it.

The cache key is `raceresult.leaderboard.liveSplits.<eventId>.<startMs>`,
where `startMs` is the configured start instant in epoch milliseconds, or
`unknown` when no start time is configured. Its JSON value is an array of
`[bib, splits]` entries; it stores no runner names or credentials. Unchanged
history does not trigger another storage write. Corrupt cache entries are
ignored, and storage errors leave the current in-memory history usable.

This cache belongs to the browser and site origin, not to the backend or
Cloud Run container. It does not alter `/api/results` or jersey API data.
Recording requires an open Leaderboard and valid published lap values;
leaving the page pauses collection. A completed race with no published
history cannot be reconstructed from fastest, average or aggregate times.
Clearing site data removes recorded history. To remove one event's cache,
delete only keys with its `raceresult.leaderboard.liveSplits.<eventId>.` prefix.

### Snapshot rules

Keep selection in the shared results module rather than deriving it from
the full Leaderboard's current sort or gender group. Cap live snapshots
to published, completed loops; replay must only use data through the
selected loop. Keep polling for late corrections. Missing splits are
unavailable, not zero-duration laps or inferred historical results.

The chart assigns stable colors by bib. Lines, name tags and legend
swatches share one appearance definition, and name tags connect to the
last available split at or before the snapshot. Preserve the reserved
label lane and local horizontal scrolling on small screens.
Unchanged polling responses do not redraw the plot; corrected splits,
runner/name/order changes, replay position and theme changes still update
it. Keep the SVG out of the chart sizing box's layout flow to prevent
rounded dimensions and scrollbars from triggering resize feedback.

### Validation

Run from the repository root before merging changes:

```powershell
npm --prefix frontend run test
npm --prefix frontend run build
uv run python -m unittest discover -s backend/tests -v
npm --prefix frontend audit
uv run --with pip-audit pip-audit --progress-spinner off
git diff --check
```

There is no frontend lint script; the production build includes the
TypeScript check. Builds regenerate the tracked TypeScript metadata in
`frontend/tsconfig.tsbuildinfo`; avoid unrelated generated metadata churn.
For changes to Python code, the configured development checks are:

```powershell
uv run ruff check .
uv run mypy backend server.py
```

GitHub Actions runs the frontend tests and production build, Python lint,
type checks, and backend tests before building the Docker image.

For display changes, verify both **1366 x 768** and **1920 x 1080** at
normal zoom, plus a narrow mobile viewport. Check all 15 Dashboard rows,
the bottom plot, tag/legend agreement, page overflow, both themes and
replay. Confirm automatic-On behavior with no saved preference and that
a saved Off choice still restores manual mode.

