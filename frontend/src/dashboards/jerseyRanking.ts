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
  sub?: string;
  jerseys?: ("pink" | "green" | "yellow")[];
};

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
