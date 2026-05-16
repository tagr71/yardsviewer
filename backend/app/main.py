"""FastAPI backend that proxies RaceResult data and exposes simple
endpoints for the local dashboards (participant count, leaderboard, ...)."""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

# Load backend/.env regardless of the current working directory.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Configure via .env (see .env.example)
RACERESULT_EVENT_ID = os.getenv("RACERESULT_EVENT_ID", "")
RACERESULT_API_KEY = os.getenv("RACERESULT_API_KEY", "")
RACERESULT_BASE = os.getenv("RACERESULT_BASE", "https://my.raceresult.com")

app = FastAPI(title="Race dashboards API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _validate_event_id(event_id: str) -> None:
    if not event_id:
        raise HTTPException(
            status_code=400,
            detail="event_id is required (query parameter or RACERESULT_EVENT_ID in .env)",
        )
    if not event_id.isdigit():
        raise HTTPException(status_code=400, detail="event_id must be numeric")


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {RACERESULT_API_KEY}"} if RACERESULT_API_KEY else {}


async def _fetch_list(
    event_id: str,
    page: str,
    *,
    listname_match: str | None = None,
    contest: str = "0",
) -> tuple[dict[str, Any], str]:
    """Fetch a published RaceResult list. Returns (list_payload, event_name).

    The list is selected from the page's TabConfig.Lists. If `listname_match`
    is given, the first list whose name ends with `|{listname_match}` (or
    matches exactly) is used; otherwise the first available list is used.
    """
    _validate_event_id(event_id)
    config_url = f"{RACERESULT_BASE}/{event_id}/{page}/config?lang=en"

    async with httpx.AsyncClient(timeout=10.0, headers=_auth_headers()) as client:
        try:
            resp = await client.get(config_url)
            resp.raise_for_status()
            config = resp.json()
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502, detail=f"RaceResult config request failed: {exc}"
            ) from exc

        key = config.get("key")
        server = (
            config.get("server")
            or RACERESULT_BASE.removeprefix("https://").removeprefix("http://")
        )
        event_name = config.get("eventname") or ""
        lists = (config.get("TabConfig") or {}).get("Lists") or []
        if not lists:
            raise HTTPException(
                status_code=502, detail=f"No lists available on page '{page}'"
            )

        selected = None
        if listname_match:
            for lst in lists:
                name = lst.get("Name", "")
                if name == listname_match or name.endswith(f"|{listname_match}"):
                    selected = lst
                    break
        if selected is None:
            selected = lists[0]

        listname = selected["Name"]
        list_contest = str(selected.get("Contest") or contest)

        if not key:
            raise HTTPException(
                status_code=502, detail="RaceResult config did not include a key"
            )

        list_url = f"https://{server}/{event_id}/{page}/list"
        params = {
            "key": key,
            "listname": listname,
            "page": page,
            "contest": list_contest,
            "r": "all",
        }

        try:
            resp = await client.get(list_url, params=params)
            resp.raise_for_status()
            payload = resp.json()
        except httpx.HTTPError as exc:
            raise HTTPException(
                status_code=502, detail=f"RaceResult list request failed: {exc}"
            ) from exc

    return payload, event_name


def _count_rows(payload: Any) -> int:
    if isinstance(payload, dict):
        data = payload.get("data")
        if isinstance(data, list):
            return len(data)
        if isinstance(data, dict):
            total = 0
            for value in data.values():
                if isinstance(value, list):
                    total += len(value)
            if total:
                return total
    if isinstance(payload, list):
        return len(payload)
    raise ValueError("Could not determine row count from response")


_NAME_BIB_RE = re.compile(r"\s*\[\d+\]\s*$")
_FLAG_RE = re.compile(r"/flags/([A-Za-z]{2,3})\.svg", re.IGNORECASE)


def _extract_country(raw_flag: str) -> str:
    """Pull the country code out of a RaceResult flag image tag like
    `[img:/graphics/flags/NO.svg]`. Returns the upper-cased code or "" if
    nothing recognizable is found."""
    if not raw_flag:
        return ""
    m = _FLAG_RE.search(raw_flag)
    return m.group(1).upper() if m else ""


def _flatten_results(payload: dict[str, Any]) -> list[dict[str, object]]:
    """Extract a flat list of result rows from a RaceResult list payload.

    Each row has keys: place (int|None), bib, name, club, country, sex.
    """
    fields = payload.get("DataFields") or []

    def find_index(*candidates: str) -> int:
        for c in candidates:
            for i, f in enumerate(fields):
                if f == c:
                    return i
        return -1

    bib_i = find_index("BIB")
    name_i = find_index("DisplayNameBib", "DisplayName", "FullName", "Name")
    sex_i = find_index("SexMF", "SEX", "Sex")
    place_i = find_index("TotalRank", "Rank", "Place")
    club_i = find_index("ClubOrCity", "Club", "City")
    country_i = find_index("NATION.FLAG", "Nation", "Country")

    rows: list[dict[str, object]] = []

    def cell(raw: list[Any], idx: int) -> str:
        return str(raw[idx]) if 0 <= idx < len(raw) else ""

    def add(raw: Any) -> None:
        if not isinstance(raw, list):
            return
        name = _NAME_BIB_RE.sub("", cell(raw, name_i)).strip()
        place_raw = cell(raw, place_i)
        try:
            place: int | None = int(place_raw)
            if place < 0:
                place = None
        except ValueError:
            place = None
        rows.append(
            {
                "place": place,
                "bib": cell(raw, bib_i),
                "name": name,
                "club": cell(raw, club_i),
                "country": _extract_country(cell(raw, country_i)),
                "sex": cell(raw, sex_i),
            }
        )

    data = payload.get("data")
    if isinstance(data, list):
        for r in data:
            add(r)
    elif isinstance(data, dict):
        for value in data.values():
            if isinstance(value, list):
                for r in value:
                    add(r)
    return rows


@app.get("/api/participants/count")
async def participants_count(event_id: str | None = None) -> dict[str, object]:
    resolved = event_id or RACERESULT_EVENT_ID
    payload, event_name = await _fetch_list(resolved, "participants")
    try:
        count = _count_rows(payload)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"count": count, "eventName": event_name, "eventId": resolved}


@app.get("/api/results")
async def results(
    event_id: str | None = None,
    listname: str | None = None,
) -> dict[str, object]:
    """Return the leaderboard for the event.

    `listname` selects which result list to fetch (suffix match, e.g. "LIVE",
    "Final"). Defaults to "LIVE", falling back to the first available list.
    """
    resolved = event_id or RACERESULT_EVENT_ID
    payload, event_name = await _fetch_list(
        resolved, "results", listname_match=listname or "LIVE"
    )
    return {
        "eventName": event_name,
        "eventId": resolved,
        "rows": _flatten_results(payload),
    }


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    return RedirectResponse(url="/api/participants/count")

