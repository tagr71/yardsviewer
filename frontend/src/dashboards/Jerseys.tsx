import { useEffect, useMemo, useState } from "react";
import {
  FRONTYARD_MAX_CAP,
  formatHms,
  frontyardElapsedAtLoopStart,
  frontyardState,
  osloWallClockToInstant,
  playbackBtn,
  useNowTick,
  useTimerSettings,
  useViewLoop,
} from "./timerCore";

type JerseyEntry = {
  bib: string;
  name: string;
  club: string;
  sex: string;
  points?: number;
  perLoop?: { loop: number; points?: number; time?: string; lapSec?: number; totalSec?: number }[];
  totalSec?: number;
  lapsCompleted?: number;
};

type JerseysPayload = {
  eventName?: string;
  raceFinished?: boolean;
  green: JerseyEntry[];
  pink: JerseyEntry[];
  yellow: JerseyEntry[];
};

type Sex = "M" | "K";

/** Sum the runner's perLoop points up to (and including) `maxLoop`.
 * Falls back to the backend-reported total if no perLoop data exists. */
function sumUpto(entry: JerseyEntry, maxLoop: number): number {
  if (entry.perLoop && entry.perLoop.length > 0) {
    return entry.perLoop
      .filter((p) => p.loop <= maxLoop)
      .reduce((acc, p) => acc + (p.points ?? 0), 0);
  }
  return entry.points ?? 0;
}

/** Points the runner scored in exactly `loop`, or 0 if none. Used as the
 * tie-breaker for the pink/green jerseys when totals are equal. */
function pointsAtLoop(entry: JerseyEntry, loop: number): number {
  const p = (entry.perLoop ?? []).find((x) => x.loop === loop);
  return p?.points ?? 0;
}

/** Lap time (seconds) the runner ran in exactly `loop`, or 0 if missing.
 * Used as the tie-breaker for the yellow jersey when total times tie. */
function lapSecAtLoop(entry: JerseyEntry, loop: number): number {
  const p = (entry.perLoop ?? []).find((x) => x.loop === loop);
  return p?.lapSec ?? 0;
}

/** Accumulated race time (seconds) from loop 1 through `maxLoop`. Prefers
 * the per-loop cumulative `totalSec` at the cap; falls back to summing
 * `lapSec` values; and finally to the entry-level `totalSec` when no
 * per-loop data is available. */
function accTimeUpto(entry: JerseyEntry, maxLoop: number): number {
  const capped = (entry.perLoop ?? []).filter((p) => p.loop <= maxLoop);
  if (capped.length > 0) {
    const last = capped[capped.length - 1];
    if (typeof last.totalSec === "number" && last.totalSec > 0) {
      return last.totalSec;
    }
    const sum = capped.reduce(
      (acc, p) => acc + (typeof p.lapSec === "number" ? p.lapSec : 0),
      0,
    );
    if (sum > 0) return sum;
  }
  return entry.totalSec ?? 0;
}

/** Highest loop number with any recorded data on the runner. */
function lastCompletedLoop(entry: JerseyEntry): number {
  let max = 0;
  for (const p of entry.perLoop ?? []) {
    if (p.loop > max) max = p.loop;
  }
  return max;
}

const TABLE_BG: Record<"pink" | "green" | "yellow", string> = {
  pink: "#fce7f3",
  green: "#dcfce7",
  yellow: "#fef9c3",
};
const TABLE_LABEL: Record<"pink" | "green" | "yellow", string> = {
  pink: "Pink jersey",
  green: "Green jersey",
  yellow: "Yellow jersey",
};
const BADGE_BG: Record<"pink" | "green" | "yellow", string> = {
  pink: "#ec4899",
  green: "#16a34a",
  yellow: "#eab308",
};
const BADGE_FG: Record<"pink" | "green" | "yellow", string> = {
  pink: "white",
  green: "white",
  yellow: "#3f2c00",
};
const BADGE_LETTER: Record<"pink" | "green" | "yellow", string> = {
  pink: "P",
  green: "G",
  yellow: "Y",
};

