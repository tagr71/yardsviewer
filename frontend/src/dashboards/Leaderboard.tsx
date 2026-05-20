import { useEffect, useMemo, useState } from "react";
import {
  BACKYARD_LOOP_KM,
  FRONTYARD_LOOP_KM,
  FRONTYARD_MAX_CAP,
  formatHms,
  frontyardElapsedAtLoopStart,
  osloWallClockToInstant,
  playbackBtn,
  useTimerSettings,
  useViewLoop,
} from "./timerCore";

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
};

const REFRESH_MS = 30_000;

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
  { key: "totalRank", label: "Total Rank", numeric: true },
  { key: "bib", label: "Bib", numeric: true },
  { key: "name", label: "Full Name" },
  { key: "club", label: "Club" },
  { key: "country", label: "Country" },
  { key: "sex", label: "Gender" },
  { key: "laps", label: "Laps", numeric: true },
  { key: "gap", label: "Gap" },
  { key: "lastLap", label: "Last" },
  { key: "fastestLap", label: "Fastest" },
  { key: "slowestLap", label: "Slowest" },
  { key: "averageLap", label: "Average" },
  { key: "total", label: "Total Time" },
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
  const { mode, startTime, fyLock, fyMax } = useTimerSettings(eventId);
  const { viewLoop, setViewLoop } = useViewLoop(eventId);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [raceFinished, setRaceFinished] = useState(false);
  const [eventName, setEventName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("totalRank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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
    const FALLBACK_MS = 30_000;

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
          throw new Error(`HTTP ${res.status}: ${await res.text()}`);
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

  const sortedRows = useMemo(() => {
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
      return {
        ...r,
        lastLap,
        laps,
        distanceKm: laps === null ? null : laps * loopKm,
        accTime,
        accTimeSec,
      };
    });
    return derived.sort((a, b) => compare(a, b, sortKey, sortDir));
  }, [rows, sortKey, sortDir, mode, effectiveViewLoop]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <section
      style={{
        width: "100%",
        maxWidth: "1800px",
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
              ? `Loop ${effectiveViewLoop} / ${maxLoop} (${sortedRows.length})`
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

      {sortedRows.length > 0 && (
        <div
          className="leaderboard-scroll"
          style={{
            width: "100%",
            maxHeight: "calc(100vh - 20rem)",
            overflow: "scroll",
          }}
        >
        <table
          style={{
            borderCollapse: "collapse",
            width: "max-content",
            minWidth: "100%",
            fontSize: "1rem",
          }}
        >
          <thead>
            <tr style={{ background: "#f3f3f3" }}>
              {columns.map((col) => {
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
          <tbody>
            {sortedRows.map((r, i) => (
              <tr
                key={`${r.bib}-${i}`}
                style={i % 2 ? { background: "#fafafa" } : undefined}
              >
                <td style={tdNum}>{r.totalRank ?? "—"}</td>
                <td style={tdNum}>{r.bib}</td>
                <td style={td}>{r.name}</td>
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
                <td style={td}>{r.gap || "—"}</td>
                <td style={td}>{r.lastLap || "—"}</td>
                <td style={td}>{r.fastestLap || "—"}</td>
                <td style={td}>{r.slowestLap || "—"}</td>
                <td style={td}>{r.averageLap || "—"}</td>
                <td style={td}>{r.total || "—"}</td>
                <td style={tdNum}>{r.accTime || "—"}</td>
                <td style={td}>
                  {r.distanceKm === null ? "—" : `${r.distanceKm.toFixed(1)} km`}
                </td>
                <td style={td}>{r.status || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {lastUpdated && (
        <p style={{ margin: 0, color: "#888", fontSize: "0.85rem" }}>
          {raceFinished
            ? `Final results · ${sortedRows.length} entries`
            : `Updated ${lastUpdated.toLocaleTimeString()} · auto-refresh every ${REFRESH_MS / 1000}s · ${sortedRows.length} entries`}
        </p>
      )}
    </section>
  );
}

const th: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  borderBottom: "2px solid #ddd",
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
