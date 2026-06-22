"""FastAPI backend that proxies RaceResult data and exposes simple
endpoints for the local dashboards (participant count, leaderboard, ...)."""
from __future__ import annotations

import logging
import os
import re
import ssl
from pathlib import Path
from typing import Any

import httpx
import truststore
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

# Use the operating system's certificate store so corporate / Windows CAs work
# out of the box. certifi (httpx's default bundle) doesn't see locally
# installed/proxy roots and fails with CERTIFICATE_VERIFY_FAILED.
_SSL_CONTEXT = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)

# Load backend/.env regardless of the current working directory.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Configure via .env (see .env.example)
RACERESULT_EVENT_ID = os.getenv("RACERESULT_EVENT_ID", "")
RACERESULT_API_KEY = os.getenv("RACERESULT_API_KEY", "")
RACERESULT_BASE = os.getenv("RACERESULT_BASE", "https://my.raceresult.com")

# Local wall-clock fallback used when RaceResult publishes only a date
# (no time of day) on its landing page. Applies to both backyard and
# frontyard events.
DEFAULT_EVENT_START_TIME = "10:00:00"

app = FastAPI(title="Race dashboards API")

# CORS configuration.
#
# * In development (``DEV=1``) we allow the Vite dev server on
#   ``http://localhost:5173`` so ``npm run dev`` can talk to a separately
#   running backend.
# * In production we allow only origins explicitly listed in
#   ``CORS_ORIGINS`` (comma-separated). For the single-origin Docker
#   deploy where the SPA is bundled into this image (see the static
#   mount at the bottom of the file), the same-origin policy applies
#   and ``CORS_ORIGINS`` can be left empty.
_dev_mode = os.getenv("DEV", "").strip().lower() in {"1", "true", "yes", "on"}
_extra_origins = [
    o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()
]
_cors_origins = [
    *(["http://localhost:5173"] if _dev_mode else []),
    *_extra_origins,
]
if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
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
    if len(event_id) > 12:
        raise HTTPException(status_code=400, detail="event_id is too long")


# Listnames published by RaceResult templates are short identifiers like
# ``Resultatliste``, ``LIVE``, ``02 - Result Lists|6 - Details``. Restrict
# the user-supplied value to a conservative character set so it can
# safely flow into outbound query strings and log lines.
_LISTNAME_RE = re.compile(r"^[A-Za-z0-9 ._|\-]{1,80}$")


def _validate_listname(listname: str | None) -> None:
    if listname is None:
        return
    if not _LISTNAME_RE.match(listname):
        raise HTTPException(
            status_code=400,
            detail="listname must be 1-80 chars of letters, digits, space, '.', '_', '|' or '-'",
        )


def _auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {RACERESULT_API_KEY}"} if RACERESULT_API_KEY else {}


async def _fetch_list(
    event_id: str,
    page: str,
    *,
    listname_match: str | None = None,
    listname_contains: str | None = None,
    contest: str = "0",
) -> tuple[dict[str, Any], str, str, str, str]:
    """Fetch a published RaceResult list. Returns
    (list_payload, event_name, event_location, event_date, event_time).

    The list is selected from the page's TabConfig.Lists. If `listname_match`
    is given, the first list whose name ends with `|{listname_match}` (or
    matches exactly) is used. If `listname_contains` is given instead, the
    first list whose name contains that substring (case-insensitive) is
    used. Otherwise the first available list is used.
    """
    _validate_event_id(event_id)
    config_url = f"{RACERESULT_BASE}/{event_id}/{page}/config?lang=en"

    async with httpx.AsyncClient(
        timeout=10.0, headers=_auth_headers(), verify=_SSL_CONTEXT
    ) as client:
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
        # RaceResult publishes the date/time under various keys depending on the
        # event template; the date is usually "yyyy-mm-dd" or "dd.mm.yyyy" and
        # the time is usually "HH:MM" or "HH:MM:SS". Both may be missing.
        event_date = ""
        for date_key in ("eventdate", "EventDate", "date", "Date"):
            value = config.get(date_key)
            if isinstance(value, str) and value.strip():
                event_date = value.strip()
                break
        event_time = ""
        for time_key in (
            "eventstarttime",
            "EventStartTime",
            "starttime",
            "StartTime",
            "eventtime",
            "EventTime",
            "time",
            "Time",
        ):
            value = config.get(time_key)
            if isinstance(value, str) and value.strip():
                event_time = value.strip()
                break
        # The /{eventId}/{page}/config endpoint usually doesn't include the
        # event date — that is published on the public landing page as a
        # schema.org JSON-LD block. Fetch it once to recover at least the
        # date (and, when present, the time).
        if not event_date:
            try:
                landing = await client.get(
                    f"https://{server}/{event_id}/", follow_redirects=True
                )
                if landing.status_code == 200:
                    html = landing.text
                    m_jsonld = re.search(
                        r'"startDate"\s*:\s*"([^"]+)"', html, re.IGNORECASE
                    )
                    if m_jsonld:
                        raw = m_jsonld.group(1).strip()
                        # raw may be "YYYY-MM-DD" or full ISO
                        m_full = re.match(
                            r"^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}:\d{2}(?::\d{2})?))?",
                            raw,
                        )
                        if m_full:
                            event_date = m_full.group(1)
                            if not event_time and m_full.group(2):
                                event_time = m_full.group(2)
            except httpx.HTTPError:
                pass
        # RaceResult publishes the location under various keys depending on the
        # event template; check the common ones.
        event_location = ""
        for loc_key in (
            "eventlocation",
            "EventLocation",
            "eventcity",
            "EventCity",
            "location",
            "Location",
            "city",
            "City",
        ):
            value = config.get(loc_key)
            if isinstance(value, str) and value.strip():
                event_location = value.strip()
                break
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
        if selected is None and listname_contains:
            needle = listname_contains.lower()
            for lst in lists:
                name = lst.get("Name", "")
                if needle in name.lower():
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

    return payload, event_name, event_location, event_date, event_time


