# rotvollfjaerafrontyardultra

A small local web app that reads live data from a RaceResult event and
shows it in pickable dashboards.

- **Backend:** Python + FastAPI + Uvicorn ([backend/app/main.py](backend/app/main.py))
- **Frontend:** Vite + React + TypeScript ([frontend/](frontend))
- Python project managed by [uv](https://docs.astral.sh/uv/) via [pyproject.toml](pyproject.toml)

## Dashboards

The dashboard dropdown lists, in order: **Timer set-up**,
**Number of participants**, **Leaderboard**, **Race dashboard**.

- **Number of participants** — live participant count with auto-refresh.
- **Leaderboard** — sortable table polled every 30 s. Columns:
  Total Rank, Bib, Full Name, Club, Country (flag), Gender, Laps,
  Gap, Last (lap), Fastest, Slowest, Average, Total Time,
  Total Distance, Status. Distance uses the loop length for the
  current Timer mode (6.706 km backyard, 3 km frontyard). When the
  backend flags the race as finished, a playback bar appears with
  `⏮ ◀ Loop N / max ▶ ⏭ Live` controls so you can step through
  loop-by-loop snapshots: rows where the runner's final lap count is
  below N − 1 are hidden, and remaining rows have their laps/distance
  clamped to N. The selected loop is shared (via `localStorage`) with
  the Race dashboard, so both views stay in sync.
- **Timer set-up** — configure the race start time, mode and per-event
  options (see below). All settings are stored in `localStorage`, keyed
  by event ID, and picked up live by the Race dashboard (same browser,
  via the `storage` event and a 2 s poll fallback). For a *finished*
  race the start date and mode are auto-populated from the RaceResult
  metadata when the corresponding field is unset: the date comes from
  the landing page's schema.org JSON-LD `startDate` (time of day
  defaults to 09:00), and the mode is inferred from the event name
  (`frontyard` / `backyard` substring).
- **Race dashboard** — live race clock and per-loop stats. The main
  clock shows the elapsed (or remaining) time as `dd.hh.mm.ss` and
  ticks every wall-clock second (self-correcting `setTimeout` aligned
  to the second boundary, so `:00` rollovers stay in lockstep with the
  system clock). Each section also surfaces two per-loop counters:
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

The front page lets you type a RaceResult event ID, pick a dashboard
from a dropdown, and open it. A **← Back** button returns to the front
page. The chosen event ID and dashboard are remembered in
`localStorage`.

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
