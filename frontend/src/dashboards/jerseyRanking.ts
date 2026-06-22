/**
 * Pure jersey ranking logic shared between dashboards and tests.
 *
 * The functions in this file operate on the same shape that
 * `GET /api/jerseys` returns: a payload of `{ green, pink, yellow }`
 * lists where each entry carries `perLoop[]` with per-loop points
 * (pink/green) or per-loop lap times (yellow).
 *
 * Holder semantics:
 *
 *   * Pink + Green — runner with the most accumulated `points`
 *     across loops `1..cap`, per sex. Tie-break: most points on
 *     the snapshot loop itself.
 *   * Yellow — runner with the lowest accumulated race time across
 *     loops `1..cap`, per sex, among runners who have completed
 *     at least `cap` loops. Tie-break: fastest lap on the snapshot
 *     loop.
 *
 * `cap` is always `min(jerseyCap, snapshotLoop)` so the standings
 * freeze once the jersey's window closes.
 */

import { formatHms } from "./timerCore";

export type Sex = "M" | "K";

export type JerseyPerLoop = {
  loop: number;
  points?: number;
  time?: string;
  lapSec?: number;
  totalSec?: number;
};

export type JerseyEntry = {
  bib: string;
  name: string;
  club: string;
  sex: string;
  points?: number;
  perLoop?: JerseyPerLoop[];
  totalSec?: number;
  lapsCompleted?: number;
  /** Native MF-rank from the RaceResult Gul trøye list (MFRank.P).
   * Present when the backend fetched that list. Rank 1 = jersey holder.
   * When present, `rankYellow` uses it as the primary sort key instead
   * of accumulated time (because the frontyard ranking is laps-first,
   * not time-first, and excludes runners holding other jerseys). */
  mfRank?: number;
};

export type JerseysPayload = {
  eventName?: string;
  raceFinished?: boolean;
  green: JerseyEntry[];
  pink: JerseyEntry[];
  yellow: JerseyEntry[];
};

export type DisplayRow = {
  rank: number;
  bib: string;
  name: string;
  club: string;
  value: string;
  /** Raw numeric value behind `value` (points for pink/green, total
   * seconds for yellow). Used by the Jerseys dashboard to compute
   * whether the standings are mathematically decided. */
  rawValue?: number;
  sub?: string;
  jerseys?: ("pink" | "green" | "yellow")[];
  /** Optional per-jersey "loops held" count, attached by the Jerseys
   * dashboard so the inline badges can show a number instead of the
   * redundant P/G/Y letter. */
  jerseyCounts?: Partial<Record<"pink" | "green" | "yellow", number>>;
};

/** Maximum points the runner-up could still score on a single remaining
 * loop. Used by `computeJerseyStatus` to decide whether the leader's
 * advantage is mathematically insurmountable for the pink/green
 * point-based jerseys. */
export const MAX_POINTS_PER_LOOP: Record<"pink" | "green", number> = {
  pink: 3,
  green: 10,
};

/** Lower bound (seconds) on a yellow-jersey lap time. Also used as
 * the maximum amount of cumulative-time the runner-up can claw back
 * from the leader on a single remaining loop — so the yellow jersey
 * is DECIDED when the leader's lead in seconds exceeds
 *   `remaining_loops × YELLOW_MIN_LAP_SEC`. */
export const YELLOW_MIN_LAP_SEC = 10 * 60;

/** Fraction of the DECIDED threshold above which the standings are
 * considered LIKELY: the lead is more than half of what the runner-up
 * could theoretically claw back, so the leader is the heavy favourite
 * even though it isn't yet mathematically locked. */
export const LIKELY_THRESHOLD_FRACTION = 0.5;

export type JerseyStatus = "decided" | "likely" | "finished" | null;

/** Determine whether a jersey's standings are mathematically decided
 * (leader cannot be caught even if they score nothing in the remaining
 * loops), likely (lead exceeds half of the worst-case catch-up), or
 * finished (the jersey's last loop has been raced).
 *
 * `raceFinished` is intentionally NOT a short-circuit: during playback
 * of earlier loops, the global race may be finished while the displayed
 * snapshot is mid-race; in that case the status should reflect the
 * snapshot so DECIDED is still meaningful when scrubbing back. */
