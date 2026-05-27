import { useEffect, useMemo, useState } from "react";
import {
  BACKYARD_LOOP_KM,
  FRONTYARD_LOOP_KM,
  FRONTYARD_MAX_CAP,
  formatHms,
  frontyardElapsedAtLoopStart,
  frontyardState,
  leaderboardGroupKey,
  osloWallClockToInstant,
  playbackBtn,
  useTimerSettings,
  useViewLoop,
} from "./timerCore";
import { friendlyFetchError } from "../utils/fetchError";
import {
  buildSexLookup,
  computeWinner,
  isRaceOver,
  type JerseyEntry,
  type WinnerRow,
} from "./jerseyRanking";

type ResultRow = {
  place: number | null;
  bib: string;
  name: string;
  club: string;
  country: string;
  sex: string;
  totalRank: number | null;
  lapsCompleted: number | null;
  lastLap: string;
  fastestLap: string;
  slowestLap: string;
  averageLap: string;
  status: string;
  gap: string;
  lapsBehind: number | null;
  total: string;
  perLoop?: { loop: number; time: string; lapSec?: number; totalSec?: number }[];
};
type ResultsResponse = { eventName?: string; raceFinished?: boolean; rows: ResultRow[] };

type DerivedRow = ResultRow & {
  laps: number | null;
  distanceKm: number | null;
  accTime: string;
  accTimeSec: number | null;
  diff: string;
  diffSec: number | null;
  rankNow: number | null;
  greenPts: number | null;
  greenApiPts: number | null;
  pinkPts: number | null;
};

type JerseyPointsByBib = Map<string, Map<number, number>>;

const REFRESH_MS = 10_000;

/** Common IOC / ISO alpha-3 → ISO alpha-2 country codes used in running events. */
const ALPHA3_TO_ALPHA2: Record<string, string> = {
  AFG: "AF", ALB: "AL", ALG: "DZ", AND: "AD", ANG: "AO", ARG: "AR", ARM: "AM",
  AUS: "AU", AUT: "AT", AZE: "AZ", BAH: "BS", BAN: "BD", BAR: "BB", BDI: "BI",
  BEL: "BE", BEN: "BJ", BER: "BM", BHU: "BT", BIH: "BA", BLR: "BY", BOL: "BO",
  BOT: "BW", BRA: "BR", BRN: "BH", BRU: "BN", BUL: "BG", BUR: "BF", CAF: "CF",
  CAM: "KH", CAN: "CA", CAY: "KY", CGO: "CG", CHA: "TD", CHI: "CL", CHN: "CN",
  CIV: "CI", CMR: "CM", COD: "CD", COL: "CO", COM: "KM", CPV: "CV", CRC: "CR",
  CRO: "HR", CUB: "CU", CYP: "CY", CZE: "CZ", DEN: "DK", DJI: "DJ", DMA: "DM",
  DOM: "DO", ECU: "EC", EGY: "EG", ERI: "ER", ESA: "SV", ESP: "ES", EST: "EE",
  ETH: "ET", FAR: "FO", FIJ: "FJ", FIN: "FI", FRA: "FR", FSM: "FM", GAB: "GA",
  GAM: "GM", GBR: "GB", GBS: "GW", GEO: "GE", GEQ: "GQ", GER: "DE", GHA: "GH",
  GRE: "GR", GRN: "GD", GUA: "GT", GUI: "GN", GUM: "GU", GUY: "GY", HAI: "HT",
  HKG: "HK", HON: "HN", HUN: "HU", INA: "ID", IND: "IN", IRI: "IR", IRL: "IE",
  IRQ: "IQ", ISL: "IS", ISR: "IL", ISV: "VI", ITA: "IT", IVB: "VG", JAM: "JM",
  JOR: "JO", JPN: "JP", KAZ: "KZ", KEN: "KE", KGZ: "KG", KIR: "KI", KOR: "KR",
  KOS: "XK", KSA: "SA", KUW: "KW", LAO: "LA", LAT: "LV", LBA: "LY", LBR: "LR",
  LCA: "LC", LES: "LS", LIB: "LB", LIE: "LI", LTU: "LT", LUX: "LU", MAD: "MG",
  MAR: "MA", MAS: "MY", MAW: "MW", MDA: "MD", MDV: "MV", MEX: "MX", MGL: "MN",
  MKD: "MK", MLI: "ML", MLT: "MT", MNE: "ME", MON: "MC", MOZ: "MZ", MRI: "MU",
  MTN: "MR", MYA: "MM", NAM: "NA", NCA: "NI", NED: "NL", NEP: "NP", NGR: "NG",
  NIG: "NE", NOR: "NO", NRU: "NR", NZL: "NZ", OMA: "OM", PAK: "PK", PAN: "PA",
  PAR: "PY", PER: "PE", PHI: "PH", PLE: "PS", PLW: "PW", PNG: "PG", POL: "PL",
  POR: "PT", PRK: "KP", PUR: "PR", QAT: "QA", ROU: "RO", RSA: "ZA", RUS: "RU",
  RWA: "RW", SAM: "WS", SEN: "SN", SEY: "SC", SGP: "SG", SKN: "KN", SLE: "SL",
  SLO: "SI", SMR: "SM", SOL: "SB", SOM: "SO", SRB: "RS", SRI: "LK", STP: "ST",
  SUD: "SD", SUI: "CH", SUR: "SR", SVK: "SK", SWE: "SE", SWZ: "SZ", SYR: "SY",
  TAN: "TZ", TGA: "TO", THA: "TH", TJK: "TJ", TKM: "TM", TLS: "TL", TOG: "TG",
  TPE: "TW", TRI: "TT", TUN: "TN", TUR: "TR", TUV: "TV", UAE: "AE", UGA: "UG",
  UKR: "UA", URU: "UY", USA: "US", UZB: "UZ", VAN: "VU", VEN: "VE", VIE: "VN",
  VIN: "VC", YEM: "YE", ZAM: "ZM", ZIM: "ZW",
};

/** Returns the ISO alpha-2 code (lowercase) for use with flag image CDNs,
 * or an empty string when no flag can be resolved. */
function countryAlpha2(code: string): string {
  if (!code) return "";
  const up = code.trim().toUpperCase();
  const alpha2 = up.length === 3 ? ALPHA3_TO_ALPHA2[up] ?? "" : up;
  if (alpha2.length !== 2 || !/^[A-Z]{2}$/.test(alpha2)) return "";
  return alpha2.toLowerCase();
}

type SortKey = keyof DerivedRow;
type SortDir = "asc" | "desc";

