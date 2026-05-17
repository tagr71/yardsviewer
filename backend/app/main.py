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
) -> tuple[dict[str, Any], str, str, str, str]:
    """Fetch a published RaceResult list. Returns
    (list_payload, event_name, event_location, event_date, event_time).

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
    place_i = find_index("TotalRank", "Rank", "Place")
    if place_i == -1:
        place_i = rank_i
    club_i = find_index("ClubOrCity", "DisplayClubOrNames", "Club", "City")
    country_i = find_index(
        "NATION.FLAG", "NationOrStateFlag", "NationOrState", "Nation", "Country"
    )
    total_rank_i = find_index("TotalRank", "Rank")
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
        # Default to 09:00 local when only a date is available — RaceResult
        # rarely publishes the time of day on its landing pages.
        event_start_time = f"{iso_date}T09:00:00"

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


@app.get("/api/results/fields")
async def results_fields(
    event_id: str | None = None,
    listname: str | None = None,
) -> dict[str, object]:
    """Debug: returns DataFields + the first row of the LIVE (or named) result
    list so we can see exactly which RaceResult column names this event uses."""
    resolved = event_id or RACERESULT_EVENT_ID
    payload, event_name, _, _, _ = await _fetch_list(
        resolved, "results", listname_match=listname or "LIVE"
    )
    fields = payload.get("DataFields") or []
    sample: Any = None
    data = payload.get("data")
    if isinstance(data, list) and data:
        sample = data[0]
    elif isinstance(data, dict):
        for value in data.values():
            if isinstance(value, list) and value:
                sample = value[0]
                break
    return {
        "eventName": event_name,
        "eventId": resolved,
        "fields": fields,
        "sampleRow": sample,
    }


@app.get("/api/results/lists")
async def results_lists(
    event_id: str | None = None,
    page: str = "results",
) -> dict[str, object]:
    """Debug: enumerate every list published on `page` (default "results")
    along with each list's DataFields and a sample row, so we can find one
    that exposes the lap/round count we need."""
    resolved = event_id or RACERESULT_EVENT_ID
    _validate_event_id(resolved)
    config_url = f"{RACERESULT_BASE}/{resolved}/{page}/config?lang=en"

    async with httpx.AsyncClient(timeout=10.0, headers=_auth_headers()) as client:
        resp = await client.get(config_url)
        resp.raise_for_status()
        config = resp.json()
        key = config.get("key")
        server = (
            config.get("server")
            or RACERESULT_BASE.removeprefix("https://").removeprefix("http://")
        )
        lists = (config.get("TabConfig") or {}).get("Lists") or []
        if not key:
            raise HTTPException(status_code=502, detail="No key in config")

        list_url = f"https://{server}/{resolved}/{page}/list"
        out: list[dict[str, Any]] = []
        for lst in lists:
            name = lst.get("Name", "")
            contest = str(lst.get("Contest") or "0")
            params = {
                "key": key,
                "listname": name,
                "page": page,
                "contest": contest,
                "r": "all",
            }
            try:
                lr = await client.get(list_url, params=params)
                lr.raise_for_status()
                lp = lr.json()
                fields = lp.get("DataFields") or []
                sample: Any = None
                data = lp.get("data")
                if isinstance(data, list) and data:
                    sample = data[0]
                elif isinstance(data, dict):
                    for value in data.values():
                        if isinstance(value, list) and value:
                            sample = value[0]
                            break
                out.append(
                    {
                        "name": name,
                        "contest": contest,
                        "fields": fields,
                        "sampleRow": sample,
                    }
                )
            except httpx.HTTPError as exc:
                out.append({"name": name, "contest": contest, "error": str(exc)})

    return {"eventId": resolved, "page": page, "lists": out}


@app.get("/", include_in_schema=False)
async def root() -> RedirectResponse:
    return RedirectResponse(url="/api/participants/count")

