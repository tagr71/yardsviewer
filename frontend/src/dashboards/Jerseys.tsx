import { useEffect, useMemo, useState } from "react";
import {
  FRONTYARD_MAX_CAP,
  formatHms,
  frontyardElapsedAtLoopStart,
  frontyardState,
  jerseyDetailKey,
  osloWallClockToInstant,
  playbackBtn,
  useNowTick,
  useTimerSettings,
  useViewLoop,
} from "./timerCore";
import {
  accTimeUpto,
  buildSexLookup,
  computeJerseyStatus,
  computeWinner,
  isRaceOver,
  lapSecAtLoop,
  pointsAtLoop,
  rankByPoints,
  rankYellow,
  resolveSex,
  sumUpto,
  type DisplayRow,
  type JerseyEntry,
  type JerseysPayload,
  type JerseyStatus,
  type Sex,
  type WinnerRow,
} from "./jerseyRanking";

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

function StatusBadge({ status }: { status: JerseyStatus }) {
  if (!status) return null;
  // DECIDED uses blue (not green) so it never visually overlaps with
  // the green-jersey color when shown inside any of the jersey cards.
  // LIKELY uses a lighter amber so it visually reads as "softer than
  // decided but stronger than nothing".
  const palette =
    status === "finished"
      ? { bg: "#1f2937", fg: "white" }
      : status === "decided"
        ? { bg: "#2563eb", fg: "white" }
        : { bg: "#d97706", fg: "white" };
  return (
    <span
      title={
        status === "likely"
          ? "Leader's lead exceeds half of the runner-up's max catch-up"
          : undefined
      }
      style={{
        display: "inline-block",
        marginLeft: "0.5rem",
        padding: "0.05rem 0.45rem",
        borderRadius: "0.65rem",
        background: palette.bg,
        color: palette.fg,
        fontSize: "0.7rem",
        fontWeight: 700,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        verticalAlign: "middle",
      }}
    >
      {status}
    </span>
  );
}

/** For each loop 1..maxLoop, return the bib of the rank-1 runner of the
 * given sex on the given jersey. Pink/green are ranked by accumulated
 * points (tie-break: most points on that loop). Yellow is ranked by
 * ascending cumulative time among runners who have completed at least
 * that many laps. Used to show "held" badges in the per-loop cells and
 * to count how many loops each runner has held the jersey. */
function holdersPerLoop(
  jersey: "pink" | "green" | "yellow",
  entries: JerseyEntry[],
  sexLookup: Map<string, string>,
  maxLoop: number,
): Record<Sex, Map<number, string>> {
  const out: Record<Sex, Map<number, string>> = { K: new Map(), M: new Map() };
  for (const sex of ["K", "M"] as Sex[]) {
    const sexEntries = entries.filter((e) => resolveSex(e, sexLookup) === sex);
    for (let loop = 1; loop <= maxLoop; loop += 1) {
      if (jersey === "yellow") {
        const eligible = sexEntries.filter((e) => {
          const lc = typeof e.lapsCompleted === "number" ? e.lapsCompleted : 0;
          return lc >= loop;
        });
        const sorted = [...eligible].sort((a, b) => {
          const ta = accTimeUpto(a, loop) || 10 ** 12;
          const tb = accTimeUpto(b, loop) || 10 ** 12;
          if (ta !== tb) return ta - tb;
          return lapSecAtLoop(a, loop) - lapSecAtLoop(b, loop);
        });
        if (sorted.length > 0) out[sex].set(loop, sorted[0].bib);
      } else {
        const sorted = sexEntries
          .map((e) => ({ e, pts: sumUpto(e, loop) }))
          .filter((x) => x.pts > 0)
          .sort((a, b) => {
            if (b.pts !== a.pts) return b.pts - a.pts;
            return pointsAtLoop(b.e, loop) - pointsAtLoop(a.e, loop);
          });
        if (sorted.length > 0) out[sex].set(loop, sorted[0].e.bib);
      }
    }
  }
  return out;
}

/** Small colored circle with a number, shown in the "Held" column of
 * the detail views to indicate how many loops a runner has held this
 * jersey. Renders nothing for a zero count to keep the column quiet. */
function CountBadge({
  jersey,
  count,
}: {
  jersey: "pink" | "green" | "yellow";
  count: number;
}) {
  if (count <= 0) return null;
  return (
    <span
      title={`Held the ${jersey} jersey on ${count} loop(s)`}
      aria-label={`Held ${jersey} jersey ${count} times`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: "1.5rem",
        height: "1.5rem",
        padding: "0 0.35rem",
        borderRadius: "0.75rem",
        background: BADGE_BG[jersey],
        color: BADGE_FG[jersey],
        fontSize: "0.78rem",
        fontWeight: 700,
        border: "1px solid rgba(0,0,0,0.1)",
      }}
    >
      {count}
    </span>
  );
}