const columns: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "bib", label: "Bib", numeric: true },
  { key: "name", label: "Full Name" },
  { key: "total", label: "Total" },
  { key: "totalRank", label: "Total Rank", numeric: true },
  { key: "gap", label: "Gap" },
  { key: "club", label: "Club" },
  { key: "country", label: "Country" },
  { key: "sex", label: "Gender" },
  { key: "laps", label: "Laps", numeric: true },
  { key: "lastLap", label: "Last" },
  { key: "rankNow", label: "Rank Last", numeric: true },
  { key: "greenPts", label: "Green", numeric: true },
  { key: "greenApiPts", label: "GreenAPI", numeric: true },
  { key: "pinkPts", label: "PinkAPI", numeric: true },
  { key: "diffSec", label: "Diff", numeric: true },
  { key: "fastestLap", label: "Fastest" },
  { key: "slowestLap", label: "Slowest" },
  { key: "averageLap", label: "Average" },
  { key: "accTimeSec", label: "Acc. Time", numeric: true },
  { key: "distanceKm", label: "Acc. Distance" },
  { key: "status", label: "Status" },
];

function compare(a: DerivedRow, b: DerivedRow, key: SortKey, dir: SortDir): number {
  const av = a[key];
  const bv = b[key];

  // null/empty always sort last regardless of direction
  const aEmpty = av === null || av === "";
  const bEmpty = bv === null || bv === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  let cmp: number;
  if (typeof av === "number" && typeof bv === "number") {
    cmp = av - bv;
  } else if (key === "bib") {
    cmp = Number(av) - Number(bv);
  } else {
    cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: "base" });
  }
  return dir === "asc" ? cmp : -cmp;
}

