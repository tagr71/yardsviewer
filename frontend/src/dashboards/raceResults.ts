import { frontyardElapsedAtLoopStart, frontyardState, LOOP_SECONDS, type Mode } from "./timerCore";

export type ResultRow = {
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
  totalSec?: number;
  perLoop?: { loop: number; time: string; lapSec?: number; totalSec?: number }[];
};

export type ResultsResponse = { eventName?: string; raceFinished?: boolean; rows: ResultRow[] };
export type Snapshot = { loop: number; replay: boolean; finished: boolean };
export type RankedRunner = ResultRow & {
  snapshotRank: number;
  snapshotLaps: number;
  snapshotLast: number | null;
  snapshotFastest: number | null;
  snapshotAverage: number | null;
  snapshotTotal: number | null;
};

export function clockCompletedLoops(elapsed: number, mode: Mode, fyLock: number, fyMax: number): number {
  if (elapsed < 0) return 0;
  return mode === "backyard" ? Math.floor(elapsed / LOOP_SECONDS) : frontyardState(elapsed, fyLock, fyMax).loopsCompleted;
}

export function resultsPollDelay(startMs: number | null, nowMs: number, mode: Mode, fyLock: number, fyMax: number): number {
  if (startMs === null || nowMs < startMs) return 10_000;
  const elapsed = (nowMs - startMs) / 1000;
  const loops = clockCompletedLoops(elapsed, mode, fyLock, fyMax);
  const boundary = mode === "backyard" ? loops * LOOP_SECONDS : frontyardElapsedAtLoopStart(loops + 1, fyLock);
  if (loops > 0 && elapsed < boundary + 5) return Math.max(1000, (boundary + 5 - elapsed) * 1000);
  if (mode === "frontyard" && frontyardState(elapsed, fyLock, fyMax).finished) return 10_000;
  const next = mode === "backyard" ? (loops + 1) * LOOP_SECONDS : frontyardElapsedAtLoopStart(loops + 2, fyLock);
  return Math.max(1000, Math.min(10_000, (next + 5 - elapsed) * 1000));
}

export function resultLaps(row: { lapsCompleted?: number | null; perLoop?: ResultRow["perLoop"] }): number {
  if (typeof row.lapsCompleted === "number" && Number.isFinite(row.lapsCompleted) && row.lapsCompleted >= 0) return Math.floor(row.lapsCompleted);
  return (row.perLoop ?? []).reduce((max, lap) => Number.isInteger(lap.loop) && lap.loop > 0 && lapSeconds(lap) !== null ? Math.max(max, lap.loop) : max, 0);
}

export function remainingRunner(
  row: { status?: string; lapsCompleted?: number | null; perLoop?: ResultRow["perLoop"] },
  snapshot: Snapshot,
): boolean {
  if (snapshot.loop === 0) return !/dns/i.test(row.status ?? "");
  if (snapshot.replay || snapshot.finished) return resultLaps(row) >= snapshot.loop;
  return !/dnf|dns|dq|withdrawn/i.test(row.status ?? "");
}

export function lapSeconds(lap: { time?: string; lapSec?: number }): number | null {
  if (typeof lap.lapSec === "number" && Number.isFinite(lap.lapSec) && lap.lapSec > 0) return lap.lapSec;
  const parts = (lap.time ?? "").trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const numbers = parts.map(Number);
  if (numbers.slice(1).some((part) => part >= 60)) return null;
  const seconds = numbers.reduce((total, part) => total * 60 + part, 0);
  return seconds > 0 ? seconds : null;
}

export function publishedLoop(rows: ResultRow[]): number {
  return rows.reduce((max, row) => Math.max(max, resultLaps(row)), 0);
}

export function resultSnapshot(
  rows: ResultRow[], clockLoop: number | null, viewLoop: number | null, finished: boolean,
): Snapshot {
  const maxLoop = publishedLoop(rows);
  return {
    loop: Math.min(maxLoop, Math.max(0, viewLoop ?? (finished ? maxLoop : clockLoop ?? maxLoop))),
    replay: viewLoop !== null,
    finished,
  };
}