export function computeJerseyStatus(
  rows: DisplayRow[],
  jersey: "pink" | "green" | "yellow",
  endsAt: number,
  snapshotLoop: number | null,
  _raceFinished: boolean,
): JerseyStatus {
  void _raceFinished;
  if (snapshotLoop !== null && snapshotLoop >= endsAt) return "finished";
  if (snapshotLoop === null) return null;
  if (rows.length === 0) return null;
  const leader = rows[0]?.rawValue;
  if (typeof leader !== "number") return null;
  const remaining = endsAt - snapshotLoop;
  if (remaining <= 0) return "finished";

  if (jersey === "yellow") {
    if (rows.length < 2) return "decided";
    const runnerUp = rows[1]?.rawValue;
    if (typeof runnerUp !== "number") return null;
    const gap = runnerUp - leader;
    const max = remaining * YELLOW_MIN_LAP_SEC;
    if (gap > max) return "decided";
    if (gap > max * LIKELY_THRESHOLD_FRACTION) return "likely";
    return null;
  }

  const maxPts = MAX_POINTS_PER_LOOP[jersey];
  const runnerUp = rows[1]?.rawValue ?? 0;
  const lead = leader - runnerUp;
  const max = remaining * maxPts;
  if (lead > max) return "decided";
  if (lead > max * LIKELY_THRESHOLD_FRACTION) return "likely";
  return null;
}

/** Sum the runner's perLoop points up to (and including) `maxLoop`.
 * Falls back to the backend-reported total if no perLoop data exists. */
export function sumUpto(entry: JerseyEntry, maxLoop: number): number {
  if (entry.perLoop && entry.perLoop.length > 0) {
    return entry.perLoop
      .filter((p) => p.loop <= maxLoop)
      .reduce((acc, p) => acc + (p.points ?? 0), 0);
  }
  return entry.points ?? 0;
}

/** Points the runner scored in exactly `loop`, or 0 if none. Used as the
 * tie-breaker for the pink/green jerseys when totals are equal. */
export function pointsAtLoop(entry: JerseyEntry, loop: number): number {
  const p = (entry.perLoop ?? []).find((x) => x.loop === loop);
  return p?.points ?? 0;
}

/** Lap time (seconds) the runner ran in exactly `loop`, or 0 if missing.
 * Used as the tie-breaker for the yellow jersey when total times tie. */
export function lapSecAtLoop(entry: JerseyEntry, loop: number): number {
  const p = (entry.perLoop ?? []).find((x) => x.loop === loop);
  return p?.lapSec ?? 0;
}

/** Accumulated race time (seconds) from loop 1 through `maxLoop`. Prefers
 * the per-loop cumulative `totalSec` at the cap; falls back to summing
 * `lapSec` values; and finally to the entry-level `totalSec` when no
 * per-loop data is available. */