export function Leaderboard({ eventId }: { eventId: string }) {
  const { mode, startTime, fyLock, fyMax, jerseyGreen, jerseyPink, jerseyYellow } =
    useTimerSettings(eventId);
  const { viewLoop, setViewLoop } = useViewLoop(eventId);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [greenByBib, setGreenByBib] = useState<JerseyPointsByBib>(new Map());
  const [greenApiByBib, setGreenApiByBib] = useState<JerseyPointsByBib>(
    new Map(),
  );
  const [pinkByBib, setPinkByBib] = useState<JerseyPointsByBib>(new Map());
  const [raceFinished, setRaceFinished] = useState(false);
  const [eventName, setEventName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("rankNow");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // Backyard events don't publish jersey-points data or per-loop diff
  // rankings, and the "gap" cell collapses to laps-behind / DNF. Hide
  // the columns that have no meaningful value in that mode.
  const hiddenCols = useMemo<Set<string>>(
    () =>
      mode === "backyard"
        ? new Set([
            "gap",
            "rankNow",
            "greenPts",
            "greenApiPts",
            "pinkPts",
            "diffSec",
          ])
        : new Set(),
    [mode],
  );
  const visibleColumns = useMemo(
    () => columns.filter((c) => !hiddenCols.has(c.key)),
    [hiddenCols],
  );
  // If the current sort column is hidden, fall back to a sort key that
  // is always visible. "totalRank" works for both modes.
  useEffect(() => {
    if (hiddenCols.has(sortKey)) {
      setSortKey("totalRank");
      setSortDir("asc");
    }
  }, [hiddenCols, sortKey]);
  // Group mode persists per event so a refresh keeps the same view.
  const [groupMode, setGroupModeState] = useState<"all" | "gender">(() => {
    if (typeof window === "undefined") return "all";
    const raw = window.localStorage.getItem(leaderboardGroupKey(eventId));
    return raw === "gender" ? "gender" : "all";
  });
  const setGroupMode = (v: "all" | "gender") => {
    setGroupModeState(v);
    try {
      window.localStorage.setItem(leaderboardGroupKey(eventId), v);
    } catch {
      /* localStorage may be unavailable */
    }
  };

  // Wall-clock instant for the configured frontyard start time (if any).
  const raceStartMs = useMemo(() => {
    if (mode !== "frontyard" || !startTime) return null;
    const instant = osloWallClockToInstant(startTime);
    return instant ? instant.getTime() : null;
  }, [mode, startTime]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    /** Buffer after a loop boundary before refetching, giving
     * RaceResult a few seconds to publish the just-completed loop. */
    const POST_LOOP_DELAY_MS = 5_000;
    /** Fallback cadence used when no loop boundary is scheduled
     * (backyard mode, race not yet started, race already finished). */
    const FALLBACK_MS = 10_000;

    function nextLoopBoundaryAfter(nowMs: number): number | null {
      if (raceStartMs === null) return null;
      const maxLoops = Math.min(FRONTYARD_MAX_CAP, Math.max(1, fyMax));
      for (let k = 1; k <= maxLoops; k += 1) {
        const endSec = frontyardElapsedAtLoopStart(k + 1, fyLock);
        const endMs = raceStartMs + endSec * 1000;
        if (endMs > nowMs) return endMs;
      }
      return null;
    }

    function scheduleNext() {
      if (cancelled) return;
      const nowMs = Date.now();
      const boundary = nextLoopBoundaryAfter(nowMs);
      let delay: number;
      if (boundary !== null) {
        const untilBoundary = boundary + POST_LOOP_DELAY_MS - nowMs;
        delay = Math.max(1_000, Math.min(FALLBACK_MS, untilBoundary));
      } else {
        delay = FALLBACK_MS;
      }
      timer = window.setTimeout(load, delay);
    }

    async function load() {
      try {
        const res = await fetch(
          `/api/results?event_id=${encodeURIComponent(eventId)}`,
        );
        if (!res.ok) {
          throw await friendlyFetchError(res);
        }
        const data: ResultsResponse = await res.json();
        if (cancelled) return;
        setRows(data.rows ?? []);
        setEventName(data.eventName ?? "");
        setRaceFinished(Boolean(data.raceFinished));
        setError(null);
        setLastUpdated(new Date());
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
        scheduleNext();
      }
    }

    setLoading(true);
    setRows([]);
    setError(null);
    load();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [eventId, raceStartMs, fyLock, fyMax]);

  // Fetch jersey points (Green + Pink) so the leaderboard can show the
  // per-loop points awarded for the viewed loop. Refreshes alongside the
  // results refresh cadence.
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const REFRESH = 10_000;

    function buildMap(
      entries: {
        bib?: string;
        perLoop?: { loop: number; points?: number; pointsComputed?: number }[];
      }[],
      source: "computed" | "api",
    ): JerseyPointsByBib {
      const m: JerseyPointsByBib = new Map();
      for (const e of entries) {
        const bib = String(e.bib ?? "");
        if (!bib) continue;
        const inner = new Map<number, number>();
        for (const p of e.perLoop ?? []) {
          let pts: number;
          if (source === "computed") {
            // Prefer the locally-computed value (deterministic bib
            // tie-break on lap time) over RaceResult's published
            // `points`, which can drop a runner on a tie because
            // RaceResult uses sub-second chip time we don't have.
            pts =
              typeof p.pointsComputed === "number"
                ? p.pointsComputed
                : typeof p.points === "number"
                  ? p.points
                  : 0;
          } else {
            pts = typeof p.points === "number" ? p.points : 0;
          }
          if (pts > 0) inner.set(p.loop, pts);
        }
        if (inner.size > 0) m.set(bib, inner);
      }
      return m;
    }

    async function load() {
      try {
        const res = await fetch(
          `/api/jerseys?event_id=${encodeURIComponent(eventId)}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setGreenByBib(buildMap(data.green ?? [], "computed"));
        setGreenApiByBib(buildMap(data.green ?? [], "api"));
        setPinkByBib(buildMap(data.pink ?? [], "api"));
      } catch {
        // Non-fatal: leaderboard still renders, points columns show "—".
      } finally {
        if (!cancelled) timer = window.setTimeout(load, REFRESH);
      }
    }

    setGreenByBib(new Map());
    setGreenApiByBib(new Map());
    setPinkByBib(new Map());
    load();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [eventId]);

  const maxLoop = useMemo(() => {
    let m = 0;
    for (const r of rows) {
      if (typeof r.lapsCompleted === "number" && r.lapsCompleted > m) m = r.lapsCompleted;
    }
    return m;
  }, [rows]);

  const effectiveViewLoop =
    viewLoop !== null && maxLoop >= 1
      ? Math.min(Math.max(1, viewLoop), maxLoop)
      : null;

  const derivedRows = useMemo(() => {
    // Lap count comes straight from RaceResult's `NumberOfLaps` field
    // (exposed by the backend as `lapsCompleted`). Last-resort fallback:
    // leader-minus-`lapsBehind`, which only works when the API supplies it.
    // When the user is replaying a finished race, we filter to runners who
    // were still in at the start of the viewed loop and cap each runner's
    // lap count at the viewed loop, so the distance/laps columns reflect
    // the snapshot at that point in time.
    const loopKm = mode === "frontyard" ? FRONTYARD_LOOP_KM : BACKYARD_LOOP_KM;
    const leader = rows.find((r) => r.totalRank === 1);
    const leaderLaps = leader?.lapsCompleted ?? null;

    const visible =
      effectiveViewLoop === null
        ? rows
        : rows.filter((r) =>
            typeof r.lapsCompleted === "number"
              ? r.lapsCompleted >= effectiveViewLoop - 1
              : true,
          );

    const derived: DerivedRow[] = visible.map((r) => {
      let laps: number | null;
      if (r.lapsCompleted !== null) {
        laps = r.lapsCompleted;
      } else if (leaderLaps !== null && r.lapsBehind !== null) {
        laps = Math.max(0, leaderLaps - r.lapsBehind);
      } else {
        laps = null;
      }
      if (effectiveViewLoop !== null && laps !== null) {
        laps = Math.min(laps, effectiveViewLoop);
      }
      // When replaying, the "Last" column shows the lap time of the
      // selected loop (the loop that was just completed at that point in
      // the race) rather than the runner's most recent lap.
      let lastLap = r.lastLap;
      if (effectiveViewLoop !== null) {
        const lap = r.perLoop?.find((p) => p.loop === effectiveViewLoop);
        lastLap = lap?.time ?? "";
      }
      // "Acc. Time" is the cumulative race time from loop 1 to the
      // viewed loop (in live mode: through the runner's last lap). We
      // prefer the Details list's `totalSec` when present, and fall back
      // to summing per-lap `lapSec` values up to the cap.
      let accTimeSec: number | null = null;
      if (r.perLoop && r.perLoop.length > 0) {
        const cap = effectiveViewLoop ?? Number.POSITIVE_INFINITY;
        const capped = r.perLoop.filter((p) => p.loop <= cap);
        if (capped.length > 0) {
          const last = capped[capped.length - 1];
          if (typeof last.totalSec === "number" && last.totalSec > 0) {
            accTimeSec = last.totalSec;
          } else {
            const sum = capped.reduce(
              (acc, p) => acc + (typeof p.lapSec === "number" ? p.lapSec : 0),
              0,
            );
            accTimeSec = sum > 0 ? sum : null;
          }
        }
      }
      const accTime = accTimeSec === null ? "" : formatHms(accTimeSec);
      // Diff is computed per displayed subset in `renderTable` so the
      // By Gender tables can use their own per-loop fastest as reference.
      // Green/Pink points for the viewed loop come from /api/jerseys.
      const pointsLoop = effectiveViewLoop ?? (maxLoop >= 1 ? maxLoop : null);
      const greenPts =
        pointsLoop !== null
          ? greenByBib.get(String(r.bib))?.get(pointsLoop) ?? null
          : null;
      const greenApiPts =
        pointsLoop !== null
          ? greenApiByBib.get(String(r.bib))?.get(pointsLoop) ?? null
          : null;
      const pinkPts =
        pointsLoop !== null
          ? pinkByBib.get(String(r.bib))?.get(pointsLoop) ?? null
          : null;
      return {
        ...r,
        lastLap,
        laps,
        distanceKm: laps === null ? null : laps * loopKm,
        accTime,
        accTimeSec,
        diff: "",
        diffSec: null,
        rankNow: null,
        greenPts,
        greenApiPts,
        pinkPts,
      };
    });
    return derived;
  }, [rows, mode, effectiveViewLoop, maxLoop, greenByBib, greenApiByBib, pinkByBib]);

  // Identify the current jersey holder per sex for pink/green/yellow, so
  // the leaderboard can show jersey-color icons next to that runner's name.
  // Mirrors the logic in Jerseys.tsx: green/pink use accumulated per-loop
  // points up to min(jerseyCap, snapshotLoop); yellow uses cumulative time
  // through min(jerseyYellow, snapshotLoop) among runners who completed at
  // least that loop. In live mode the snapshot follows the race clock
  // (matches Jerseys.tsx); in replay it follows the playback scrubber.
  // Race-clock-derived completed-loop count, kept in component state so a
  // 1Hz interval only triggers a re-render when the value actually changes
  // (i.e. once per loop boundary, not once per second).
  const [liveCompletedLoops, setLiveCompletedLoops] = useState(0);
  useEffect(() => {
    if (mode !== "frontyard" || raceStartMs === null) {
      setLiveCompletedLoops(0);
      return;
    }
    const maxLoops = Math.min(FRONTYARD_MAX_CAP, Math.max(1, fyMax));
    const tick = () => {
      const elapsedSec = (Date.now() - raceStartMs) / 1000;
      const lc =
        elapsedSec < 0
          ? 0
          : frontyardState(elapsedSec, fyLock, maxLoops).loopsCompleted;
      setLiveCompletedLoops((prev) => (prev === lc ? prev : lc));
    };
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [mode, raceStartMs, fyLock, fyMax]);

  const jerseyHolders = useMemo(() => {
    const empty: Record<"pink" | "green" | "yellow", { K?: string; M?: string }> = {
      pink: {},
      green: {},
      yellow: {},
    };
    // Use the race-clock loop count when live (matches Jerseys.tsx) so the
    // badges advance the moment a loop boundary passes, independent of the
    // /api/results poll cadence. In replay, follow the scrubber.
    const snapshotLoop =
      effectiveViewLoop ?? (liveCompletedLoops >= 1 ? liveCompletedLoops : null);
    if (snapshotLoop === null) return empty;
    const greenCap = Math.min(jerseyGreen || snapshotLoop, snapshotLoop);
    const pinkCap = Math.min(jerseyPink || snapshotLoop, snapshotLoop);
    const yellowCap = Math.min(jerseyYellow || snapshotLoop, snapshotLoop);

    // Exact-match sex predicate (matches Jerseys/Dashboard). Anything
    // other than "M" or "K" is unclassified and excluded.
    const sexKey = (r: ResultRow): "K" | "M" | null => {
      if (r.sex === "K") return "K";
      if (r.sex === "M") return "M";
      return null;
    };
    const sumPoints = (map: JerseyPointsByBib, bib: string, cap: number): number => {
      const inner = map.get(bib);
      if (!inner) return 0;
      let s = 0;
      for (const [loop, pts] of inner) if (loop <= cap) s += pts;
      return s;
    };
    const pointsAt = (map: JerseyPointsByBib, bib: string, loop: number): number =>
      map.get(bib)?.get(loop) ?? 0;
    const lapSecAt = (r: ResultRow, loop: number): number => {
      const p = (r.perLoop ?? []).find((x) => x.loop === loop);
      return typeof p?.lapSec === "number" ? p.lapSec : 0;
    };
    const accTotalSec = (r: ResultRow, cap: number): number => {
      const capped = (r.perLoop ?? []).filter((p) => p.loop <= cap);
      if (capped.length === 0) return 0;
      const last = capped[capped.length - 1];
      if (typeof last.totalSec === "number" && last.totalSec > 0) return last.totalSec;
      return capped.reduce(
        (acc, p) => acc + (typeof p.lapSec === "number" ? p.lapSec : 0),
        0,
      );
    };

    const result = { pink: {}, green: {}, yellow: {} } as typeof empty;
    for (const sex of ["K", "M"] as const) {
      const sexRows = rows.filter((r) => sexKey(r) === sex);
      // Pick the rank-1 by (total points desc, then points-on-snapshot-loop
      // desc) -- same tie-break as Jerseys.tsx rankByPoints. Use the API
      // `points` source (greenApiByBib / pinkByBib) so the holder matches
      // the Jerseys dashboard exactly.
      const pickPointsLeader = (
        map: JerseyPointsByBib,
        cap: number,
      ): string | undefined => {
        let bestBib: string | undefined;
        let bestTotal = 0;
        let bestTie = 0;
        for (const r of sexRows) {
          const bib = String(r.bib);
          const total = sumPoints(map, bib, cap);
          if (total <= 0) continue;
          const tie = pointsAt(map, bib, cap);
          if (
            total > bestTotal ||
            (total === bestTotal && tie > bestTie)
          ) {
            bestTotal = total;
            bestTie = tie;
            bestBib = bib;
          }
        }
        return bestBib;
      };
      const green = pickPointsLeader(greenApiByBib, greenCap);
      if (green) result.green[sex] = green;
      const pink = pickPointsLeader(pinkByBib, pinkCap);
      if (pink) result.pink[sex] = pink;
      // yellow: lowest cumulative time through `yellowCap` (which freezes
      // at jerseyYellow once we've passed it). Tie-break: fastest lap on
      // that loop.
      let bestSec = Number.POSITIVE_INFINITY;
      let bestTie = Number.POSITIVE_INFINITY;
      let bestBib = "";
      for (const r of sexRows) {
        if ((r.lapsCompleted ?? 0) < yellowCap) continue;
        const sec = accTotalSec(r, yellowCap);
        if (sec <= 0) continue;
        const tie = lapSecAt(r, yellowCap);
        if (sec < bestSec || (sec === bestSec && tie < bestTie)) {
          bestSec = sec;
          bestTie = tie;
          bestBib = String(r.bib);
        }
      }
      if (bestBib) result.yellow[sex] = bestBib;
    }
    return result;
  }, [
    rows,
    effectiveViewLoop,
    liveCompletedLoops,
    greenApiByBib,
    pinkByBib,
    jerseyGreen,
    jerseyPink,
    jerseyYellow,
  ]);

  function jerseysForBib(bib: string): ("pink" | "green" | "yellow")[] {
    const out: ("pink" | "green" | "yellow")[] = [];
    const b = String(bib);
    for (const sex of ["K", "M"] as const) {
      if (jerseyHolders.pink[sex] === b) out.push("pink");
      if (jerseyHolders.green[sex] === b) out.push("green");
      if (jerseyHolders.yellow[sex] === b) out.push("yellow");
    }
    return out;
  }

  // For each jersey, count how many loops every runner has been the
  // rank-1 holder up to the snapshot loop (capped at each jersey's
  // configured end loop). Used by the inline badges next to the
  // runner's name so the pill shows the loops-held count instead of
  // the redundant P/G/Y letter.
  const heldCountsByJersey = useMemo(() => {
    const empty: Record<
      "pink" | "green" | "yellow",
      Record<"K" | "M", Map<string, number>>
    > = {
      pink: { K: new Map(), M: new Map() },
      green: { K: new Map(), M: new Map() },
      yellow: { K: new Map(), M: new Map() },
    };
    const snapshotLoop =
      effectiveViewLoop ?? (liveCompletedLoops >= 1 ? liveCompletedLoops : null);
    const effectiveSnapshot = snapshotLoop ?? maxLoop;
    if (effectiveSnapshot < 1) return empty;
    const greenEnd = Math.min(jerseyGreen || effectiveSnapshot, effectiveSnapshot);
    const pinkEnd = Math.min(jerseyPink || effectiveSnapshot, effectiveSnapshot);
    const yellowEnd = Math.min(jerseyYellow || effectiveSnapshot, effectiveSnapshot);

    const sexKey = (r: ResultRow): "K" | "M" | null => {
      if (r.sex === "K") return "K";
      if (r.sex === "M") return "M";
      return null;
    };
    const pointsAt = (map: JerseyPointsByBib, bib: string, loop: number): number =>
      map.get(bib)?.get(loop) ?? 0;
    const sumPoints = (map: JerseyPointsByBib, bib: string, cap: number): number => {
      const inner = map.get(bib);
      if (!inner) return 0;
      let s = 0;
      for (const [loop, pts] of inner) if (loop <= cap) s += pts;
      return s;
    };
    const lapSecAt = (r: ResultRow, loop: number): number => {
      const p = (r.perLoop ?? []).find((x) => x.loop === loop);
      return typeof p?.lapSec === "number" ? p.lapSec : 0;
    };
    const accTotalSec = (r: ResultRow, cap: number): number => {
      const capped = (r.perLoop ?? []).filter((p) => p.loop <= cap);
      if (capped.length === 0) return 0;
      const last = capped[capped.length - 1];
      if (typeof last.totalSec === "number" && last.totalSec > 0) return last.totalSec;
      return capped.reduce(
        (acc, p) => acc + (typeof p.lapSec === "number" ? p.lapSec : 0),
        0,
      );
    };

    for (const sex of ["K", "M"] as const) {
      const sexRows = rows.filter((r) => sexKey(r) === sex);
      const pickPoints = (
        map: JerseyPointsByBib,
        loop: number,
      ): string | undefined => {
        let bestBib: string | undefined;
        let bestTotal = 0;
        let bestTie = 0;
        for (const r of sexRows) {
          const bib = String(r.bib);
          const total = sumPoints(map, bib, loop);
          if (total <= 0) continue;
          const tie = pointsAt(map, bib, loop);
          if (total > bestTotal || (total === bestTotal && tie > bestTie)) {
            bestTotal = total;
            bestTie = tie;
            bestBib = bib;
          }
        }
        return bestBib;
      };
      const pickYellow = (loop: number): string | undefined => {
        let bestSec = Number.POSITIVE_INFINITY;
        let bestTie = Number.POSITIVE_INFINITY;
        let bestBib: string | undefined;
        for (const r of sexRows) {
          if ((r.lapsCompleted ?? 0) < loop) continue;
          const sec = accTotalSec(r, loop);
          if (sec <= 0) continue;
          const tie = lapSecAt(r, loop);
          if (sec < bestSec || (sec === bestSec && tie < bestTie)) {
            bestSec = sec;
            bestTie = tie;
            bestBib = String(r.bib);
          }
        }
        return bestBib;
      };
      for (let loop = 1; loop <= greenEnd; loop += 1) {
        const bib = pickPoints(greenApiByBib, loop);
        if (bib)
          empty.green[sex].set(bib, (empty.green[sex].get(bib) ?? 0) + 1);
      }
      for (let loop = 1; loop <= pinkEnd; loop += 1) {
        const bib = pickPoints(pinkByBib, loop);
        if (bib)
          empty.pink[sex].set(bib, (empty.pink[sex].get(bib) ?? 0) + 1);
      }
      for (let loop = 1; loop <= yellowEnd; loop += 1) {
        const bib = pickYellow(loop);
        if (bib)
          empty.yellow[sex].set(bib, (empty.yellow[sex].get(bib) ?? 0) + 1);
      }
    }
    return empty;
  }, [
    rows,
    effectiveViewLoop,
    liveCompletedLoops,
    maxLoop,
    greenApiByBib,
    pinkByBib,
    jerseyGreen,
    jerseyPink,
    jerseyYellow,
  ]);

  function jerseyCountsForBib(
    bib: string,
  ): Partial<Record<"pink" | "green" | "yellow", number>> {
    const b = String(bib);
    const out: Partial<Record<"pink" | "green" | "yellow", number>> = {};
    for (const sex of ["K", "M"] as const) {
      for (const j of ["pink", "green", "yellow"] as const) {
        const n = heldCountsByJersey[j][sex].get(b);
        if (typeof n === "number" && n > 0) out[j] = n;
      }
    }
    return out;
  }

  // Per-jersey, per-sex "decided / finished" status. Mirrors the
  // computeJerseyStatus logic from Jerseys.tsx so the Leaderboard
  // badges can show a ✓ suffix next to the count when the jersey is
  // mathematically decided (or once the jersey's last loop is done).
  const jerseyStatuses = useMemo(() => {
    type S = "decided" | "likely" | "finished" | null;
    const empty: Record<"pink" | "green" | "yellow", { K: S; M: S }> = {
      pink: { K: null, M: null },
      green: { K: null, M: null },
      yellow: { K: null, M: null },
    };
    const snapshotLoop =
      effectiveViewLoop ?? (liveCompletedLoops >= 1 ? liveCompletedLoops : null);

    const sexKey = (r: ResultRow): "K" | "M" | null => {
      if (r.sex === "K") return "K";
      if (r.sex === "M") return "M";
      return null;
    };
    const pointsAt = (map: JerseyPointsByBib, bib: string, loop: number): number =>
      map.get(bib)?.get(loop) ?? 0;
    const sumPoints = (map: JerseyPointsByBib, bib: string, cap: number): number => {
      const inner = map.get(bib);
      if (!inner) return 0;
      let s = 0;
      for (const [loop, pts] of inner) if (loop <= cap) s += pts;
      return s;
    };
    const lapSecAt = (r: ResultRow, loop: number): number => {
      const p = (r.perLoop ?? []).find((x) => x.loop === loop);
      return typeof p?.lapSec === "number" ? p.lapSec : 0;
    };
    const accTotalSec = (r: ResultRow, cap: number): number => {
      const capped = (r.perLoop ?? []).filter((p) => p.loop <= cap);
      if (capped.length === 0) return 0;
      const last = capped[capped.length - 1];
      if (typeof last.totalSec === "number" && last.totalSec > 0) return last.totalSec;
      return capped.reduce(
        (acc, p) => acc + (typeof p.lapSec === "number" ? p.lapSec : 0),
        0,
      );
    };

    const MAX_PTS = { pink: 3, green: 10 } as const;

    const computePoints = (
      jersey: "pink" | "green",
      map: JerseyPointsByBib,
      endsAt: number,
      sex: "K" | "M",
    ): S => {
      if (snapshotLoop === null) return null;
      if (snapshotLoop >= endsAt) return "finished";
      const remaining = endsAt - snapshotLoop;
      if (remaining <= 0) return "finished";
      const sexRows = rows.filter((r) => sexKey(r) === sex);
      const totals: { bib: string; total: number; tie: number }[] = [];
      const cap = Math.min(endsAt, snapshotLoop);
      for (const r of sexRows) {
        const bib = String(r.bib);
        const total = sumPoints(map, bib, cap);
        if (total <= 0) continue;
        totals.push({ bib, total, tie: pointsAt(map, bib, cap) });
      }
      if (totals.length === 0) return null;
      totals.sort((a, b) =>
        b.total !== a.total ? b.total - a.total : b.tie - a.tie,
      );
      const leader = totals[0].total;
      const runnerUp = totals[1]?.total ?? 0;
      const lead = leader - runnerUp;
      const max = remaining * MAX_PTS[jersey];
      if (lead > max) return "decided";
      if (lead > max * 0.5) return "likely";
      return null;
    };

    const computeYellow = (endsAt: number, sex: "K" | "M"): S => {
      if (snapshotLoop === null) return null;
      if (snapshotLoop >= endsAt) return "finished";
      const remaining = endsAt - snapshotLoop;
      if (remaining <= 0) return "finished";
      const cap = Math.min(endsAt, snapshotLoop);
      const sexRows = rows.filter((r) => sexKey(r) === sex);
      const totals: { bib: string; sec: number; tie: number }[] = [];
      for (const r of sexRows) {
        if ((r.lapsCompleted ?? 0) < cap) continue;
        const sec = accTotalSec(r, cap);
        if (sec <= 0) continue;
        totals.push({ bib: String(r.bib), sec, tie: lapSecAt(r, cap) });
      }
      if (totals.length === 0) return null;
      totals.sort((a, b) => (a.sec !== b.sec ? a.sec - b.sec : a.tie - b.tie));
      if (totals.length < 2) return "decided";
      // The runner-up can claw back at most one minimum lap time per
      // remaining loop (10 min).
      const YELLOW_MIN_LAP_SEC = 10 * 60;
      const gap = totals[1].sec - totals[0].sec;
      const max = remaining * YELLOW_MIN_LAP_SEC;
      if (gap > max) return "decided";
      if (gap > max * 0.5) return "likely";
      return null;
    };

    for (const sex of ["K", "M"] as const) {
      empty.pink[sex] = computePoints("pink", pinkByBib, jerseyPink, sex);
      empty.green[sex] = computePoints("green", greenApiByBib, jerseyGreen, sex);
      empty.yellow[sex] = computeYellow(jerseyYellow, sex);
    }
    return empty;
  }, [
    rows,
    effectiveViewLoop,
    liveCompletedLoops,
    raceFinished,
    greenApiByBib,
    pinkByBib,
    jerseyGreen,
    jerseyPink,
    jerseyYellow,
  ]);

  const winners = useMemo(() => {
    const empty: { K: WinnerRow | null; M: WinnerRow | null } = { K: null, M: null };
    if (mode !== "frontyard") return empty;
    const snapshotLoop =
      effectiveViewLoop ?? (liveCompletedLoops >= 1 ? liveCompletedLoops : null);
    if (snapshotLoop === null) return empty;
    // Only reveal the overall winner once the race is decided.
    if (!isRaceOver(raceFinished, snapshotLoop, jerseyYellow)) return empty;
    const yellowEntries: JerseyEntry[] = rows.map((r) => ({
      bib: String(r.bib),
      name: r.name,
      club: r.club,
      sex: r.sex,
      perLoop: (r.perLoop ?? []).map((p) => ({
        loop: p.loop,
        lapSec: typeof p.lapSec === "number" ? p.lapSec : 0,
        totalSec: typeof p.totalSec === "number" ? p.totalSec : 0,
      })),
    })) as unknown as JerseyEntry[];
    const sexLookup = buildSexLookup({ green: [], pink: [], yellow: yellowEntries });
    return {
      K: computeWinner(yellowEntries, sexLookup, "K", jerseyYellow, snapshotLoop, fyLock),
      M: computeWinner(yellowEntries, sexLookup, "M", jerseyYellow, snapshotLoop, fyLock),
    };
  }, [mode, rows, effectiveViewLoop, liveCompletedLoops, jerseyYellow, fyLock, raceFinished]);

  function jerseyStatusesForBib(
    bib: string,
  ): Partial<Record<"pink" | "green" | "yellow", "decided" | "likely" | "finished">> {
    const b = String(bib);
    const out: Partial<
      Record<"pink" | "green" | "yellow", "decided" | "likely" | "finished">
    > = {};
    for (const sex of ["K", "M"] as const) {
      for (const j of ["pink", "green", "yellow"] as const) {
        if (jerseyHolders[j][sex] !== b) continue;
        const s = jerseyStatuses[j][sex];
        if (s) out[j] = s;
      }
    }
    return out;
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function isFemale(r: DerivedRow): boolean {
    const s = (r.sex || "").trim().toLowerCase();
    return s === "k" || s === "f" || s === "w" || s === "female" || s === "kvinne";
  }
  function isMale(r: DerivedRow): boolean {
    const s = (r.sex || "").trim().toLowerCase();
    return s === "m" || s === "male" || s === "mann";
  }

  function renderTable(
    rowsToShow: DerivedRow[],
    colWidths?: string[],
    visibleRows: number = 20,
  ) {
    // Compute Diff against the fastest lapSec *within this subset* for
    // each loop number, so the By Gender tables use the fastest female
    // (or male) on that loop as reference -- not the overall fastest.
    const diffLoop = effectiveViewLoop ?? (maxLoop >= 1 ? maxLoop : null);
    const withDiff = augmentWithDiff(rowsToShow, diffLoop);
    const sorted = assignRankLast(withDiff, diffLoop).sort((a, b) =>
      compare(a, b, sortKey, sortDir),
    );
    return (
      <div
        className="leaderboard-scroll"
        style={{
          width: "100%",
          // Show `visibleRows` rows (header ~2rem + N * ~1.85rem) and scroll
          // the rest. Header is sticky so it stays visible while scrolling.
          maxHeight: `calc(2rem + ${visibleRows} * 1.85rem)`,
          overflow: "auto",
        }}
      >
        <table
          style={{
            borderCollapse: "collapse",
            width: "max-content",
            minWidth: "100%",
            fontSize: "1rem",
            tableLayout: colWidths ? "fixed" : "auto",
          }}
        >
          {colWidths && (
            <colgroup>
              {colWidths.map((w, i) => (
                <col key={i} style={{ width: w }} />
              ))}
            </colgroup>
          )}
          {renderHead()}
          <tbody>{sorted.map((r, i) => renderRow(r, i))}</tbody>
        </table>
      </div>
    );
  }

  function augmentWithDiff(
    rowsToShow: DerivedRow[],
    diffLoop: number | null,
  ): DerivedRow[] {
    const fastestLapSecByLoop = new Map<number, number>();
    for (const r of rowsToShow) {
      for (const p of r.perLoop ?? []) {
        if (typeof p.lapSec === "number" && p.lapSec > 0) {
          const cur = fastestLapSecByLoop.get(p.loop);
          if (cur === undefined || p.lapSec < cur) {
            fastestLapSecByLoop.set(p.loop, p.lapSec);
          }
        }
      }
    }
    return rowsToShow.map((r) => {
      let diffSec: number | null = null;
      let diff = "";
      if (diffLoop !== null) {
        const own = r.perLoop?.find((p) => p.loop === diffLoop);
        const ownSec = typeof own?.lapSec === "number" ? own.lapSec : null;
        const fastestSec = fastestLapSecByLoop.get(diffLoop) ?? null;
        if (ownSec !== null && fastestSec !== null) {
          const d = ownSec - fastestSec;
          diffSec = d;
          if (d === 0) {
            diff = "—";
          } else {
            const sign = d > 0 ? "+" : "−";
            const abs = Math.abs(d);
            const mm = Math.floor(abs / 60);
            const ss = Math.floor(abs % 60);
            diff = `${sign}${mm}:${ss.toString().padStart(2, "0")}`;
          }
        }
      }
      return { ...r, diff, diffSec };
    });
  }

  function assignRankLast(
    rowsIn: DerivedRow[],
    diffLoop: number | null,
  ): DerivedRow[] {
    // Rank Last = position when sorting the subset by the lap time of
    // `diffLoop` ascending. Rows missing a lap time for that loop get
    // no rank.
    if (diffLoop === null) {
      return rowsIn.map((r) => ({ ...r, rankNow: null }));
    }
    const withSec = rowsIn.map((r, idx) => {
      const own = r.perLoop?.find((p) => p.loop === diffLoop);
      const sec =
        typeof own?.lapSec === "number" && own.lapSec > 0 ? own.lapSec : null;
      return { r, idx, sec };
    });
    const ranked = withSec
      .filter((x) => x.sec !== null)
      .sort((a, b) => (a.sec as number) - (b.sec as number) || a.idx - b.idx);
    const rankByIdx = new Map<number, number>();
    ranked.forEach((x, i) => rankByIdx.set(x.idx, i + 1));
    return rowsIn.map((r, idx) => ({
      ...r,
      rankNow: rankByIdx.get(idx) ?? null,
    }));
  }

  function renderHead() {
    return (
      <thead>
        <tr style={{ background: "#f3f3f3" }}>
          {visibleColumns.map((col) => {
            const active = col.key === sortKey;
            const arrow = active ? (sortDir === "asc" ? " ▲" : " ▼") : "";
            return (
              <th
                key={col.key}
                onClick={() => toggleSort(col.key)}
                style={{
                  ...th,
                  cursor: "pointer",
                  textAlign: col.numeric ? "right" : "left",
                  userSelect: "none",
                  whiteSpace: "nowrap",
                }}
                title="Click to sort"
              >
                {col.label}
                <span style={{ color: "#888" }}>{arrow}</span>
              </th>
            );
          })}
        </tr>
      </thead>
    );
  }

  function renderRow(r: DerivedRow, i: number) {
    return (
      <tr
        key={`${r.bib}-${i}`}
        style={i % 2 ? { background: "#fafafa" } : undefined}
      >
        <td style={tdNum}>{r.bib}</td>
        <td style={td}>
          {(() => {
            const sx = r.sex === "K" ? "K" : r.sex === "M" ? "M" : null;
            const isWinner = sx !== null && winners[sx]?.bib === String(r.bib);
            return isWinner ? (
              <span
                title="Overall winner — fastest lap on the highest loop completed within the time limit"
                style={{ marginRight: "0.3rem" }}
              >
                🏆
              </span>
            ) : null;
          })()}
          {r.name}
          {mode === "frontyard" && (
            <JerseyBadges
              jerseys={jerseysForBib(r.bib)}
              counts={jerseyCountsForBib(r.bib)}
              statuses={jerseyStatusesForBib(r.bib)}
            />
          )}
        </td>
        <td style={td}>{r.total || "—"}</td>
        <td style={tdNum}>{r.totalRank ?? "—"}</td>
        {!hiddenCols.has("gap") && <td style={td}>{r.gap || "—"}</td>}
        <td style={td}>{r.club}</td>
        <td style={td}>
          {countryAlpha2(r.country) ? (
            <img
              src={`https://flagcdn.com/${countryAlpha2(r.country)}.svg`}
              width={24}
              height={18}
              alt={r.country}
              title={r.country}
              style={{ verticalAlign: "middle", borderRadius: 2 }}
            />
          ) : (
            r.country
          )}
        </td>
        <td style={td}>{r.sex}</td>
        <td style={tdNum}>{r.laps ?? "—"}</td>
        <td style={td}>{r.lastLap || "—"}</td>
        {!hiddenCols.has("rankNow") && (
          <td style={tdNum}>{r.rankNow ?? "—"}</td>
        )}
        {!hiddenCols.has("greenPts") && (
          <td
            style={
              r.greenPts !== r.greenApiPts
                ? { ...tdNum, background: "#fef9c3" }
                : tdNum
            }
          >
            {r.greenPts ?? "—"}
          </td>
        )}
        {!hiddenCols.has("greenApiPts") && (
          <td
            style={
              r.greenPts !== r.greenApiPts
                ? { ...tdNum, background: "#fef9c3" }
                : tdNum
            }
          >
            {r.greenApiPts ?? "—"}
          </td>
        )}
        {!hiddenCols.has("pinkPts") && (
          <td style={tdNum}>{r.pinkPts ?? "—"}</td>
        )}
        {!hiddenCols.has("diffSec") && (
          <td style={tdNum}>{r.diff || "—"}</td>
        )}
        <td style={td}>{r.fastestLap || "—"}</td>
        <td style={td}>{r.slowestLap || "—"}</td>
        <td style={td}>{r.averageLap || "—"}</td>
        <td style={tdNum}>{r.accTime || "—"}</td>
        <td style={td}>
          {r.distanceKm === null ? "—" : `${r.distanceKm.toFixed(1)} km`}
        </td>
        <td style={td}>{r.status || "—"}</td>
      </tr>
    );
  }

  function computeColWidths(rows: DerivedRow[]): string[] {
    // Build per-column widths from the longest content across the given
    // rows (plus the header label) so two separate tables can be locked
    // to identical widths with `table-layout: fixed`.
    return visibleColumns.map((col) => {
      // Country renders a 24px flag image, not text -- give it a fixed slot.
      if (col.key === "country") return "3.5rem";
      // Header label with a little room for the sort arrow.
      let maxLen = col.label.length + 2;
      for (const r of rows) {
        const v = r[col.key];
        const text =
          v === null || v === undefined
            ? "—"
            : col.key === "distanceKm" && typeof v === "number"
              ? `${v.toFixed(1)} km`
              : String(v);
        if (text.length > maxLen) maxLen = text.length;
      }
      // The name cell may also render up to 3 jersey badges (frontyard only).
      // Each badge is ~1.1rem wide with a small gap; reserve ~5ch per badge
      // (count digits + decided/finished suffix) plus a small left margin so
      // both gender tables agree on width.
      if (col.key === "name" && mode === "frontyard") {
        let maxBadges = 0;
        for (const r of rows) {
          const n = jerseysForBib(r.bib).length;
          if (n > maxBadges) maxBadges = n;
        }
        if (maxBadges > 0) maxLen += 1 + maxBadges * 5;
      }
      // 1ch ≈ width of "0". Add padding for cell padding (~1.5ch).
      return `${maxLen + 2}ch`;
    });
  }

  function renderGenderTables() {
    const colWidths = computeColWidths([...femaleRows, ...maleRows]);
    return (
      <>
        {mode === "frontyard" && (
          <p
            style={{
              margin: "0.25rem 0 0",
              fontSize: "0.78rem",
              color: "#555",
              alignSelf: "flex-start",
            }}
          >
            Jersey badges next to a runner's name show the number of loops they
            have held that jersey. A trailing{" "}
            <span aria-label="likely">~</span> means the leader is likely
            (lead exceeds half of the runner-up's max catch-up),{" "}
            <span aria-label="decided">✓</span> means the jersey is decided
            (mathematically uncatchable), and{" "}
            <span aria-label="finished">★</span> means the jersey's last loop
            has been completed.
          </p>
        )}
        <h3 style={{ margin: "0.5rem 0 0", alignSelf: "flex-start" }}>
          Female ({femaleRows.length})
        </h3>
        {femaleRows.length > 0 ? (
          renderTable(femaleRows, colWidths, 10)
        ) : (
          <p style={{ color: "#888", margin: 0 }}>No entries</p>
        )}
        <h3 style={{ margin: "0.5rem 0 0", alignSelf: "flex-start" }}>
          Male ({maleRows.length})
        </h3>
        {maleRows.length > 0 ? (
          renderTable(maleRows, colWidths, 10)
        ) : (
          <p style={{ color: "#888", margin: 0 }}>No entries</p>
        )}
      </>
    );
  }

  const femaleRows = derivedRows.filter(isFemale);
  const maleRows = derivedRows.filter(isMale);
  // `derivedRows` is the unsorted set of rows for the current view loop
  // (in-place sorting happens inside `renderTable` so each subset can
  // compute its own Diff column).

  return (
    <section
      style={{
        width: "100%",
        maxWidth: "2100px",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: "0.75rem",
      }}
    >
      {eventName && (
        <h2 style={{ margin: 0, fontWeight: 500, color: "#555" }}>{eventName}</h2>
      )}
      <h1 style={{ margin: 0 }}>Leaderboard</h1>

      {loading && rows.length === 0 && <p>Loading…</p>}
      {maxLoop >= 1 && (
        <div
          role="group"
          aria-label="Replay controls"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              setViewLoop(Math.max(1, (effectiveViewLoop ?? maxLoop) - 1));
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              setViewLoop(Math.min(maxLoop, (effectiveViewLoop ?? 0) + 1));
            } else if (e.key === "Home") {
              e.preventDefault();
              setViewLoop(1);
            } else if (e.key === "End") {
              e.preventDefault();
              setViewLoop(maxLoop);
            } else if (e.key.toLowerCase() === "l") {
              e.preventDefault();
              setViewLoop(null);
            }
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.4rem 0.6rem",
            background: effectiveViewLoop !== null ? "#fff7ed" : "#f3f3f3",
            border: "1px solid #ddd",
            borderRadius: "0.3rem",
          }}
        >
          <strong>{raceFinished ? "Race finished:" : "Replay:"}</strong>
          <button
            type="button"
            onClick={() => setViewLoop(1)}
            style={playbackBtn}
            aria-label="Jump to first loop"
          >
            ⏮
          </button>
          <button
            type="button"
            onClick={() =>
              setViewLoop(Math.max(1, (effectiveViewLoop ?? maxLoop) - 1))
            }
            style={playbackBtn}
            aria-label="Previous loop"
          >
            ◀
          </button>
          <span style={{ minWidth: "9rem", textAlign: "center" }}>
            {effectiveViewLoop !== null
              ? `Loop ${effectiveViewLoop} / ${maxLoop} (${derivedRows.length})`
              : `Live · loop ${maxLoop}`}
          </span>
          <button
            type="button"
            onClick={() =>
              setViewLoop(Math.min(maxLoop, (effectiveViewLoop ?? 0) + 1))
            }
            style={playbackBtn}
            aria-label="Next loop"
          >
            ▶
          </button>
          <button
            type="button"
            onClick={() => setViewLoop(maxLoop)}
            style={playbackBtn}
            aria-label="Jump to last loop"
          >
            ⏭
          </button>
          <button
            type="button"
            onClick={() => setViewLoop(null)}
            style={{
              ...playbackBtn,
              marginLeft: "auto",
              cursor: effectiveViewLoop === null ? "default" : "pointer",
              opacity: effectiveViewLoop === null ? 0.5 : 1,
            }}
            disabled={effectiveViewLoop === null}
          >
            Live
          </button>
        </div>
      )}
      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}

      {derivedRows.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            alignSelf: "flex-start",
          }}
        >
          <label htmlFor="leaderboard-group" style={{ fontSize: "0.9rem" }}>
            Show:
          </label>
          <select
            id="leaderboard-group"
            value={groupMode}
            onChange={(e) => setGroupMode(e.target.value as "all" | "gender")}
            style={{ padding: "0.25rem 0.5rem" }}
          >
            <option value="all">All</option>
            <option value="gender">By Gender</option>
          </select>
        </div>
      )}

      {derivedRows.length > 0 && groupMode === "all" && renderTable(derivedRows)}

      {derivedRows.length > 0 && groupMode === "gender" && renderGenderTables()}

      {lastUpdated && (
        <p style={{ margin: 0, color: "#888", fontSize: "0.85rem" }}>
          {raceFinished
            ? `Final results · ${derivedRows.length} entries`
            : `Updated ${lastUpdated.toLocaleTimeString()} · auto-refresh every ${REFRESH_MS / 1000}s · ${derivedRows.length} entries`}
        </p>
      )}
    </section>
  );
}

