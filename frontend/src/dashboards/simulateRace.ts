/**
 * Deterministic race simulator for the jersey-ranking unit test and the
 * `simulate:jerseys` CLI script.
 *
 * Given a seed and a runner/loop count, this module produces:
 *
 *   * `runners`   — bibs 1..N (women first, then men)
 *   * `events`    — per-runner per-loop `{loopStartSec, splitSec, finishSec}`
 *                   where `splitSec` (the 800 m intermediate) is strictly
 *                   between `loopStartSec` and `finishSec`.
 *   * `pinkPoints` / `greenPoints` — per (bib, loop) point awards using
 *                   the 3/2/1 (pink, by 800 m split) and 10/8/6/4/2/1
 *                   (green, by lap finish) ladders, grouped by sex.
 *   * `payload`   — the synthesized `JerseysPayload` exactly as
 *                   `/api/jerseys` would return it to the frontend.
 *   * `sexLookup` — bib → sex map matching what the dashboards build.
 *
 * The CLI script and the test both consume the same generator so any
 * seed reproduces identical fixture data in both places.
 */

import type { JerseyEntry, JerseysPayload, Sex } from "./jerseyRanking";

// ---------------------------------------------------------------------------
// Deterministic PRNG — Mulberry32. Tiny, fast, repeatable across platforms.
// ---------------------------------------------------------------------------
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Race shape
// ---------------------------------------------------------------------------
/** Mass-start window per loop (also caps every runner's lap time). */
export const LOOP_WINDOW_SEC = 30 * 60;
/** Points awarded for the pink (800 m intermediate) jersey, per sex. */
export const JERSEY_PINK_POINTS: readonly number[] = [3, 2, 1];
/** Points awarded for the green (lap finish) jersey, per sex. */
export const JERSEY_GREEN_POINTS: readonly number[] = [10, 8, 6, 4, 2, 1];

export type Runner = { bib: string; name: string; club: string; sex: Sex };

export type LapEvent = {
  loop: number;
  loopStartSec: number;
  splitSec: number;
  finishSec: number;
};

export type PointsByBib = Map<string, Map<number, number>>;

export type SimulatedRace = {
  runners: Runner[];
  events: Map<string, LapEvent[]>;
  pinkPoints: PointsByBib;
  greenPoints: PointsByBib;
  payload: JerseysPayload;
  sexLookup: Map<string, string>;
  numRunners: number;
  numLoops: number;
  seed: number;
};

export type SimulateOptions = {
  /** Total runner count, split 50/50 K/M. Default 20. */
  numRunners?: number;
  /** Loops to simulate. Default 10. */
  numLoops?: number;
  /** RNG seed. Same seed → same race. Default 42. */
  seed?: number;
};

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------
function buildRunners(numRunners: number): Runner[] {
  const halfK = Math.ceil(numRunners / 2);
  const out: Runner[] = [];
  for (let i = 1; i <= numRunners; i += 1) {
    out.push({
      bib: String(i),
      name: `Runner ${String(i).padStart(2, "0")}`,
      club: `Club ${((i - 1) % 4) + 1}`,
      sex: i <= halfK ? "K" : "M",
    });
  }
  return out;
}

/** Mass-start simulator. Each loop k starts at `(k-1) * LOOP_WINDOW_SEC`.
 * Every runner's finish lands in `[start + 18 min, start + 28 min]` so
 * lap times never spill into the next loop. The 800 m intermediate falls
 * in `[start + 2 min, finish - 30 s]`. Fractional seconds keep ties
 * vanishingly unlikely. */
function simulateEvents(
  runners: Runner[],
  numLoops: number,
  seed: number,
): Map<string, LapEvent[]> {
  const rng = mulberry32(seed);
  const events = new Map<string, LapEvent[]>();
  for (const r of runners) events.set(r.bib, []);
  for (let n = 1; n <= numLoops; n += 1) {
    const loopStartSec = (n - 1) * LOOP_WINDOW_SEC;
    for (const r of runners) {
      const lapSec = 18 * 60 + rng() * (10 * 60);
      const finishSec = loopStartSec + lapSec;
      const minSplit = loopStartSec + 2 * 60;
      const maxSplit = finishSec - 30;
      const splitSec = minSplit + rng() * (maxSplit - minSplit);
      events.get(r.bib)!.push({ loop: n, loopStartSec, splitSec, finishSec });
    }
  }
  return events;
}