export function selectTop15(rows: ResultRow[], snapshot: Snapshot): RankedRunner[] {
  return rows.filter((row) => remainingRunner(row, snapshot)).map((row) => {
    const laps = Math.min(resultLaps(row), snapshot.loop);
    const splits = [...(row.perLoop ?? [])].filter((lap) => lap.loop >= 1 && lap.loop <= laps)
      .sort((first, second) => first.loop - second.loop);
    const times = splits.map(lapSeconds).filter((time): time is number => time !== null);
    const complete = splits.length === laps && times.length === laps && splits.every((lap, index) => lap.loop === index + 1);
    const last = splits.find((lap) => lap.loop === laps);
    const useRow = !snapshot.replay && resultLaps(row) <= snapshot.loop && laps > 0;
    const total = last?.totalSec && last.totalSec > 0 ? last.totalSec
      : complete && times.length ? times.reduce((sum, time) => sum + time, 0)
      : useRow && row.totalSec && row.totalSec > 0 ? row.totalSec : null;
    return {
      ...row, snapshotRank: 0, snapshotLaps: laps,
      snapshotLast: last ? lapSeconds(last) : useRow ? lapSeconds({ time: row.lastLap }) : null,
      snapshotFastest: times.length ? Math.min(...times) : useRow ? lapSeconds({ time: row.fastestLap }) : null,
      snapshotAverage: complete && times.length ? times.reduce((sum, time) => sum + time, 0) / times.length
        : useRow ? lapSeconds({ time: row.averageLap }) : null,
      snapshotTotal: total,
    };
  }).sort((first, second) => {
    if (!snapshot.replay && snapshot.loop > 0) {
      const rankDiff = (first.totalRank && first.totalRank > 0 ? first.totalRank : Infinity)
        - (second.totalRank && second.totalRank > 0 ? second.totalRank : Infinity);
      if (rankDiff && Number.isFinite(rankDiff)) return rankDiff;
      if (first.totalRank && !second.totalRank) return -1;
      if (!first.totalRank && second.totalRank) return 1;
    }
    return second.snapshotLaps - first.snapshotLaps
      || (first.snapshotTotal ?? Infinity) - (second.snapshotTotal ?? Infinity)
      || first.bib.localeCompare(second.bib, undefined, { numeric: true })
      || first.name.localeCompare(second.name);
  }).slice(0, 15).map((row, index) => ({ ...row, snapshotRank: index + 1 }));
}

export function plotData(runners: ResultRow[], loop: number): Record<string, number | null>[] {
  return Array.from({ length: loop }, (_, index) => {
    const point: Record<string, number | null> = { loop: index + 1 };
    for (const runner of runners) {
      const lap = runner.perLoop?.find((entry) => entry.loop === index + 1);
      point[`bib:${runner.bib}`] = lap ? lapSeconds(lap) : null;
    }
    return point;
  });
}

export function runnerColors(bibs: string[], previous: Map<string, number>): Map<string, number> {
  const colors = new Map([...previous].filter(([bib]) => bibs.includes(bib)));
  for (const bib of bibs) {
    if (!colors.has(bib)) {
      const free = Array.from({ length: 15 }, (_, index) => index).find((index) => ![...colors.values()].includes(index));
      if (free !== undefined) colors.set(bib, free);
    }
  }
  return colors;
}

export function lineDash(colorIndex: number): string | undefined {
  return colorIndex < 5 ? undefined : colorIndex < 10 ? "6 3" : "2 3";
}

export function plotLineLabels(runners: ResultRow[], loop: number): { bib: string; loop: number; seconds: number }[] {
  return runners.flatMap((runner) => {
    const laps = (runner.perLoop ?? []).filter((lap) => lap.loop >= 1 && lap.loop <= loop && lapSeconds(lap) !== null);
    const last = laps.sort((first, second) => second.loop - first.loop)[0];
    return last ? [{ bib: runner.bib, loop: last.loop, seconds: lapSeconds(last)! }] : [];
  }).sort((first, second) => second.seconds - first.seconds || first.bib.localeCompare(second.bib, undefined, { numeric: true }));
}

export function plotSignature(runners: ResultRow[], loop: number): string {
  return JSON.stringify({
    loop,
    runners: runners.map(({ bib, name }) => [bib, name]),
    data: plotData(runners, loop),
    labels: plotLineLabels(runners, loop),
  });
}

export function contrastText(color: string): string {
  const components = [1, 3, 5].map((offset) => {
    const channel = parseInt(color.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = components[0] * 0.2126 + components[1] * 0.7152 + components[2] * 0.0722;
  return luminance > 0.179 ? "#000000" : "#ffffff";
}