export function accTimeUpto(entry: JerseyEntry, maxLoop: number): number {
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
export function lastCompletedLoop(entry: JerseyEntry): number {
  let max = 0;
  for (const p of entry.perLoop ?? []) {
    if (p.loop > max) max = p.loop;
  }
  return max;
}

/** First-loop length in minutes for the frontyard schedule. Kept local
 * to this module (rather than imported from timerCore) so jerseyRanking
 * stays free of UI-only dependencies. */
const FRONTYARD_FIRST_LOOP_MIN = 30;

/** Length (in seconds) of frontyard loop `loop` given the configured
 * `lockAfter` hold loop. Loops 1..lockAfter shrink by 1 min each;
 * loops > lockAfter reuse the length of loop `lockAfter`. */
export function frontyardLoopLengthSec(
  loop: number,
  lockAfter: number,
): number {
  const lockedLen = Math.max(1, FRONTYARD_FIRST_LOOP_MIN + 1 - lockAfter);
  const naturalLen = Math.max(1, FRONTYARD_FIRST_LOOP_MIN + 1 - loop);
  const len = loop <= lockAfter ? naturalLen : lockedLen;
  return len * 60;
}

export type WinnerRow = {
  bib: string;
  name: string;
  club: string;
  /** The decisive loop — the highest one on which the runner finished
   * within the time limit. */
  lap: number;
  /** Lap time on `lap` (seconds). */
  lapSec: number;
  /** Cumulative race time through `lap` (seconds). */
  totalSec: number;
};

/** Returns `true` once the frontyard race is over: either the backend
 * flagged the race as finished, or the snapshot has reached the
 * configured Yellow & Winner end-loop. Used by all three dashboards
 * to gate the overall-winner indicator. */
export function isRaceOver(
  raceFinished: boolean,
  snapshotLoop: number | null,
  jerseyYellow: number,
): boolean {
  if (raceFinished) return true;
  if (snapshotLoop === null) return false;
  return snapshotLoop >= jerseyYellow;
}

/** Returns `true` when the overall winner is *final* (i.e. the trophy
 * has actually been awarded). This is the strict version of
 * `isRaceOver`: a winner is final when
 *   * the backend flagged the race as finished, OR
 *   * the snapshot reached the configured yellow & winner end-loop
 *     and that runner finished it within the limit, OR
 *   * the winner's decisive loop is below `snapshotLoop`, meaning some
 *     later loop attempt produced no qualifying finishers (all DNF'd
 *     within the time limit) and the race naturally ended one loop
 *     earlier.
 * Mid-race "current leader" states are *not* final and the trophy
 * is withheld until the race actually decides. */
export function isWinnerFinal(
  winner: WinnerRow | null,
  snapshotLoop: number | null,
  jerseyYellow: number,
  raceFinished: boolean,
): boolean {
  if (raceFinished) return true;
  if (!winner || snapshotLoop === null) return false;
  if (winner.lap >= jerseyYellow) return true;
  return winner.lap < snapshotLoop;
}

/** Compute the single overall winner of the frontyard race, independent
 * of sex: the runner with the fastest lap on the highest loop
 * L ≤ `min(snapshotLoop, jerseyYellow)` that any runner completed
 * within the loop's time limit. Returns `null` when no loop has been
 * completed within the limit yet. */
export function computeOverallWinner(
  yellowEntries: JerseyEntry[],
  jerseyYellow: number,
  snapshotLoop: number | null,
  lockAfter: number,
): WinnerRow | null {
  if (snapshotLoop === null || snapshotLoop < 1) return null;
  const top = Math.min(snapshotLoop, jerseyYellow);
  for (let L = top; L >= 1; L -= 1) {
    const limit = frontyardLoopLengthSec(L, lockAfter);
    type Cand = { e: JerseyEntry; lapSec: number };
    const candidates: Cand[] = [];
    for (const e of yellowEntries) {
      const per = (e.perLoop ?? []).find((p) => p.loop === L);
      const lapSec = per?.lapSec;
      if (typeof lapSec === "number" && lapSec > 0 && lapSec <= limit) {
        candidates.push({ e, lapSec });
      }
    }
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => a.lapSec - b.lapSec);
    const w = candidates[0];
    return {
      bib: w.e.bib,
      name: w.e.name,
      club: w.e.club,
      lap: L,
      lapSec: w.lapSec,
      totalSec: accTimeUpto(w.e, L),
    };
  }
  return null;
}

/** Resolve a runner's sex from supplementary lookup maps. The yellow
 * (and most green) lists publish a sex column, but the pink list does
 * not, so we cross-reference the other lists by bib. */
export function resolveSex(
  entry: JerseyEntry,
  lookup: Map<string, string>,
): string {
  if (entry.sex === "M" || entry.sex === "K") return entry.sex;
  return lookup.get(entry.bib) ?? entry.sex ?? "";
}

/** Build the bib → sex lookup combining the green and yellow lists
 * (the pink list omits sex on most events). */