/** Small inline pills indicating which jerseys the runner currently
 * holds. Rendered next to the runner's name in every table. */
function JerseyBadges({ jerseys }: { jerseys?: ("pink" | "green" | "yellow")[] }) {
  if (!jerseys || jerseys.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", gap: "0.2rem", marginLeft: "0.4rem" }}>
      {jerseys.map((j) => (
        <span
          key={j}
          title={`Current ${j} jersey holder`}
          aria-label={`${j} jersey`}
          style={{
            display: "inline-block",
            minWidth: "1.1rem",
            padding: "0 0.35rem",
            borderRadius: "0.65rem",
            background: BADGE_BG[j],
            color: BADGE_FG[j],
            fontSize: "0.72rem",
            fontWeight: 700,
            textAlign: "center",
            lineHeight: "1.1rem",
            border: "1px solid rgba(0,0,0,0.1)",
          }}
        >
          {BADGE_LETTER[j]}
        </span>
      ))}
    </span>
  );
}

type DisplayRow = {
  rank: number;
  bib: string;
  name: string;
  club: string;
  value: string;
  sub?: string;
  jerseys?: ("pink" | "green" | "yellow")[];
};

function JerseyTable({
  jersey,
  sex,
  rows,
  valueHeader,
  note,
  endsAt,
}: {
  jersey: "pink" | "green" | "yellow";
  sex: Sex;
  rows: DisplayRow[];
  valueHeader: string;
  note?: string;
  /** Loop number at which this jersey's competition ends. Shown in the
   * table header so viewers know when the standings are locked in. */
  endsAt: number;
}) {
  const sexLabel = sex === "K" ? "Women" : "Men";
  return (
    <div
      style={{
        flex: "1 1 28rem",
        minWidth: "20rem",
        border: "1px solid #ddd",
        borderRadius: "0.4rem",
        overflow: "hidden",
        background: "white",
      }}
    >
      <div
        style={{
          background: TABLE_BG[jersey],
          padding: "0.5rem 0.75rem",
          fontWeight: 600,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "0.5rem",
        }}
      >
        <span>
          {TABLE_LABEL[jersey]} — {sexLabel}
          <span style={{ fontWeight: 400, color: "#555", marginLeft: "0.4rem" }}>
            (ends at loop {endsAt})
          </span>
        </span>
        {note && (
          <span style={{ fontSize: "0.8rem", fontWeight: 400, color: "#666" }}>
            {note}
          </span>
        )}
      </div>
      <table
        style={{
          borderCollapse: "collapse",
          width: "100%",
          tableLayout: "fixed",
          fontSize: "0.95rem",
        }}
      >
        <colgroup>
          <col style={{ width: "2.5rem" }} />
          <col style={{ width: "3rem" }} />
          <col />
          <col />
          <col style={{ width: "6rem" }} />
        </colgroup>
        <thead>
          <tr style={{ background: "#fafafa" }}>
            <th style={th}>#</th>
            <th style={th}>Bib</th>
            <th style={{ ...th, textAlign: "left" }}>Name</th>
            <th style={{ ...th, textAlign: "left" }}>Club</th>
            <th style={th}>{valueHeader}</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ ...td, color: "#888", textAlign: "center" }}>
                No data
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={`${r.bib}-${i}`} style={i % 2 ? { background: "#fafafa" } : undefined}>
                <td style={tdNum}>{r.rank}</td>
                <td style={tdNum}>{r.bib}</td>
                <td style={td}>
                  {r.name}
                  <JerseyBadges jerseys={r.jerseys} />
                </td>
                <td style={td}>{r.club}</td>
                <td style={tdNum}>
                  {r.value}
                  {r.sub && (
                    <span style={{ color: "#888", fontSize: "0.85em" }}> {r.sub}</span>
                  )}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Resolve a runner's sex from supplementary lookup maps. The yellow
 * (and most green) lists publish a sex column, but the pink list does
 * not, so we cross-reference the other lists by bib. */
function resolveSex(entry: JerseyEntry, lookup: Map<string, string>): string {
  if (entry.sex === "M" || entry.sex === "K") return entry.sex;
  return lookup.get(entry.bib) ?? entry.sex ?? "";
}