/** Award ladder points per (sex, loop) using the supplied per-event
 * metric. Lower metric value = better (faster split / lap). */
function awardPerLoop(
  runners: Runner[],
  events: Map<string, LapEvent[]>,
  numLoops: number,
  metric: (e: LapEvent) => number,
  ladder: readonly number[],
): PointsByBib {
  const out: PointsByBib = new Map();
  for (const r of runners) out.set(r.bib, new Map());
  for (let n = 1; n <= numLoops; n += 1) {
    for (const sex of ["K", "M"] as Sex[]) {
      const ranked = runners
        .filter((r) => r.sex === sex)
        .map((r) => ({ bib: r.bib, value: metric(events.get(r.bib)![n - 1]) }))
        .sort((a, b) => a.value - b.value);
      ranked.forEach((row, i) => {
        if (i < ladder.length) out.get(row.bib)!.set(n, ladder[i]);
      });
    }
  }
  return out;
}

/** Build a `JerseysPayload` mirroring what `/api/jerseys` returns: every
 * runner appears in green/pink with per-loop points and in yellow with
 * per-loop `lapSec` / `totalSec`. */
function buildPayload(
  runners: Runner[],
  events: Map<string, LapEvent[]>,
  numLoops: number,
  pink: PointsByBib,
  green: PointsByBib,
): JerseysPayload {
  const mkEntry = (
    r: Runner,
    perLoop: {
      loop: number;
      points?: number;
      lapSec?: number;
      totalSec?: number;
    }[],
    points?: number,
    totalSec?: number,
  ): JerseyEntry => ({
    bib: r.bib,
    name: r.name,
    club: r.club,
    sex: r.sex,
    points,
    perLoop,
    totalSec,
    lapsCompleted: numLoops,
  });
  const pinkEntries = runners.map((r) => {
    const perLoop = Array.from(pink.get(r.bib)!.entries())
      .map(([loop, points]) => ({ loop, points }))
      .sort((a, b) => a.loop - b.loop);
    return mkEntry(
      r,
      perLoop,
      perLoop.reduce((s, p) => s + p.points, 0),
    );
  });
  const greenEntries = runners.map((r) => {
    const perLoop = Array.from(green.get(r.bib)!.entries())
      .map(([loop, points]) => ({ loop, points }))
      .sort((a, b) => a.loop - b.loop);
    return mkEntry(
      r,
      perLoop,
      perLoop.reduce((s, p) => s + p.points, 0),
    );
  });
  const yellowEntries = runners.map((r) => {
    const evs = events.get(r.bib)!;
    let cum = 0;
    const perLoop = evs.map((e) => {
      const lapSec = e.finishSec - e.loopStartSec;
      cum += lapSec;
      return { loop: e.loop, lapSec, totalSec: cum };
    });
    return mkEntry(r, perLoop, undefined, cum);
  });
  return {
    eventName: "Fictive Frontyard Race",
    raceFinished: true,
    pink: pinkEntries,
    green: greenEntries,
    yellow: yellowEntries,
  };
}

/** Run the full simulation and return everything needed by the test or
 * the CLI. Pure function: identical seed/runners/loops → identical output. */
export function simulateRace(options: SimulateOptions = {}): SimulatedRace {
  const numRunners = options.numRunners ?? 20;
  const numLoops = options.numLoops ?? 10;
  const seed = options.seed ?? 42;
  const runners = buildRunners(numRunners);
  const events = simulateEvents(runners, numLoops, seed);
  const pinkPoints = awardPerLoop(
    runners,
    events,
    numLoops,
    (e) => e.splitSec,
    JERSEY_PINK_POINTS,
  );
  const greenPoints = awardPerLoop(
    runners,
    events,
    numLoops,
    (e) => e.finishSec - e.loopStartSec,
    JERSEY_GREEN_POINTS,
  );
  const payload = buildPayload(runners, events, numLoops, pinkPoints, greenPoints);
  const sexLookup = new Map<string, string>(runners.map((r) => [r.bib, r.sex]));
  return {
    runners,
    events,
    pinkPoints,
    greenPoints,
    payload,
    sexLookup,
    numRunners,
    numLoops,
    seed,
  };
}