async def _fetch_details_list(
    event_id: str, page: str, contest: str = "0"
) -> dict[str, Any] | None:
    """Fetch the per-lap "Details" list for `event_id` from the public
    RRPublish endpoint. Returns the raw payload or None if not available.

    RaceResult exposes per-lap times via a hidden Details list that the
    authenticated `my.raceresult.com/{event}/results/...` API doesn't
    serve — there the visible lists only reference it by a placeholder
    name (``details0``). The same list is, however, served by the public
    ``my2.raceresult.com/{event}/RRPublish/data/list`` endpoint under the
    real listname found via that endpoint's config (e.g.
    ``"02 - Result Lists|6 - Details"``).
    """
    _validate_event_id(event_id)
    base = "https://my2.raceresult.com"
    config_url = f"{base}/{event_id}/RRPublish/data/config"
    async with httpx.AsyncClient(timeout=10.0, verify=_SSL_CONTEXT) as client:
        try:
            resp = await client.get(config_url)
            resp.raise_for_status()
            config = resp.json()
        except httpx.HTTPError:
            return None
        key = config.get("key")
        lists = config.get("lists") or []
        details_name = ""
        for lst in lists:
            ref = lst.get("Details") if isinstance(lst, dict) else None
            if isinstance(ref, str) and ref.strip() and ref.strip() != "details0":
                details_name = ref.strip()
                break
        if not key or not details_name:
            return None
        try:
            resp = await client.get(
                f"{base}/{event_id}/RRPublish/data/list",
                params={
                    "key": key,
                    "listname": details_name,
                    "page": page,
                    "contest": contest,
                    "r": "all",
                },
            )
            resp.raise_for_status()
            return resp.json()  # type: ignore[no-any-return]
        except httpx.HTTPError:
            return None


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
                elif isinstance(value, dict):
                    for inner in value.values():
                        if isinstance(inner, list):
                            total += len(inner)
            if total:
                return total
    if isinstance(payload, list):
        return len(payload)
    raise ValueError("Could not determine row count from response")


_NAME_BIB_RE = re.compile(r"\s*\[\d+\]\s*$")
_FLAG_RE = re.compile(
    r"(?:/flags/|StateFlag_)([A-Za-z]{2,3})\.(?:svg|png|jpg)",
    re.IGNORECASE,
)
_RANK_RE = re.compile(r"^\s*(-?\d+)\s*\.?\s*(.*?)\s*$")
_LAPS_BEHIND_RE = re.compile(r"^\s*(-?\d+)\s*Runde", re.IGNORECASE)
_SEX_MAP = {
    "mann": "M", "male": "M", "m": "M", "herre": "M",
    "kvinne": "K", "female": "K", "f": "K", "dame": "K", "w": "K",
}


def _parse_hms(s: str) -> int | None:
    """Parse a RaceResult time cell ("H:mm:ss", "mm:ss", or "ss") to seconds.
    Returns None when the cell is empty or unparseable."""
    if not s:
        return None
    s = s.strip()
    if not s:
        return None
    m = re.match(r"^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,]\d+)?$", s)
    if not m:
        return None
    h = int(m.group(1)) if m.group(1) else 0
    return h * 3600 + int(m.group(2)) * 60 + int(m.group(3))