/** Rank entries by accumulated points (descending) up to `cap`, split by
 * sex, capped at the top 10. Shared between the pink and green jersey
 * standings — both use the same per-loop points model. Ties on total
 * points are broken by the points scored on the snapshot loop itself. */
function rankByPoints(
  entries: JerseyEntry[],
  sexLookup: Map<string, string>,
  cap: number,
): Record<Sex, DisplayRow[]> {
  const out: Record<Sex, DisplayRow[]> = { M: [], K: [] };
  for (const sex of ["K", "M"] as Sex[]) {
    const ranked = entries
      .filter((e) => resolveSex(e, sexLookup) === sex)
      .map((e) => ({ e, pts: sumUpto(e, cap) }))
      .filter((x) => x.pts > 0)
      .sort((a, b) => {
        if (b.pts !== a.pts) return b.pts - a.pts;
        return pointsAtLoop(b.e, cap) - pointsAtLoop(a.e, cap);
      });
    out[sex] = ranked.slice(0, 10).map(({ e, pts }, i) => ({
      rank: i + 1,
      bib: e.bib,
      name: e.name,
      club: e.club,
      value: `${pts} p`,
    }));
  }
  return out;
}

export function Jerseys({ eventId, eventName }: { eventId: string; eventName?: string }) {
  const { mode, startTime, fyLock, fyMax, jerseyGreen, jerseyPink, jerseyYellow } =
    useTimerSettings(eventId);
  const { viewLoop, setViewLoop } = useViewLoop(eventId);
  const [data, setData] = useState<JerseysPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // Top-level view selector: overview = the original 2x3 grid; the other
  // values drop into a single-jersey detail view (Women on top, Men below)
  // with per-loop columns alongside the accumulated total.
  const [detailView, setDetailView] = useState<"overview" | "pink" | "green" | "yellow">(
    "overview",
  );

  // Compute when the next loop boundary will pass so the next poll can be
  // scheduled to fire shortly after it (giving RaceResult a few seconds to
  // register the lap). Falls back to a fixed cadence in backyard mode and
  // before the race start time has been entered.
  const raceStartMs = useMemo(() => {
    if (mode !== "frontyard" || !startTime) return null;
    const instant = osloWallClockToInstant(startTime);
    return instant ? instant.getTime() : null;
  }, [mode, startTime]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    /** Buffer after a loop boundary before polling, giving RaceResult a
     * few seconds to publish the just-completed loop. */
    const POST_LOOP_DELAY_MS = 5_000;
    /** Fallback cadence used when no loop boundary is scheduled (backyard
     * mode, race not yet started, race already finished). */
    const FALLBACK_MS = 30_000;

    /** Find the wall-clock time of the next loop boundary strictly after
     * `nowMs`, or null if all configured loops have already elapsed (or
     * we don't have enough settings to compute the schedule). */
    function nextLoopBoundaryAfter(nowMs: number): number | null {
      if (raceStartMs === null) return null;
      const maxLoops = Math.min(FRONTYARD_MAX_CAP, Math.max(1, fyMax));
      // The end of loop k = start of loop k+1, which is what we want as
      // the trigger to poll for "loop k completed".
      for (let k = 1; k <= maxLoops; k += 1) {
        const endSec = frontyardElapsedAtLoopStart(k + 1, fyLock);
        const endMs = raceStartMs + endSec * 1000;
        if (endMs > nowMs) return endMs;
      }
      return null;
    }

    function scheduleNext() {
      if (cancelled) return;
      const now = Date.now();
      const boundary = nextLoopBoundaryAfter(now);
      let delay: number;
      if (boundary !== null) {
        const untilBoundary = boundary + POST_LOOP_DELAY_MS - now;
        // Cap the wait at the fallback cadence so the view still refreshes
        // periodically during long pre-race / mid-loop stretches.
        delay = Math.max(1_000, Math.min(FALLBACK_MS, untilBoundary));
      } else {
        delay = FALLBACK_MS;
      }
      timer = window.setTimeout(load, delay);
    }

    async function load() {
      try {
        const res = await fetch(`/api/jerseys?event_id=${encodeURIComponent(eventId)}`);
        if (!res.ok) throw new Error(`jerseys HTTP ${res.status}`);
        const payload = (await res.json()) as JerseysPayload;
        if (cancelled) return;
        setData(payload);
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
    load();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [eventId, raceStartMs, fyLock, fyMax]);

  // Highest loop number with any non-zero points across the green/pink
  // lists (or, failing that, the highest lapsCompleted on yellow). Used
  // both as the upper bound of the replay slider and as the default cap
  // when not scrubbing.
  const maxLoop = useMemo(() => {
    let max = 0;
    for (const e of data?.green ?? []) {
      for (const p of e.perLoop ?? []) {
        if ((p.points ?? 0) > 0 && p.loop > max) max = p.loop;
      }
    }
    for (const e of data?.pink ?? []) {
      for (const p of e.perLoop ?? []) {
        if ((p.points ?? 0) > 0 && p.loop > max) max = p.loop;
      }
    }
    for (const e of data?.yellow ?? []) {
      if (typeof e.lapsCompleted === "number" && e.lapsCompleted > max) {
        max = e.lapsCompleted;
      }
    }
    return max;
  }, [data]);
  const raceFinished = Boolean(data?.raceFinished);

  // Live race-clock derived completed-loop count. In live mode this is
  // what drives the snapshot so the standings advance the moment the
  // timer ticks past a loop boundary, independent of `/api/jerseys`
  // poll freshness.
  const now = useNowTick();
  const liveCompletedLoops = useMemo(() => {
    if (mode !== "frontyard" || raceStartMs === null) return 0;
    const elapsedSec = (now.getTime() - raceStartMs) / 1000;
    if (elapsedSec < 0) return 0;
    const maxLoops = Math.min(FRONTYARD_MAX_CAP, Math.max(1, fyMax));
    return frontyardState(elapsedSec, fyLock, maxLoops).loopsCompleted;
  }, [mode, raceStartMs, now, fyLock, fyMax]);

  // Replay scrubber is available at all times on the Jerseys dashboard
  // — it's useful even mid-race to inspect how the standings looked at
  // an earlier loop. `effectiveViewLoop` is null when the user hasn't
  // scrubbed (i.e. "Live").
  const effectiveViewLoop =
    viewLoop !== null && maxLoop >= 1
      ? Math.min(Math.max(1, viewLoop), maxLoop)
      : null;

  // In live mode the standings and detail views snap to the last
  // completed loop reported by the race clock, so they advance the
  // moment the timer ticks over to a new loop. In replay they follow
  // the scrubber. `snapshotLoop` is `null` only when no loops have
  // been completed yet.
  const snapshotLoop: number | null =
    effectiveViewLoop !== null
      ? effectiveViewLoop
      : liveCompletedLoops >= 1
        ? liveCompletedLoops
        : null;

  // Sex lookup combines whatever sex info the green and yellow lists
  // provide, so the pink list (which omits sex) can still be classified.
  const sexLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of data?.green ?? []) {
      if (e.sex === "M" || e.sex === "K") map.set(e.bib, e.sex);
    }
    for (const e of data?.yellow ?? []) {
      if (e.sex === "M" || e.sex === "K") map.set(e.bib, e.sex);
    }
    return map;
  }, [data]);

  // Effective cut-off loops: the displayed standings always reflect the
  // current `snapshotLoop` (either the replay scrubber value or, in live
  // mode, the last completed loop). The configured jersey cap stays in
  // force so the standings never include loops past the jersey's window.
  const greenCap =
    snapshotLoop !== null ? Math.min(jerseyGreen, snapshotLoop) : jerseyGreen;
  const pinkCap =
    snapshotLoop !== null ? Math.min(jerseyPink, snapshotLoop) : jerseyPink;

  // Yellow: ranked by accumulated total time (ascending — fastest first).
  // In replay mode, the total is the cumulative time from loop 1 through
  // the selected loop (so the standings reproduce the snapshot at that
  // moment); in live mode it's the runner's full-race total. Ties on the
  // ranking time are broken by the lap time on the latest counted loop.
  // We filter to runners who had completed at least `snapshotLoop` loops.
  const yellowBySex = useMemo(() => {
    const out: Record<Sex, DisplayRow[]> = { M: [], K: [] };
    for (const sex of ["K", "M"] as Sex[]) {
      const filtered = (data?.yellow ?? []).filter((e) => {
        if (resolveSex(e, sexLookup) !== sex || (e.totalSec ?? 0) <= 0) return false;
        if (snapshotLoop !== null) {
          const lapsCompleted =
            typeof e.lapsCompleted === "number" ? e.lapsCompleted : 0;
          if (lapsCompleted < snapshotLoop) return false;
        }
        return true;
      });
      const rankingTime = (e: JerseyEntry): number =>
        effectiveViewLoop !== null
          ? accTimeUpto(e, effectiveViewLoop)
          : e.totalSec ?? 0;
      const sorted = [...filtered].sort((a, b) => {
        const ta = rankingTime(a);
        const tb = rankingTime(b);
        if (ta !== tb) return ta - tb;
        // Tie: faster lap on the last counted loop wins. In replay, that's
        // the scrubbed loop; otherwise, the larger of the two last-loop
        // indices so we always compare on the most recent shared loop.
        const tieLoop =
          effectiveViewLoop !== null
            ? effectiveViewLoop
            : Math.max(lastCompletedLoop(a), lastCompletedLoop(b), 1);
        return lapSecAtLoop(a, tieLoop) - lapSecAtLoop(b, tieLoop);
      });
      out[sex] = sorted.slice(0, 10).map((e, i) => ({
        rank: i + 1,
        bib: e.bib,
        name: e.name,
        club: e.club,
        value: formatHms(rankingTime(e)),
        sub:
          typeof e.lapsCompleted === "number"
            ? `(${
                effectiveViewLoop !== null
                  ? Math.min(e.lapsCompleted, effectiveViewLoop)
                  : e.lapsCompleted
              } loops)`
            : undefined,
      }));
    }
    return out;
  }, [data, sexLookup, snapshotLoop, effectiveViewLoop]);

  // Green: backend supplies per-loop points + total. Cap at greenCap.
  // Tie-break: most points on the snapshot loop.
  const greenBySex = useMemo(
    () => rankByPoints(data?.green ?? [], sexLookup, greenCap),
    [data, greenCap, sexLookup],
  );

  // Pink: same shape as green, capped at pinkCap.
  const pinkBySex = useMemo(
    () => rankByPoints(data?.pink ?? [], sexLookup, pinkCap),
    [data, pinkCap, sexLookup],
  );

  // Current jersey holders per sex (rank-1 in each ranking). A single
  // runner may hold multiple jerseys simultaneously. Used to render the
  // jersey-color badges next to each runner's name in every table.
  const holders = useMemo(() => {
    const result: Record<Sex, { pink?: string; green?: string; yellow?: string }> = {
      K: {},
      M: {},
    };
    for (const sex of ["K", "M"] as Sex[]) {
      if (pinkBySex[sex][0]) result[sex].pink = pinkBySex[sex][0].bib;
      if (greenBySex[sex][0]) result[sex].green = greenBySex[sex][0].bib;
      if (yellowBySex[sex][0]) result[sex].yellow = yellowBySex[sex][0].bib;
    }
    return result;
  }, [pinkBySex, greenBySex, yellowBySex]);

  // Attach `jerseys` array to every row so badges show on whichever
  // table the runner appears in (the indicators are independent of the
  // jersey the table is for — a runner holding all three jerseys shows
  // P/G/Y on every appearance).
  const decorate = (rows: DisplayRow[], sex: Sex): DisplayRow[] => {
    const sexHolders = holders[sex];
    return rows.map((r) => {
      const jerseys: ("pink" | "green" | "yellow")[] = [];
      if (sexHolders.pink === r.bib) jerseys.push("pink");
      if (sexHolders.green === r.bib) jerseys.push("green");
      if (sexHolders.yellow === r.bib) jerseys.push("yellow");
      return jerseys.length ? { ...r, jerseys } : r;
    });
  };
  const pinkRows = {
    K: decorate(pinkBySex.K, "K"),
    M: decorate(pinkBySex.M, "M"),
  };
  const greenRows = {
    K: decorate(greenBySex.K, "K"),
    M: decorate(greenBySex.M, "M"),
  };
  const yellowRows = {
    K: decorate(yellowBySex.K, "K"),
    M: decorate(yellowBySex.M, "M"),
  };

  if (mode !== "frontyard") {
    return (
      <section style={{ width: "100%", textAlign: "center", padding: "2rem" }}>
        <h1>Jerseys</h1>
        <p style={{ color: "#888" }}>
          Jerseys dashboard is only available in frontyard mode.
        </p>
      </section>
    );
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
        gap: "1rem",
      }}
    >
      {eventName && (
        <h2 style={{ margin: 0, fontWeight: 500, color: "#555" }}>{eventName}</h2>
      )}
      <h1 style={{ margin: 0 }}>Jerseys</h1>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          fontSize: "0.95rem",
        }}
      >
        <span style={{ color: "#555" }}>View:</span>
        <select
          value={detailView}
          onChange={(e) =>
            setDetailView(e.target.value as typeof detailView)
          }
          style={{
            padding: "0.25rem 0.5rem",
            border: "1px solid #ccc",
            borderRadius: "0.25rem",
            background: "white",
            fontSize: "0.95rem",
          }}
        >
          <option value="overview">Overview (all jerseys)</option>
          <option value="pink">Pink — details</option>
          <option value="green">Green — details</option>
          <option value="yellow">Yellow — details</option>
        </select>
      </label>

      {loading && data === null && <p>Loading…</p>}
      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
      {lastUpdated && (
        <p style={{ margin: 0, fontSize: "0.85rem", color: "#888" }}>
          Last updated: {lastUpdated.toLocaleTimeString()}
        </p>
      )}
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
              ? `Loop ${effectiveViewLoop} / ${maxLoop}`
              : `Live · loop ${Math.max(liveCompletedLoops, maxLoop)}`}
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

      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", width: "100%" }}>
        {detailView === "overview" ? (
          <>
            <Row>
              <JerseyTable
                jersey="pink"
                sex="K"
                rows={pinkRows.K}
                valueHeader="Points"
                endsAt={jerseyPink}
                note={`loops 1–${pinkCap} · spurt (mellomtid) 3/2/1 p`}
              />
              <JerseyTable
                jersey="pink"
                sex="M"
                rows={pinkRows.M}
                valueHeader="Points"
                endsAt={jerseyPink}
                note={`loops 1–${pinkCap} · spurt (mellomtid) 3/2/1 p`}
              />
            </Row>
            <Row>
              <JerseyTable
                jersey="green"
                sex="K"
                rows={greenRows.K}
                valueHeader="Points"
                endsAt={jerseyGreen}
                note={`loops 1–${greenCap} · 10/8/6/3/2/1 p`}
              />
              <JerseyTable
                jersey="green"
                sex="M"
                rows={greenRows.M}
                valueHeader="Points"
                endsAt={jerseyGreen}
                note={`loops 1–${greenCap} · 10/8/6/3/2/1 p`}
              />
            </Row>
            <Row>
              <JerseyTable
                jersey="yellow"
                sex="K"
                rows={yellowRows.K}
                valueHeader="Total time"
                endsAt={jerseyYellow}
                note={
                  snapshotLoop !== null
                    ? `loops 1–${snapshotLoop} · cumulative time`
                    : `finishes loop ${jerseyYellow}`
                }
              />
              <JerseyTable
                jersey="yellow"
                sex="M"
                rows={yellowRows.M}
                valueHeader="Total time"
                endsAt={jerseyYellow}
                note={
                  snapshotLoop !== null
                    ? `loops 1–${snapshotLoop} · cumulative time`
                    : `finishes loop ${jerseyYellow}`
                }
              />
            </Row>
          </>
        ) : (
          <JerseyDetail
            jersey={detailView}
            entries={
              detailView === "pink"
                ? data?.pink ?? []
                : detailView === "green"
                  ? data?.green ?? []
                  : data?.yellow ?? []
            }
            sexLookup={sexLookup}
            maxLoop={
              detailView === "pink"
                ? Math.min(jerseyPink, snapshotLoop ?? maxLoop)
                : detailView === "green"
                  ? Math.min(jerseyGreen, snapshotLoop ?? maxLoop)
                  : snapshotLoop ?? maxLoop
            }
            endsAt={
              detailView === "pink"
                ? jerseyPink
                : detailView === "green"
                  ? jerseyGreen
                  : jerseyYellow
            }
            holders={holders}
          />
        )}
      </div>
    </section>
  );
}