const th: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  borderBottom: "2px solid #ddd",
  position: "sticky",
  top: 0,
  background: "#f3f3f3",
  zIndex: 1,
};
const td: React.CSSProperties = {
  padding: "0.4rem 0.75rem",
  borderBottom: "1px solid #eee",
  whiteSpace: "nowrap",
  textAlign: "left",
};
const tdNum: React.CSSProperties = {
  ...td,
  fontVariantNumeric: "tabular-nums",
  textAlign: "right",
  width: "4rem",
};

const JERSEY_BG: Record<"pink" | "green" | "yellow", string> = {
  pink: "#ec4899",
  green: "#16a34a",
  yellow: "#eab308",
};
const JERSEY_FG: Record<"pink" | "green" | "yellow", string> = {
  pink: "white",
  green: "white",
  yellow: "#3f2c00",
};
const JERSEY_LETTER: Record<"pink" | "green" | "yellow", string> = {
  pink: "P",
  green: "G",
  yellow: "Y",
};

function JerseyBadges({
  jerseys,
  counts,
  statuses,
}: {
  jerseys: ("pink" | "green" | "yellow")[];
  counts?: Partial<Record<"pink" | "green" | "yellow", number>>;
  statuses?: Partial<Record<"pink" | "green" | "yellow", "decided" | "likely" | "finished">>;
}) {
  if (!jerseys || jerseys.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", gap: "0.2rem", marginLeft: "0.4rem" }}>
      {jerseys.map((j) => {
        const count = counts?.[j];
        const status = statuses?.[j];
        const base =
          typeof count === "number" ? String(count) : JERSEY_LETTER[j];
        // Suffix: ~ likely, ✓ decided, ★ finished.
        const suffix =
          status === "finished"
            ? " \u2605"
            : status === "decided"
              ? " \u2713"
              : status === "likely"
                ? " ~"
                : "";
        const label = `${base}${suffix}`;
        const title =
          status === "finished"
            ? `${j} jersey finished${typeof count === "number" ? ` · held on ${count} loop(s)` : ""}`
            : status === "decided"
              ? `${j} jersey decided${typeof count === "number" ? ` · held on ${count} loop(s)` : ""}`
              : status === "likely"
                ? `${j} jersey likely (lead > half of runner-up's max catch-up)${typeof count === "number" ? ` · held on ${count} loop(s)` : ""}`
                : typeof count === "number"
                  ? `Held the ${j} jersey on ${count} loop(s)`
                  : `Current ${j} jersey holder`;
        return (
          <span
            key={j}
            title={title}
            aria-label={`${j} jersey${status ? ` ${status}` : ""}`}
            style={{
              display: "inline-block",
              minWidth: "1.1rem",
              padding: "0 0.35rem",
              borderRadius: "0.65rem",
              background: JERSEY_BG[j],
              color: JERSEY_FG[j],
              fontSize: "0.72rem",
              fontWeight: 700,
              textAlign: "center",
              lineHeight: "1.1rem",
              border: "1px solid rgba(0,0,0,0.1)",
            }}
          >
            {label}
          </span>
        );
      })}
    </span>
  );
}