def _format_hms(seconds: int) -> str:
    """Format a non-negative integer second count as "H:mm:ss" / "mm:ss"."""
    seconds = max(0, int(seconds))
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


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
    name_i = find_index(
        "DisplayNameBib",
        "DisplayNameBibAnonym",
        "DisplayNameOrTeam",
        "DisplayName",
        "FullName",
        "Name",
    )
    # Some lists publish a custom name formula like
    # `[DisplayName] & " [" & [BIB] & "]"` instead of a bare column. Detect
    # that by looking for a substring referencing [DisplayName] or [FullName].
    if name_i == -1:
        for i, f in enumerate(fields):
            if isinstance(f, str) and ("[DisplayName]" in f or "[FullName]" in f):
                name_i = i
                break
    sex_i = find_index("MaleFemale", "GenderMF", "SexMF", "SEX", "Sex")
    # RaceResult often wraps the rank in a "WithSTatus([...])" formula whose
    # value is e.g. "1." for a ranked runner or "DNF"/"DNS" for a withdrawn
    # one. Fall back to the plain rank columns if that formula isn't present.
    rank_i = find_index(
        "WithSTatus([LastSplitRankp])",
        "WithStatus([LastSplitRankp])",
        "WithSTatus([TotalRank])",
        "WithStatus([TotalRank])",
        "FinalTotalRank",
        "TotalRank",
        "Rank",
        "Place",
    )
    # Some lists use a custom rank formula like
    # `if([FinalRank]=1;[FinalRankp];"DNF")` that returns "1." or "DNF".
    # Frontyard LIVE uses `if([STARTED]=1;AutoRank;)`, which gives a bare
    # integer; detect via the `AutoRank` substring. The Backyard Ultra
    # template wraps the rank in `BackyardUltra_OrStatus([...Rank.p])`.
    if rank_i == -1:
        for i, f in enumerate(fields):
            if isinstance(f, str) and (
                "[FinalRankp]" in f
                or "[FinalRank]" in f
                or "Rankp]" in f
                or "Rank.p]" in f
                or "AutoRank" in f
                or "BackyardUltra_OrStatus" in f
            ):
                rank_i = i
                break
    place_i = find_index("FinalTotalRank", "TotalRank", "Rank", "Place")
    if place_i == -1:
        place_i = rank_i
    club_i = find_index("ClubOrCity", "DisplayClubOrNames", "Club", "City")
    country_i = find_index(
        "NATION.FLAG", "NationOrStateFlag", "NationOrState", "Nation", "Country"
    )
    total_rank_i = find_index("FinalTotalRank", "TotalRank", "Rank")
    if total_rank_i == -1:
        total_rank_i = rank_i
    laps_i = find_index(
        "NumberOfLaps",
        "BackyardUltra_YardCount",
        "LapsCompleted",
        "Laps",
        "LapCount",
        "RoundsCompleted",
        "Rounds",
    )
    last_lap_i = find_index(
        "LastLap",
        "BackyardUltra_LastYard",
        "LastLapTime",
        "LastRound",
        "LastRoundTime",
        "LastSplit",
    )
    fastest_lap_i = find_index(
        "FastestLap",
        "BackyardUltra_FastestYard",
        "BestLap",
        "FastestRound",
        "BestRound",
        "MinLap",
    )
    slowest_lap_i = find_index(
        "SlowestLap",
        "BackyardUltra_SlowestYard",
        "WorstLap",
        "SlowestRound",
        "WorstRound",
        "MaxLap",
    )
    average_lap_i = find_index(
        "AverageLap",
        "BackyardUltra_AverageYard",
        "AvgLap",
        "AverageRound",
        "AvgRound",
        "MeanLap",
    )
    status_i = find_index("Status", "StatusText", "Statustext", "State", "RaceStatus")
    # Gap-to-leader cell. RaceResult typically wraps the formula in a verbose
    # "if(...)" expression; match it by suffix or by exact substring.
    gap_i = find_index("Gap", "GapToLeader", "TimeGap")
    if gap_i == -1:
        for i, f in enumerate(fields):
            if isinstance(f, str) and 'Runde(r)' in f:
                gap_i = i
                break
    # Total race time cell (typically a "iif([TIMESET1]=0;...;[Total])" formula,
    # or a "WithStatus([TIME])" wrapper on result lists; the Backyard Ultra
    # template publishes it as `BackyardUltra_YardSum`).
    total_i = find_index("Total", "BackyardUltra_YardSum", "TotalTime")
    if total_i == -1:
        for i, f in enumerate(fields):
            if isinstance(f, str) and (
                "[Total]" in f or "[TIME]" in f or "[Time]" in f
            ):
                total_i = i
                break

    rows: list[dict[str, object]] = []

    def cell(raw: list[Any], idx: int) -> str:
        return str(raw[idx]) if 0 <= idx < len(raw) else ""

    def parse_rank(s: str) -> tuple[int | None, str]:
        """Split a "WithStatus" rank cell into (place, status). "1." → (1, "");
        "DNF" → (None, "DNF"); "12. DNF" → (12, "DNF"); "" → (None, "")."""
        s = s.strip()
        if not s:
            return None, ""
        m = _RANK_RE.match(s)
        if m and m.group(1):
            try:
                n = int(m.group(1))
            except ValueError:
                return None, s
            place = n if n >= 0 else None
            return place, m.group(2).strip()
        return None, s

    def cell_int(raw: list[Any], idx: int) -> int | None:
        place, _ = parse_rank(cell(raw, idx))
        return place

    def add(raw: Any) -> None:
        if not isinstance(raw, list):
            return
        name = _NAME_BIB_RE.sub("", cell(raw, name_i)).strip()
        place, status_from_rank = parse_rank(cell(raw, rank_i))
        explicit_status = cell(raw, status_i).strip()
        status = explicit_status or status_from_rank
        sex_raw = cell(raw, sex_i).strip()
        sex = _SEX_MAP.get(sex_raw.lower(), sex_raw)
        gap = cell(raw, gap_i).strip()
        laps_behind: int | None = 0 if gap == "-" else None
        m = _LAPS_BEHIND_RE.match(gap)
        if m:
            laps_behind = abs(int(m.group(1)))
        rows.append(
            {
                "place": place,
                "bib": cell(raw, bib_i),
                "name": name,
                "club": cell(raw, club_i),
                "country": _extract_country(cell(raw, country_i)),
                "sex": sex,
                "totalRank": cell_int(raw, total_rank_i),
                "lapsCompleted": cell_int(raw, laps_i),
                "lastLap": cell(raw, last_lap_i),
                "fastestLap": cell(raw, fastest_lap_i),
                "slowestLap": cell(raw, slowest_lap_i),
                "averageLap": cell(raw, average_lap_i),
                "status": status,
                "gap": gap,
                "lapsBehind": laps_behind,
                "total": cell(raw, total_i),
                "totalSec": _parse_hms(cell(raw, total_i)) or 0,
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
            elif isinstance(value, dict):
                for inner in value.values():
                    if isinstance(inner, list):
                        for r in inner:
                            add(r)

    # RaceResult delivers rows in the list's natural sort order. If `totalRank`
    # wasn't populated (e.g. backyard "Resultatliste" only assigns a numeric
    # rank to the winner and "DNF" to the rest), fall back to row index so
    # the leaderboard can still sort sensibly.
    for idx, row in enumerate(rows, start=1):
        if row.get("totalRank") is None:
            row["totalRank"] = idx

    # Some lists (notably the frontyard LIVE template) don't publish
    # `NumberOfLaps`. Derive laps from `Total / AverageLap` when both are
    # present — here `Total` is the sum of completed lap times.
    laps_missing = laps_i == -1 or all(r.get("lapsCompleted") is None for r in rows)
    if laps_missing:
        for row in rows:
            total_sec = _parse_hms(str(row.get("total") or ""))
            avg_sec = _parse_hms(str(row.get("averageLap") or ""))
            if total_sec is not None and avg_sec and avg_sec > 0:
                row["lapsCompleted"] = round(total_sec / avg_sec)

    # Some lists don't publish `Gap`. Derive it from the leader's total when
    # both runner and leader have a usable `total` time.
    if gap_i == -1 or all(not r.get("gap") for r in rows):
        leader_total: int | None = None
        for row in rows:
            if row.get("totalRank") == 1:
                leader_total = _parse_hms(str(row.get("total") or ""))
                break
        if leader_total is not None:
            for row in rows:
                if row.get("totalRank") == 1:
                    row["gap"] = "-"
                    continue
                t = _parse_hms(str(row.get("total") or ""))
                if t is None:
                    continue
                diff = t - leader_total
                row["gap"] = ("+" if diff >= 0 else "-") + _format_hms(abs(diff))

    return rows


@app.get("/api/participants/count")
async def participants_count(event_id: str | None = None) -> dict[str, object]:
    resolved = event_id or RACERESULT_EVENT_ID
    payload, event_name, event_location, _, _ = await _fetch_list(resolved, "participants")
    try:
        count = _count_rows(payload)
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {
        "count": count,
        "eventName": event_name,
        "eventLocation": event_location,
        "eventId": resolved,
    }


@app.get("/api/results")
async def results(
    event_id: str | None = None,
    listname: str | None = None,
) -> dict[str, object]:
    """Return the leaderboard for the event.

    `listname` selects which result list to fetch (suffix match, e.g.
    "Resultatliste", "LIVE", "Final"). Defaults to "Resultatliste", which
    publishes NumberOfLaps/MinLap/AvgLap/MaxLap. When the default is used
    we additionally fetch the "LIVE" list and merge in each runner's
    `lastLap` (LIVE is the only list that carries it), keyed by BIB.
    """
    _validate_listname(listname)
    resolved = event_id or RACERESULT_EVENT_ID
    effective = listname or "Resultatliste"
    payload, event_name, event_location, event_date, event_time = await _fetch_list(
        resolved, "results", listname_match=effective
    )
    rows = _flatten_results(payload)

    # Enrich with lastLap from the LIVE list when caller didn't override.
    if listname is None:
        try:
            live_payload, _, _, _, _ = await _fetch_list(
                resolved, "results", listname_match="LIVE"
            )
            live_rows = _flatten_results(live_payload)
            last_by_bib: dict[str, str] = {}
            for lr in live_rows:
                bib = str(lr.get("bib") or "")
                last = str(lr.get("lastLap") or "")
                if bib and last:
                    last_by_bib[bib] = last
            for row in rows:
                if not row.get("lastLap"):
                    bib = str(row.get("bib") or "")
                    if bib in last_by_bib:
                        row["lastLap"] = last_by_bib[bib]
        except HTTPException:
            # LIVE list optional; ignore if it's not published for this event.
            pass

    # Enrich each row with `perLoop` = list of `{loop, time, lapSec, totalSec}`
    # from the hidden Details list, so the frontend can show the lap time
    # for a specific historical loop when the user replays the race.
    details_payload = await _fetch_details_list(resolved, "results")
    lap_times_by_bib = _parse_lap_times(details_payload)
    if lap_times_by_bib:
        for row in rows:
            laps = lap_times_by_bib.get(str(row.get("bib") or ""))
            if laps:
                row["perLoop"] = laps

    # Heuristic "race finished" detection: a backyard/frontyard race is
    # considered finished once every row except at most one is marked DNF/
    # DNS/DQ — i.e. there is a single survivor. Requires at least two rows
    # so a one-runner placeholder list doesn't count.
    race_finished = False
    if len(rows) >= 2:
        out_pattern = re.compile(r"dnf|dns|dq|withdrawn", re.IGNORECASE)
        out_count = sum(
            1 for r in rows if out_pattern.search(str(r.get("status") or ""))
        )
        race_finished = out_count >= len(rows) - 1

    # Combine the RaceResult event date + start time into an ISO timestamp
    # (yyyy-MM-ddTHH:MM:SS) so the frontend can auto-fill the Timer setup.
    event_start_time = ""
    iso_date = ""
    m_date = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", event_date)
    if m_date:
        y, mo, d = m_date.groups()
        iso_date = f"{y}-{mo.zfill(2)}-{d.zfill(2)}"
    else:
        m_date = re.match(r"^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$", event_date)
        if m_date:
            d, mo, y = m_date.groups()
            iso_date = f"{y}-{mo.zfill(2)}-{d.zfill(2)}"
    iso_time = ""
    m_time = re.match(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$", event_time)
    if m_time:
        h, mi, s = m_time.groups()
        iso_time = f"{h.zfill(2)}:{mi}:{(s or '00').zfill(2)}"
    if iso_date and iso_time:
        event_start_time = f"{iso_date}T{iso_time}"
    elif iso_date:
        event_start_time = f"{iso_date}T{DEFAULT_EVENT_START_TIME}"

    # Detect backyard vs frontyard from the event name. Both formats use
    # the same RaceResult template (splits are named "Yard N"), so the
    # event name is the most reliable signal.
    event_mode = ""
    name_lc = event_name.lower()
    if "frontyard" in name_lc:
        event_mode = "frontyard"
    elif "backyard" in name_lc:
        event_mode = "backyard"

    return {
        "eventName": event_name,
        "eventLocation": event_location,
        "eventId": resolved,
        "raceFinished": race_finished,
        "eventStartTime": event_start_time,
        "eventMode": event_mode,
        "rows": rows,
    }


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


_GREEN_LOOP_RE = re.compile(r"^PoengRunde\s*0*(\d+)$", re.IGNORECASE)
_PINK_LOOP_RE = re.compile(r"^MellomtidPoengRunde\s*0*(\d+)$", re.IGNORECASE)

# Default Green jersey points ladder: 1st across the loop = 10 points,
# 2nd = 8, …, 6th = 1. Configurable per-request via the `ladder` query
# parameter on /api/jerseys.
_DEFAULT_GREEN_LADDER: tuple[int, ...] = (10, 8, 6, 4, 2, 1)


def _parse_ladder(spec: str | None) -> tuple[int, ...]:
    """Parse a comma-separated points ladder, e.g. ``"10,8,6,4,2,1"``.

    Returns the default ladder if `spec` is falsy or unparseable.
    """
    if not spec:
        return _DEFAULT_GREEN_LADDER
    try:
        values = tuple(int(p.strip()) for p in spec.split(",") if p.strip())
    except ValueError:
        return _DEFAULT_GREEN_LADDER
    return values or _DEFAULT_GREEN_LADDER


_JERSEY_LOG = logging.getLogger("jerseys")


def _compute_loop_points(
    lap_times_by_bib: dict[str, list[dict[str, Any]]],
    ladder: tuple[int, ...],
    *,
    group_by_bib: dict[str, str] | None = None,
    exclude_bibs: set[str] | None = None,
) -> dict[str, dict[int, int]]:
    """Rank runners by lap time per loop and award ladder points.

    For each loop the runners with the fastest ``lapSec`` get the points
    from ``ladder`` in order. Returns ``{bib: {loop_n: points_computed}}``.

    Ranking is **ordinal**: every position gets a distinct ladder slot,
    with secondary sort by bib (ascending) as a deterministic tie-break
    when ``lapSec`` values are equal. This mirrors RaceResult's own
    behaviour (it tie-breaks by sub-second chip time, which the
    published list rounds away — bib order is the closest deterministic
    proxy we have).

    Whenever two or more runners share the same ``lapSec`` inside a
    (group, loop), a warning is logged so the discrepancy is auditable.

    Parameters
    ----------
    group_by_bib:
        If given, runners are ranked separately within each group key
        (e.g. by sex). Runners whose bib is missing are placed in ``""``.
    exclude_bibs:
        Optional set of bibs to skip entirely (e.g. DNF/DNS/DQ runners).
    """
    skip = exclude_bibs or set()
    # Collect (bib, lapSec) per (group, loop).
    by_key: dict[tuple[str, int], list[tuple[str, float]]] = {}
    for bib, laps in lap_times_by_bib.items():
        if bib in skip:
            continue
        group = (group_by_bib or {}).get(bib, "") if group_by_bib else ""
        for lap in laps:
            loop = int(lap.get("loop") or 0)
            sec = lap.get("lapSec")
            if loop <= 0 or not isinstance(sec, (int, float)) or sec <= 0:
                continue
            by_key.setdefault((group, loop), []).append((bib, float(sec)))
    out: dict[str, dict[int, int]] = {}
    for (group, loop), entries in by_key.items():
        # Secondary sort by bib (numeric where possible, else string) so
        # ties resolve deterministically.
        def bib_key(b: str) -> tuple[int, str]:
            try:
                return (int(b), b)
            except ValueError:
                return (10**9, b)

        entries.sort(key=lambda e: (e[1], bib_key(e[0])))
        # Detect and log ties.
        seen: dict[float, list[str]] = {}
        for bib, sec in entries:
            seen.setdefault(sec, []).append(bib)
        for sec, tied in seen.items():
            if len(tied) > 1:
                _JERSEY_LOG.warning(
                    "tie in group=%r loop=%d at %.3fs between bibs=%s",
                    group, loop, sec, tied,
                )
        for i, (bib, _sec) in enumerate(entries):
            if i < len(ladder):
                pts = int(ladder[i])
                if pts:
                    out.setdefault(bib, {})[loop] = pts
    return out


def _parse_lap_times(
    payload: dict[str, Any] | None,
) -> dict[str, list[dict[str, Any]]]:
    """Per-lap split times keyed by bib, parsed from the Details list.

    Each entry is ``{loop, time, lapSec, totalSec}`` where ``time`` is the
    elapsed lap time (e.g. ``"47:30"``) and ``totalSec`` is the cumulative
    race time at the end of that lap, in seconds.
    """
    if payload is None:
        return {}
    fields = payload.get("DataFields") or []
    bib_i = -1
    lap_i = -1
    total_i = -1
    # The Details list uses formula expressions like `[Lap{n}]` and
    # `[Total{n}]` where `{n}` is the lap index. We identify the columns
    # by substring match against those tokens.
    for i, f in enumerate(fields):
        if not isinstance(f, str):
            continue
        s = f.strip()
        if s == "BIB":
            bib_i = i
        elif s == "[Lap{n}]":
            lap_i = i
        elif s == "[Total{n}]":
            total_i = i
    if bib_i < 0 or lap_i < 0:
        return {}
    out: dict[str, list[dict[str, Any]]] = {}
    data = payload.get("data")
    # Data is a dict of group -> list-of-rows; each row is one lap.
    groups: list[list[Any]] = []
    if isinstance(data, dict):
        for v in data.values():
            if isinstance(v, list):
                groups.append(v)
    elif isinstance(data, list):
        groups.append(data)
    for rows in groups:
        for raw in rows:
            if not isinstance(raw, list):
                continue
            bib = str(raw[bib_i]).strip() if bib_i < len(raw) else ""
            if not bib:
                continue
            lap_time = str(raw[lap_i]).strip() if lap_i < len(raw) else ""
            if not lap_time:
                continue
            lst = out.setdefault(bib, [])
            loop_n = len(lst) + 1
            total_text = (
                str(raw[total_i]).strip()
                if 0 <= total_i < len(raw)
                else ""
            )
            total_sec = _parse_hms(total_text) or 0
            lap_sec = _parse_hms(lap_time)
            lst.append(
                {
                    "loop": loop_n,
                    "time": lap_time,
                    "lapSec": lap_sec if lap_sec is not None else 0,
                    "totalSec": total_sec,
                }
            )
    return out


def _identity_indices(fields: list[Any]) -> dict[str, int]:
    """Locate identity column indices (bib/name/sex/club/country)."""

    def find_index(*candidates: str) -> int:
        for c in candidates:
            for i, f in enumerate(fields):
                if f == c:
                    return i
        return -1

    name_i = find_index(
        "DisplayNameBib",
        "DisplayNameBibAnonym",
        "DisplayNameOrTeam",
        "DisplayName",
        "FullName",
        "Name",
    )
    if name_i == -1:
        for i, f in enumerate(fields):
            if isinstance(f, str) and ("[DisplayName]" in f or "[FullName]" in f):
                name_i = i
                break
    return {
        "bib": find_index("BIB"),
        "name": name_i,
        "sex": find_index("MaleFemale", "GenderMF", "SexMF", "SEX", "Sex"),
        "club": find_index("ClubOrCity", "DisplayClubOrNames", "Club", "City"),
        "country": find_index(
            "NATION.FLAG", "NationOrStateFlag", "NationOrState", "Nation", "Country"
        ),
    }


def _iter_data_rows(payload: dict[str, Any]) -> list[list[Any]]:
    """Flatten the `data` block of a RaceResult list payload into rows.

    Handles 1-, 2-, and 3-level nesting:
    - flat list of rows
    - dict → list of rows  (one level of grouping)
    - dict → dict → list of rows  (two levels of grouping, e.g. "Final" list)
    """
    out: list[list[Any]] = []
    data = payload.get("data")
    if isinstance(data, list):
        for r in data:
            if isinstance(r, list):
                out.append(r)
    elif isinstance(data, dict):
        for value in data.values():
            if isinstance(value, list):
                for r in value:
                    if isinstance(r, list):
                        out.append(r)
            elif isinstance(value, dict):
                for inner in value.values():
                    if isinstance(inner, list):
                        for r in inner:
                            if isinstance(r, list):
                                out.append(r)
    return out


def _identity_from(raw: list[Any], idx: dict[str, int]) -> dict[str, str]:
    def cell(i: int) -> str:
        return str(raw[i]) if 0 <= i < len(raw) else ""

    sex_raw = cell(idx["sex"]).strip()
    return {
        "bib": cell(idx["bib"]),
        "name": _NAME_BIB_RE.sub("", cell(idx["name"])).strip(),
        "club": cell(idx["club"]),
        "country": _extract_country(cell(idx["country"])),
        "sex": _SEX_MAP.get(sex_raw.lower(), sex_raw),
    }


def _safe_int(text: str) -> int:
    """Parse an integer from a cell; empty/non-numeric → 0."""
    t = text.strip()
    if not t:
        return 0
    try:
        return int(float(t))
    except ValueError:
        return 0


@app.get("/api/jerseys")
async def jerseys(
    event_id: str | None = None,
    ladder: str | None = None,
) -> dict[str, object]:
    """Return the per-jersey ranking tables for a frontyard event.

    Reads the three RaceResult lists that publish jersey points directly:

    * **Green** — `Grønn trøye …` list with `PoengRundeN` + `SumGrønnPoeng`.
    * **Pink** — `Rosa trøye …` list with `MellomtidPoengRundeN` +
      `SumRosaPoeng`.
    * **Yellow** — `Gul trøye (totaltid)` list (or any list with a `Total`
      time column; falls back to the default results list).

    The response shape is:
    `{ eventName, green: [...], pink: [...], yellow: [...] }`. Each entry
    carries `{bib, name, club, country, sex, points|totalSec, perLoop?}`.

    For Green, each entry also carries a parallel `pointsComputed` total
    and `perLoop[].pointsComputed` derived locally by ranking runners by
    their per-lap time (from the Details list) and awarding the points
    ladder (default ``10,8,6,4,2,1``; override via ``?ladder=...``).
    """
    resolved = event_id or RACERESULT_EVENT_ID
    _validate_event_id(resolved)
    points_ladder = _parse_ladder(ladder)

    event_name = ""

    async def fetch_or_none(
        substring: str,
    ) -> tuple[dict[str, Any] | None, str]:
        try:
            payload, name, _, _, _ = await _fetch_list(
                resolved, "results", listname_contains=substring
            )
            return payload, name
        except HTTPException:
            return None, ""

    green_payload, green_event_name = await fetch_or_none("grønn")
    pink_payload, pink_event_name = await fetch_or_none("rosa")
    yellow_payload, yellow_event_name = await fetch_or_none("gul")
    # Per-lap times for the yellow detail view come from the Details list,
    # which expands `[Lap{n}]` into one row per (runner, lap) within a
    # group keyed by bib/name. The Details list is referenced by the
    # visible result lists via their `Details` field (it isn't itself
    # exposed in TabConfig), so we fetch it directly by name.
    details_payload = await _fetch_details_list(resolved, "results")
    # The dedicated jersey lists omit sex/club/country/flag columns (only
    # the green list still carries a sex column on some events, and even
    # that is unreliable). Fetch the default LIVE list to populate those
    # fields and to provide a yellow fallback when the dedicated yellow
    # list is empty.
    try:
        live_payload, live_name, _, _, _ = await _fetch_list(resolved, "results")
    except HTTPException:
        live_payload, live_name = None, ""
    event_name = (
        green_event_name
        or pink_event_name
        or yellow_event_name
        or live_name
        or ""
    )

    # Build BIB -> identity lookup from the LIVE list so we can backfill
    # sex/club/country on the jersey rows that lack those columns.
    live_lookup: dict[str, dict[str, str]] = {}
    if live_payload is not None:
        live_fields = live_payload.get("DataFields") or []
        live_idx = _identity_indices(live_fields)
        for raw in _iter_data_rows(live_payload):
            ident = _identity_from(raw, live_idx)
            if ident["bib"]:
                live_lookup[ident["bib"]] = ident

    def backfill(entries: list[dict[str, Any]]) -> None:
        for e in entries:
            ref = live_lookup.get(str(e.get("bib", "")))
            if not ref:
                continue
            for k in ("sex", "club", "country", "name"):
                if not e.get(k):
                    e[k] = ref.get(k, "")

    def parse_points_list(
        payload: dict[str, Any] | None,
        loop_re: re.Pattern[str],
        sum_field: str,
    ) -> list[dict[str, Any]]:
        if payload is None:
            return []
        fields = payload.get("DataFields") or []
        idx = _identity_indices(fields)
        loop_cols: list[tuple[int, int]] = []  # (loop, field_index)
        sum_i = -1
        for i, f in enumerate(fields):
            if not isinstance(f, str):
                continue
            m = loop_re.match(f.strip())
            if m:
                loop_cols.append((int(m.group(1)), i))
            elif f.strip().lower() == sum_field.lower():
                sum_i = i
        loop_cols.sort()
        out: list[dict[str, Any]] = []

        def cell(raw: list[Any], i: int) -> str:
            return str(raw[i]) if 0 <= i < len(raw) else ""

        for raw in _iter_data_rows(payload):
            identity = _identity_from(raw, idx)
            per_loop = [
                {"loop": n, "points": _safe_int(cell(raw, i))}
                for n, i in loop_cols
            ]
            total = _safe_int(cell(raw, sum_i)) if sum_i >= 0 else sum(
                p["points"] for p in per_loop
            )
            entry: dict[str, Any] = dict(identity)
            entry["points"] = total
            entry["perLoop"] = per_loop
            out.append(entry)
        out.sort(key=lambda r: (-int(r["points"]), str(r["bib"])))
        return out

    green = parse_points_list(green_payload, _GREEN_LOOP_RE, "SumGrønnPoeng")
    pink = parse_points_list(pink_payload, _PINK_LOOP_RE, "SumRosaPoeng")

    def parse_yellow(payload: dict[str, Any] | None) -> list[dict[str, Any]]:
        if payload is None:
            return []
        fields = payload.get("DataFields") or []
        idx = _identity_indices(fields)
        total_i = -1
        laps_i = -1
        for i, f in enumerate(fields):
            if isinstance(f, str):
                s = f.strip()
                if s.lower() in ("total", "totaltime"):
                    total_i = i
                elif s.lower() in ("numberoflaps", "lapcount", "laps"):
                    laps_i = i
        out: list[dict[str, Any]] = []

        def cell(raw: list[Any], i: int) -> str:
            return str(raw[i]) if 0 <= i < len(raw) else ""

        for raw in _iter_data_rows(payload):
            identity = _identity_from(raw, idx)
            total_text = cell(raw, total_i) if total_i >= 0 else ""
            total_sec = _parse_hms(total_text)
            entry: dict[str, Any] = dict(identity)
            entry["total"] = total_text
            entry["totalSec"] = total_sec if total_sec is not None else 0
            if laps_i >= 0:
                entry["lapsCompleted"] = _safe_int(cell(raw, laps_i))
            out.append(entry)
        # Sort laps DESC first (most laps = best position), then time ASC as
        # tie-breaker. This mirrors RaceResult's own "Gul trøye" ranking
        # (laps-first, total time second). Zero/missing laps sort last.
        out.sort(key=lambda r: (-(r.get("lapsCompleted") or 0), int(r["totalSec"]) or 10**12, str(r["bib"])))
        return out

    yellow = parse_yellow(yellow_payload)
    # Fallback: derive yellow from the LIVE list when the dedicated yellow
    # list is empty (some events only populate it after the race ends).
    if not yellow and live_payload is not None:
        yellow = parse_yellow(live_payload)

    lap_times_by_bib = _parse_lap_times(details_payload)
    if lap_times_by_bib:
        for e in yellow:
            laps = lap_times_by_bib.get(str(e.get("bib", "")))
            if laps:
                e["perLoop"] = laps

    # Locally compute Green points from per-lap times so the caller can
    # compare against the values published by RaceResult. Each green
    # entry gets a `pointsComputed` total and `perLoop[i].pointsComputed`
    # for every loop the runner completed.
    if lap_times_by_bib:
        sex_by_bib = {
            bib: (ident.get("sex") or "").strip().lower()
            for bib, ident in live_lookup.items()
        }
        # Skip DNF/DNS/DQ runners when ranking. We read statuses from the
        # flattened LIVE list (same source as `raceFinished`).
        excluded_bibs: set[str] = set()
        if live_payload is not None:
            out_pattern = re.compile(r"dnf|dns|dq|withdrawn", re.IGNORECASE)
            for r in _flatten_results(live_payload):
                status = str(r.get("status") or "")
                if status and out_pattern.search(status):
                    bib = str(r.get("bib") or "")
                    if bib:
                        excluded_bibs.add(bib)
        if excluded_bibs:
            _JERSEY_LOG.info(
                "excluding bibs from local Green computation: %s",
                sorted(excluded_bibs),
            )
        computed_by_bib = _compute_loop_points(
            lap_times_by_bib,
            points_ladder,
            group_by_bib=sex_by_bib,
            exclude_bibs=excluded_bibs,
        )
        for e in green:
            bib = str(e.get("bib", ""))
            per_loop_computed = computed_by_bib.get(bib, {})
            total = 0
            for lp in e.get("perLoop", []):
                loop_n = int(lp.get("loop") or 0)
                pts = int(per_loop_computed.get(loop_n, 0))
                lp["pointsComputed"] = pts
                total += pts
            # Pad with extra entries for loops the runner ran but where
            # the API had no PoengRunde column (rare, but keeps the two
            # sources comparable).
            existing_loops = {int(lp.get("loop") or 0) for lp in e.get("perLoop", [])}
            for loop_n, pts in per_loop_computed.items():
                if loop_n not in existing_loops:
                    e.setdefault("perLoop", []).append(
                        {"loop": loop_n, "points": 0, "pointsComputed": int(pts)}
                    )
                    total += int(pts)
            e["pointsComputed"] = total

    for entries in (green, pink, yellow):
        backfill(entries)

    # Compute raceFinished using the same heuristic as /api/results: all
    # but at most one runner is marked DNF/DNS/DQ in the LIVE list. Also
    # backfill lapsCompleted on yellow entries (the LIVE list itself has
    # no NumberOfLaps column, but _flatten_results derives it).
    race_finished = False
    if live_payload is not None:
        live_rows = _flatten_results(live_payload)
        laps_lookup: dict[str, int] = {}
        for r in live_rows:
            bib = str(r.get("bib") or "")
            lc = r.get("lapsCompleted")
            if bib and isinstance(lc, int):
                laps_lookup[bib] = lc
        for e in yellow:
            if "lapsCompleted" not in e:
                lc = laps_lookup.get(str(e.get("bib", "")))
                if lc is not None:
                    e["lapsCompleted"] = lc
        if len(live_rows) >= 2:
            out_pattern = re.compile(r"dnf|dns|dq|withdrawn", re.IGNORECASE)
            out_count = sum(
                1 for r in live_rows if out_pattern.search(str(r.get("status") or ""))
            )
            race_finished = out_count >= len(live_rows) - 1

    return {
        "eventName": event_name,
        "eventId": resolved,
        "raceFinished": race_finished,
        "green": green,
        "pink": pink,
        "yellow": yellow,
    }


@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    # If the production SPA bundle is mounted (see below), serve it.
    # Otherwise fall back to the legacy API redirect (used when the
    # backend runs standalone in dev with Vite on :5173).
    if _DIST.is_dir():
        from fastapi.responses import FileResponse
        return FileResponse(_DIST / "index.html")
    return RedirectResponse(url="/api/participants/count")


# ---------------------------------------------------------------------------
# Production SPA mount
# ---------------------------------------------------------------------------
# When the Vite bundle exists (i.e. the Docker image baked it in at
# /app/frontend/dist), serve it from the same FastAPI process so the
# whole app lives behind a single origin / port. In local dev this
# directory is absent and the block is skipped — Vite on :5173 keeps
# proxying /api/* during development.
_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if _DIST.is_dir():
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    # Hashed bundle output goes under /assets — serve it directly.
    _ASSETS = _DIST / "assets"
    if _ASSETS.is_dir():
        app.mount("/assets", StaticFiles(directory=_ASSETS), name="assets")

    # SPA fallback: any unknown path that isn't an /api/* route returns
    # index.html so client-side routing works. Real files under dist/
    # (favicon, public images, etc.) are served as-is.
    @app.get("/{full_path:path}", include_in_schema=False)
    async def _spa_fallback(full_path: str) -> FileResponse:
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")
        candidate = _DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_DIST / "index.html")