/** Renders one jersey's detail view: Women on top, Men below, each as a
 * table with bib/name/club, the accumulated value, and one cell per loop
 * showing the per-loop points (pink/green) or per-loop split time
 * (yellow). Rows are ranked by the accumulated value up to `maxLoop`. */
function JerseyDetail({
  jersey,
  entries,
  sexLookup,
  maxLoop,
  endsAt,
  holders,
}: {
  jersey: "pink" | "green" | "yellow";
  entries: JerseyEntry[];
  sexLookup: Map<string, string>;
  maxLoop: number;
  /** Loop number at which this jersey's competition ends. */
  endsAt: number;
  holders: Record<Sex, { pink?: string; green?: string; yellow?: string }>;
}) {
  const isYellow = jersey === "yellow";
  const loops = useMemo(
    () => Array.from({ length: Math.max(1, maxLoop) }, (_, i) => i + 1),
    [maxLoop],
  );

  type DetailRow = {
    rank: number;
    bib: string;
    name: string;
    club: string;
    total: string;
    cells: string[];
    jerseys?: ("pink" | "green" | "yellow")[];
  };

  const buildRows = (sex: Sex): DetailRow[] => {
    type Enriched = {
      e: JerseyEntry;
      primary: number;
      tieBreak: number;
      totalText: string;
    };
    const enriched: Enriched[] = [];
    for (const e of entries) {
      if (resolveSex(e, sexLookup) !== sex) continue;
      const perLoop = e.perLoop ?? [];
      if (isYellow) {
        const snap = perLoop
          .filter((p) => p.loop <= maxLoop)
          .reduce<{ totalSec: number; lastLoop: number }>(
            (acc, p) => ({
              totalSec: Math.max(acc.totalSec, p.totalSec ?? 0),
              lastLoop: Math.max(acc.lastLoop, p.loop),
            }),
            { totalSec: 0, lastLoop: 0 },
          );
        if (snap.lastLoop < 1) continue;
        enriched.push({
          e,
          primary: snap.totalSec || 10 ** 12,
          // Tie-break: fastest lap on the runner's last completed loop in
          // the snapshot window (smaller is better).
          tieBreak: lapSecAtLoop(e, snap.lastLoop) || 10 ** 12,
          totalText: formatHms(snap.totalSec),
        });
      } else {
        const pts = sumUpto(e, maxLoop);
        if (pts <= 0) continue;
        enriched.push({
          e,
          primary: -pts,
          // Tie-break: most points on the snapshot loop (larger is better;
          // we negate so the standard ascending sort places it first).
          tieBreak: -pointsAtLoop(e, maxLoop),
          totalText: `${pts} p`,
        });
      }
    }
    enriched.sort((a, b) => {
      if (a.primary !== b.primary) return a.primary - b.primary;
      return a.tieBreak - b.tieBreak;
    });
    const sexHolders = holders[sex];
    return enriched.map(({ e, totalText }, i) => {
      const byLoop = new Map<number, { points?: number; time?: string }>();
      for (const p of e.perLoop ?? []) byLoop.set(p.loop, p);
      const cells = loops.map((n) => {
        const cell = byLoop.get(n);
        if (!cell) return "";
        if (isYellow) return cell.time ?? "";
        const p = cell.points ?? 0;
        return p > 0 ? String(p) : "";
      });
      const jerseys: ("pink" | "green" | "yellow")[] = [];
      if (sexHolders.pink === e.bib) jerseys.push("pink");
      if (sexHolders.green === e.bib) jerseys.push("green");
      if (sexHolders.yellow === e.bib) jerseys.push("yellow");
      return {
        rank: i + 1,
        bib: e.bib,
        name: e.name,
        club: e.club,
        total: totalText,
        cells,
        jerseys: jerseys.length ? jerseys : undefined,
      };
    });
  };

  const womenRows = useMemo(
    () => buildRows("K"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, sexLookup, maxLoop, isYellow, loops, holders],
  );
  const menRows = useMemo(
    () => buildRows("M"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, sexLookup, maxLoop, isYellow, loops, holders],
  );

  const renderSection = (sex: Sex, rows: DetailRow[]) => {
    const sexLabel = sex === "K" ? "Women" : "Men";
    return (
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: "0.4rem",
          overflow: "hidden",
          background: "white",
        }}
      >
        <div
          style={{
            background: TABLE_BG[jersey],
            padding: "0.5rem 0.75rem",
            fontWeight: 600,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: "0.5rem",
          }}
        >
          <span>
            {TABLE_LABEL[jersey]} — {sexLabel}
            <span style={{ fontWeight: 400, color: "#555", marginLeft: "0.4rem" }}>
              (ends at loop {endsAt})
            </span>
          </span>
          <span style={{ fontSize: "0.8rem", fontWeight: 400, color: "#666" }}>
            {isYellow
              ? `per-loop split time · cumulative through loop ${maxLoop}`
              : `per-loop points · accumulated through loop ${maxLoop}`}
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              borderCollapse: "collapse",
              width: "100%",
              tableLayout: "fixed",
              fontSize: "0.92rem",
            }}
          >
            <colgroup>
              <col style={{ width: "2.5rem" }} />
              <col style={{ width: "3rem" }} />
              <col style={{ width: "14rem" }} />
              <col style={{ width: "10rem" }} />
              <col style={{ width: "6rem" }} />
              {loops.map((n) => (
                <col key={n} style={{ width: "3.6rem" }} />
              ))}
            </colgroup>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th style={th}>#</th>
                <th style={th}>Bib</th>
                <th style={{ ...th, textAlign: "left" }}>Name</th>
                <th style={{ ...th, textAlign: "left" }}>Club</th>
                <th style={th}>{isYellow ? "Total time" : "Points"}</th>
                {loops.map((n) => (
                  <th key={n} style={th}>
                    L{n}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5 + loops.length}
                    style={{ ...td, color: "#888", textAlign: "center" }}
                  >
                    No data
                  </td>
                </tr>
              ) : (
                rows.map((r, i) => (
                  <tr
                    key={`${r.bib}-${i}`}
                    style={i % 2 ? { background: "#fafafa" } : undefined}
                  >
                    <td style={tdNum}>{r.rank}</td>
                    <td style={tdNum}>{r.bib}</td>
                    <td style={td}>
                      {r.name}
                      <JerseyBadges jerseys={r.jerseys} />
                    </td>
                    <td style={td}>{r.club}</td>
                    <td style={{ ...tdNum, fontWeight: 600 }}>{r.total}</td>
                    {r.cells.map((c, j) => (
                      <td key={j} style={{ ...tdNum, color: c ? "#222" : "#ccc" }}>
                        {c || "—"}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", width: "100%" }}>
      {renderSection("K", womenRows)}
      {renderSection("M", menRows)}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "1rem",
        flexWrap: "wrap",
        width: "100%",
        alignItems: "flex-start",
      }}
    >
      {children}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "0.4rem 0.6rem",
  borderBottom: "1px solid #ddd",
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};
const td: React.CSSProperties = {
  padding: "0.35rem 0.6rem",
  borderBottom: "1px solid #f0f0f0",
  textAlign: "left",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};
const tdNum: React.CSSProperties = {
  ...td,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};