export function buildSexLookup(payload: JerseysPayload): Map<string, string> {
  const map = new Map<string, string>();
  for (const e of payload.green) {
    if (e.sex === "M" || e.sex === "K") map.set(e.bib, e.sex);
  }
  for (const e of payload.yellow) {
    if (e.sex === "M" || e.sex === "K") map.set(e.bib, e.sex);
  }
  return map;
}

/** Rank entries by accumulated points (descending) up to `cap`, split
 * by sex. Shared between the pink and green jersey standings — both
 * use the same per-loop points model. Ties on total points are broken
 * by the points scored on the snapshot loop itself. */
export function rankByPoints(
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
    out[sex] = ranked.map(({ e, pts }, i) => ({
      rank: i + 1,
      bib: e.bib,
      name: e.name,
      club: e.club,
      value: `${pts} p`,
      rawValue: pts,
    }));
  }
  return out;
}

/** Rank entries by cumulative race time (ascending — fastest first) up
 * to the effective yellow loop, split by sex. Only runners who have
 * completed at least `effectiveLoop` laps are considered. Ties on
 * total time are broken by the lap time on `effectiveLoop` itself. */
export function rankYellow(
  entries: JerseyEntry[],
  sexLookup: Map<string, string>,
  effectiveLoop: number | null,
): Record<Sex, DisplayRow[]> {
  const out: Record<Sex, DisplayRow[]> = { M: [], K: [] };
  for (const sex of ["K", "M"] as Sex[]) {
    const filtered = entries.filter((e) => {
      if (resolveSex(e, sexLookup) !== sex || (e.totalSec ?? 0) <= 0)
        return false;
      if (effectiveLoop !== null) {
        const lapsCompleted =
          typeof e.lapsCompleted === "number" ? e.lapsCompleted : 0;
        if (lapsCompleted < effectiveLoop) return false;
      }
      return true;
    });
    const rankingTime = (e: JerseyEntry): number =>
      effectiveLoop !== null
        ? accTimeUpto(e, effectiveLoop)
        : e.totalSec ?? 0;
    const sorted = [...filtered].sort((a, b) => {
      const ta = rankingTime(a);
      const tb = rankingTime(b);
      if (ta !== tb) return ta - tb;
      const tieLoop =
        effectiveLoop !== null
          ? effectiveLoop
          : Math.max(lastCompletedLoop(a), lastCompletedLoop(b), 1);
      return lapSecAtLoop(a, tieLoop) - lapSecAtLoop(b, tieLoop);
    });
    out[sex] = sorted.map((e, i) => ({
      rank: i + 1,
      bib: e.bib,
      name: e.name,
      club: e.club,
      value: formatHms(rankingTime(e)),
      rawValue: rankingTime(e),
      sub:
        typeof e.lapsCompleted === "number"
          ? `(${
              effectiveLoop !== null
                ? Math.min(e.lapsCompleted, effectiveLoop)
                : e.lapsCompleted
            } loops)`
          : undefined,
    }));
  }
  return out;
}


/** Convenience: the current pink/green/yellow holders per sex at the
 * given snapshot loop, applying each jersey's configured cap. Returns
 * `undefined` for a slot when no runner has any points/time yet. */
export function pickHolders(
  payload: JerseysPayload,
  snapshotLoop: number,
  caps: { pink: number; green: number; yellow: number },
): Record<"pink" | "green" | "yellow", { K?: string; M?: string }> {
  const sexLookup = buildSexLookup(payload);
  const pink = rankByPoints(
    payload.pink,
    sexLookup,
    Math.min(caps.pink, snapshotLoop),
  );
  const green = rankByPoints(
    payload.green,
    sexLookup,
    Math.min(caps.green, snapshotLoop),
  );
  const yellow = rankYellow(
    payload.yellow,
    sexLookup,
    Math.min(caps.yellow, snapshotLoop),
  );
  return {
    pink: { K: pink.K[0]?.bib, M: pink.M[0]?.bib },
    green: { K: green.K[0]?.bib, M: green.M[0]?.bib },
    yellow: { K: yellow.K[0]?.bib, M: yellow.M[0]?.bib },
  };
}