/** Per-jersey "held loops" count for a single runner. Used by
 * `JerseyBadges` to show the number of loops the runner has held each
 * jersey instead of the redundant P/G/Y letter. */
type JerseyCounts = Partial<Record<"pink" | "green" | "yellow", number>>;

/** Small inline pills indicating which jerseys the runner currently
 * holds. Rendered next to the runner's name in every table. When
 * `counts` is provided, each pill shows the number of loops the
 * runner has held that jersey (the color already conveys which one);
 * otherwise it falls back to the P/G/Y letter. */
function JerseyBadges({
  jerseys,
  counts,
}: {
  jerseys?: ("pink" | "green" | "yellow")[];
  counts?: JerseyCounts;
}) {
  if (!jerseys || jerseys.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", gap: "0.2rem", marginLeft: "0.4rem" }}>
      {jerseys.map((j) => {
        const count = counts?.[j];
        const label = typeof count === "number" ? String(count) : BADGE_LETTER[j];
        const title =
          typeof count === "number"
            ? `Held the ${j} jersey on ${count} loop(s)`
            : `Current ${j} jersey holder`;
        return (
          <span
            key={j}
            title={title}
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
            {label}
          </span>
        );
      })}
    </span>
  );
}

function JerseyTable({
  jersey,
  sex,
  rows,
  valueHeader,
  note,
  endsAt,
  status,
}: {
  jersey: "pink" | "green" | "yellow";
  sex: Sex;
  rows: DisplayRow[];
  valueHeader: string;
  note?: string;
  /** Loop number at which this jersey's competition ends. Shown in the
   * table header so viewers know when the standings are locked in. */
  endsAt: number;
  /** Whether the standings are mathematically decided or fully
   * finished. Rendered as a badge in the table header. */
  status?: JerseyStatus;
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
          <StatusBadge status={status ?? null} />
        </span>
        {note && (
          <span style={{ fontSize: "0.8rem", fontWeight: 400, color: "#666" }}>
            {note}
          </span>
        )}
      </div>
      <div
        style={{
          // Cap visible height to roughly 10 rows + sticky header; the
          // rest of the field is reachable via the vertical scrollbar.
          maxHeight: "23rem",
          overflowY: "auto",
        }}
      >
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
              <th style={thSticky}>#</th>
              <th style={thSticky}>Bib</th>
              <th style={{ ...thSticky, textAlign: "left" }}>Name</th>
              <th style={{ ...thSticky, textAlign: "left" }}>Club</th>
              <th style={thSticky}>{valueHeader}</th>
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
                    <JerseyBadges jerseys={r.jerseys} counts={r.jerseyCounts} />
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
    </div>
  );
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
  // with per-loop columns alongside the accumulated total. Persisted per
  // event so a refresh keeps the user on the same view.
  type DetailView = "overview" | "pink" | "green" | "yellow";
  const [detailView, setDetailViewState] = useState<DetailView>(() => {
    if (typeof window === "undefined") return "overview";
    const raw = window.localStorage.getItem(jerseyDetailKey(eventId));
    if (raw === "pink" || raw === "green" || raw === "yellow" || raw === "overview")
      return raw;
    return "overview";
  });
  const setDetailView = (v: DetailView) => {
    setDetailViewState(v);
    try {
      window.localStorage.setItem(jerseyDetailKey(eventId), v);
    } catch {
      /* localStorage may be unavailable */
    }
  };

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
    const FALLBACK_MS = 10_000;

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
  const sexLookup = useMemo(
    () =>
      buildSexLookup(
        data ?? { green: [], pink: [], yellow: [] },
      ),
    [data],
  );

  // Effective cut-off loops: the displayed standings always reflect the
  // current `snapshotLoop` (either the replay scrubber value or, in live
  // mode, the last completed loop). The configured jersey cap stays in
  // force so the standings never include loops past the jersey's window.
  const greenCap =
    snapshotLoop !== null ? Math.min(jerseyGreen, snapshotLoop) : jerseyGreen;
  const pinkCap =
    snapshotLoop !== null ? Math.min(jerseyPink, snapshotLoop) : jerseyPink;

  // Yellow: ranked by accumulated total time (ascending — fastest first).
  // The ranking uses cumulative time up to the *effective* yellow snapshot
  // loop, which is `snapshotLoop` capped at `jerseyYellow` — so once the
  // yellow competition's last loop is in the books, the holder is frozen
  // for the remainder of the race / for any later replay loop.
  const yellowEffectiveLoop: number | null =
    snapshotLoop !== null ? Math.min(snapshotLoop, jerseyYellow) : null;
  const yellowBySex = useMemo(
    () => rankYellow(data?.yellow ?? [], sexLookup, yellowEffectiveLoop),
    [data, sexLookup, yellowEffectiveLoop],
  );

  // Map of bib -> laps completed, sourced from the yellow / live list.
  // Used to filter DNF'd runners out of the pink/green standings: once
  // a runner stops completing loops, the jersey transfers to the next
  // active runner (matching the rule that a jersey holder must finish
  // the remaining loops to keep it). The yellow ranking already does
  // this internally via `rankYellow`.
  const lapsByBib = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of data?.yellow ?? []) {
      if (typeof e.lapsCompleted === "number") m.set(e.bib, e.lapsCompleted);
    }
    return m;
  }, [data]);

  // Drop runners whose known lapsCompleted is below the snapshot loop.
  // Runners with no laps info (e.g. unknown bibs) are kept so missing
  // data never silently removes someone from the standings.
  const activeAtSnapshot = (entries: JerseyEntry[]): JerseyEntry[] => {
    if (snapshotLoop === null) return entries;
    return entries.filter((e) => {
      const laps = lapsByBib.get(e.bib);
      return laps === undefined || laps >= snapshotLoop;
    });
  };

  // Green: backend supplies per-loop points + total. Cap at greenCap.
  // Tie-break: most points on the snapshot loop.
  const greenBySex = useMemo(
    () => rankByPoints(activeAtSnapshot(data?.green ?? []), sexLookup, greenCap),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, greenCap, sexLookup, lapsByBib, snapshotLoop],
  );

  // Pink: same shape as green, capped at pinkCap.
  const pinkBySex = useMemo(
    () => rankByPoints(activeAtSnapshot(data?.pink ?? []), sexLookup, pinkCap),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, pinkCap, sexLookup, lapsByBib, snapshotLoop],
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

  // For each jersey, count how many loops every runner has been the
  // rank-1 holder up to the snapshot loop (capped at the jersey's
  // configured end loop). Used to render the inline jersey badges
  // next to runner names: instead of the redundant P/G/Y letter, the
  // pill shows this loop count. Computed against the *unfiltered*
  // entries so a runner who held the jersey early but later DNF'd is
  // still credited for the loops they actually held.
  const heldCountsByJersey = useMemo(() => {
    const result: Record<
      "pink" | "green" | "yellow",
      Record<Sex, Map<string, number>>
    > = {
      pink: { K: new Map(), M: new Map() },
      green: { K: new Map(), M: new Map() },
      yellow: { K: new Map(), M: new Map() },
    };
    // Use the live snapshot loop when available; otherwise fall back
    // to the highest loop seen in the data, so the counts still render
    // before the live timer has been configured.
    const effectiveSnapshot = snapshotLoop ?? maxLoop;
    if (effectiveSnapshot < 1) return result;
    const inputs = {
      pink: {
        entries: data?.pink ?? [],
        end: Math.min(jerseyPink, effectiveSnapshot),
      },
      green: {
        entries: data?.green ?? [],
        end: Math.min(jerseyGreen, effectiveSnapshot),
      },
      yellow: {
        entries: data?.yellow ?? [],
        end: Math.min(jerseyYellow, effectiveSnapshot),
      },
    } as const;
    for (const j of ["pink", "green", "yellow"] as const) {
      const { entries, end } = inputs[j];
      if (end < 1) continue;
      const hpl = holdersPerLoop(j, entries, sexLookup, end);
      for (const sex of ["K", "M"] as Sex[]) {
        for (const bib of hpl[sex].values()) {
          result[j][sex].set(bib, (result[j][sex].get(bib) ?? 0) + 1);
        }
      }
    }
    return result;
  }, [
    data,
    sexLookup,
    jerseyPink,
    jerseyGreen,
    jerseyYellow,
    snapshotLoop,
    maxLoop,
  ]);

  // Attach `jerseys` array to every row so badges show on whichever
  // table the runner appears in (the indicators are independent of the
  // jersey the table is for — a runner holding all three jerseys shows
  // all three colors on every appearance). Also attach the per-jersey
  // loops-held counts so the badges can render the number instead of
  // the redundant P/G/Y letter.
  const decorate = (rows: DisplayRow[], sex: Sex): DisplayRow[] => {
    const sexHolders = holders[sex];
    return rows.map((r) => {
      const jerseys: ("pink" | "green" | "yellow")[] = [];
      if (sexHolders.pink === r.bib) jerseys.push("pink");
      if (sexHolders.green === r.bib) jerseys.push("green");
      if (sexHolders.yellow === r.bib) jerseys.push("yellow");
      if (!jerseys.length) return r;
      const jerseyCounts: Partial<
        Record<"pink" | "green" | "yellow", number>
      > = {};
      for (const j of jerseys) {
        const n = heldCountsByJersey[j][sex].get(r.bib);
        if (typeof n === "number" && n > 0) jerseyCounts[j] = n;
      }
      return { ...r, jerseys, jerseyCounts };
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

  // Per-jersey, per-sex status badges shown in the table headers.
  // "decided" = leader's lead exceeds the runner-up's maximum possible
  // remaining points for this jersey's window. "finished" = the
  // jersey's last loop has passed (or the whole race is over).
  const pinkStatus = {
    K: computeJerseyStatus(pinkRows.K, "pink", jerseyPink, snapshotLoop, raceFinished),
    M: computeJerseyStatus(pinkRows.M, "pink", jerseyPink, snapshotLoop, raceFinished),
  };
  const greenStatus = {
    K: computeJerseyStatus(greenRows.K, "green", jerseyGreen, snapshotLoop, raceFinished),
    M: computeJerseyStatus(greenRows.M, "green", jerseyGreen, snapshotLoop, raceFinished),
  };
  const yellowStatus = {
    K: computeJerseyStatus(yellowRows.K, "yellow", jerseyYellow, snapshotLoop, raceFinished),
    M: computeJerseyStatus(yellowRows.M, "yellow", jerseyYellow, snapshotLoop, raceFinished),
  };

  /** Overall race winner per sex. See `computeWinner` for the rule.
   * Only revealed once the race is decided. */
  const raceIsOver = isRaceOver(raceFinished, snapshotLoop, jerseyYellow);
  const winners: { K: WinnerRow | null; M: WinnerRow | null } = raceIsOver
    ? {
        K: computeWinner(
          data?.yellow ?? [],
          sexLookup,
          "K",
          jerseyYellow,
          snapshotLoop,
          fyLock,
        ),
        M: computeWinner(
          data?.yellow ?? [],
          sexLookup,
          "M",
          jerseyYellow,
          snapshotLoop,
          fyLock,
        ),
      }
    : { K: null, M: null };

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
                status={pinkStatus.K}
                note={`loops 1–${pinkCap} · spurt (mellomtid) 3/2/1 p`}
              />
              <JerseyTable
                jersey="pink"
                sex="M"
                rows={pinkRows.M}
                valueHeader="Points"
                endsAt={jerseyPink}
                status={pinkStatus.M}
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
                status={greenStatus.K}
                note={`loops 1–${greenCap} · 10/8/6/3/2/1 p`}
              />
              <JerseyTable
                jersey="green"
                sex="M"
                rows={greenRows.M}
                valueHeader="Points"
                endsAt={jerseyGreen}
                status={greenStatus.M}
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
                status={yellowStatus.K}
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
                status={yellowStatus.M}
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
                ? activeAtSnapshot(data?.pink ?? [])
                : detailView === "green"
                  ? activeAtSnapshot(data?.green ?? [])
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
            statuses={
              detailView === "pink"
                ? pinkStatus
                : detailView === "green"
                  ? greenStatus
                  : yellowStatus
            }
            holdersByLoop={holdersPerLoop(
              detailView,
              detailView === "pink"
                ? data?.pink ?? []
                : detailView === "green"
                  ? data?.green ?? []
                  : data?.yellow ?? [],
              sexLookup,
              detailView === "pink"
                ? Math.min(jerseyPink, snapshotLoop ?? maxLoop)
                : detailView === "green"
                  ? Math.min(jerseyGreen, snapshotLoop ?? maxLoop)
                  : snapshotLoop ?? maxLoop,
            )}
            holders={holders}
            winners={detailView === "yellow" ? winners : undefined}
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
  statuses,
  holdersByLoop,
  holders,
  winners,
}: {
  jersey: "pink" | "green" | "yellow";
  entries: JerseyEntry[];
  sexLookup: Map<string, string>;
  maxLoop: number;
  /** Loop number at which this jersey's competition ends. */
  endsAt: number;
  /** Per-sex decided/finished status badges. */
  statuses: Record<Sex, JerseyStatus>;
  /** Per-sex, per-loop holder bibs for *this* jersey. Used to render
   * the "Held" count column and the jersey badge inside each L-n cell
   * where the runner was the rank-1 holder at that loop. */
  holdersByLoop: Record<Sex, Map<number, string>>;
  holders: Record<Sex, { pink?: string; green?: string; yellow?: string }>;
  /** Yellow detail view only: overall winner per sex (rule: fastest
   * lap on the highest within-time-limit loop). */
  winners?: { K: WinnerRow | null; M: WinnerRow | null };
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
    cells: { text: string; held: boolean }[];
    /** Number of loops (within the jersey's window) on which this
     * runner was the rank-1 holder of this jersey. */
    heldCount: number;
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
    const heldByLoop = holdersByLoop[sex];
    return enriched.map(({ e, totalText }, i) => {
      const byLoop = new Map<number, { points?: number; time?: string }>();
      for (const p of e.perLoop ?? []) byLoop.set(p.loop, p);
      let heldCount = 0;
      const cells = loops.map((n) => {
        const cell = byLoop.get(n);
        const held = heldByLoop.get(n) === e.bib;
        if (held) heldCount += 1;
        let text = "";
        if (cell) {
          if (isYellow) text = cell.time ?? "";
          else {
            const p = cell.points ?? 0;
            text = p > 0 ? String(p) : "";
          }
        }
        return { text, held };
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
        heldCount,
        jerseys: jerseys.length ? jerseys : undefined,
      };
    });
  };

  const womenRows = useMemo(
    () => buildRows("K"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, sexLookup, maxLoop, isYellow, loops, holders, holdersByLoop],
  );
  const menRows = useMemo(
    () => buildRows("M"),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, sexLookup, maxLoop, isYellow, loops, holders, holdersByLoop],
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
            <StatusBadge status={statuses[sex]} />
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
              <col style={{ width: "3.2rem" }} />
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
                <th style={th} title="Loops held as jersey holder">
                  Held
                </th>
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
                    colSpan={6 + loops.length}
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
                    <td style={{ ...tdNum, padding: "0.2rem 0.3rem" }}>
                      <CountBadge jersey={jersey} count={r.heldCount} />
                    </td>
                    <td style={tdNum}>{r.rank}</td>
                    <td style={tdNum}>{r.bib}</td>
                    <td style={td}>
                      {r.name}
                      <JerseyBadges jerseys={r.jerseys} />
                    </td>
                    <td style={td}>{r.club}</td>
                    <td style={{ ...tdNum, fontWeight: 600 }}>{r.total}</td>
                    {r.cells.map((c, j) => (
                      <td
                        key={j}
                        style={{ ...tdNum, color: c.text ? "#222" : "#ccc" }}
                      >
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: "0.25rem",
                          }}
                        >
                          {c.held && <JerseyBadges jerseys={[jersey]} />}
                          {c.text || "—"}
                        </span>
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
      {isYellow && winners && (winners.K || winners.M) && (
        <div
          style={{
            background: "#fffbeb",
            border: "2px solid #facc15",
            borderRadius: "0.5rem",
            padding: "0.5rem 0.75rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
          }}
        >
          <div style={{ fontWeight: 800, color: "#1f2937" }}>
            🏆 Overall winner
            <span
              style={{ color: "#666", fontWeight: 400, fontSize: "0.85em", marginLeft: "0.5rem" }}
            >
              fastest lap on the highest loop completed within the time limit
            </span>
          </div>
          {(["K", "M"] as const).map((sx) => {
            const w = winners[sx];
            if (!w) return null;
            return (
              <div
                key={sx}
                style={{
                  display: "flex",
                  gap: "0.6rem",
                  alignItems: "baseline",
                  fontSize: "0.95rem",
                }}
              >
                <span style={{ fontWeight: 700, color: "#555", minWidth: "3.5rem" }}>
                  {sx === "K" ? "Female" : "Male"}
                </span>
                <span style={{ fontWeight: 800, color: "#111" }}>
                  #{w.bib} {w.name}
                </span>
                <span style={{ color: "#555", fontVariantNumeric: "tabular-nums" }}>
                  loop {w.lap} · {formatHms(w.lapSec)} (total {formatHms(w.totalSec)})
                </span>
              </div>
            );
          })}
        </div>
      )}
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
const thSticky: React.CSSProperties = {
  ...th,
  position: "sticky",
  top: 0,
  background: "#fafafa",
  zIndex: 1,
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
