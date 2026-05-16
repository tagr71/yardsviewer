# rotvollfjaerafrontyardultra

A small local web app that reads live data from a RaceResult event and
shows it in pickable dashboards.

- **Backend:** Python + FastAPI + Uvicorn ([backend/app/main.py](backend/app/main.py))
- **Frontend:** Vite + React + TypeScript ([frontend/](frontend))
- Python project managed by [uv](https://docs.astral.sh/uv/) via [pyproject.toml](pyproject.toml)

## Dashboards

- **Number of participants** — live participant count with auto-refresh.
- **Leaderboard** — sortable table (Place, Number, Full Name, Club,
  Country, Sex) polled every 30 s.

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
  `{ "count": <int>, "eventName": <str>, "eventId": <str> }`
- `GET /api/results?event_id=<id>&listname=<suffix>` →
  `{ "eventName": <str>, "eventId": <str>, "rows": [{ "place": <int|null>, "bib": <str>, "name": <str>, "club": <str>, "country": <str>, "sex": <str> }] }`
  (`listname` defaults to `LIVE` and falls back to the first available
  list)
- `GET /api/health` → `{ "status": "ok" }`
- `GET /` redirects to `/api/participants/count`

`event_id` falls back to `RACERESULT_EVENT_ID` from `backend/.env` when
omitted.
