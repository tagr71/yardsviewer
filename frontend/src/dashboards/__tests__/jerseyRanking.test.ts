/**
 * End-to-end test of the jersey ranking pipeline against a fictive race.
 *
 * Setup
 * -----
 * * 20 runners (half K, half M) over 10 loops with a 30-minute mass-start
 *   window. Per-runner per-loop `splitSec` (800 m) and `finishSec` are
 *   produced by the shared deterministic `simulateRace` module so the
 *   exact same fixture is reproducible from a single seed.
 *
 * Expected jersey outcomes are computed twice:
 *
 *   (A) **Direct** — by sorting raw simulated times into per-loop
 *       3/2/1 (pink, by 800m split) and 10/8/6/4/2/1 (green, by lap
 *       finish), then accumulating across loops. This is the
 *       authoritative reference.
 *   (B) **Through the ranking module** — by feeding the synthesized
 *       `JerseysPayload` (the same shape `/api/jerseys` returns) into
 *       `rankByPoints` / `rankYellow` and reading the rank-1 row plus
 *       the top-3 ordering.
 *
 * After each loop k in 1..10 the test asserts (A) ≡ (B) for all six
 * jersey/sex combinations.
 *
 * The CLI script `simulate:jerseys` consumes the same `simulateRace`
 * module, so any seed reproduces identical races in both places.
 */

import { describe, expect, it } from "vitest";
import {
  rankByPoints,
  rankYellow,
  type JerseyEntry,
  type Sex,
} from "../jerseyRanking";
import {
  JERSEY_GREEN_POINTS,
  JERSEY_PINK_POINTS,
  LOOP_WINDOW_SEC,
  simulateRace,
  type LapEvent,
  type PointsByBib,
  type Runner,
} from "../simulateRace";

const NUM_RUNNERS = 20;
const NUM_LOOPS = 10;
const SEED = 12345;

// ---------------------------------------------------------------------------
// (A) Direct reference — recomputed locally from raw events without going
//     through the ranking module.
// ---------------------------------------------------------------------------
function expectedTopByPoints(
  runners: Runner[],
  points: PointsByBib,
  cap: number,
  sex: Sex,
): string[] {
  const rows = runners
    .filter((r) => r.sex === sex)
    .map((r) => {
      let total = 0;
      let atCap = 0;
      const ploops = points.get(r.bib)!;
      for (const [loop, p] of ploops) {
        if (loop <= cap) total += p;
        if (loop === cap) atCap = p;
      }
      return { bib: r.bib, total, atCap };
    })
    .filter((x) => x.total > 0)
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return b.atCap - a.atCap;
    });
  return rows.map((x) => x.bib);
}

function expectedTopByYellow(
  runners: Runner[],
  events: Map<string, LapEvent[]>,
  cap: number,
  sex: Sex,
): string[] {
  return runners
    .filter((r) => r.sex === sex)
    .map((r) => {
      const evs = events.get(r.bib)!;
      const cumSec = evs
        .slice(0, cap)
        .reduce((acc, e) => acc + (e.finishSec - e.loopStartSec), 0);
      const lapAtCap = evs[cap - 1].finishSec - evs[cap - 1].loopStartSec;
      return { bib: r.bib, cumSec, lapAtCap };
    })
    .sort((a, b) => {
      if (a.cumSec !== b.cumSec) return a.cumSec - b.cumSec;
      return a.lapAtCap - b.lapAtCap;
    })
    .map((x) => x.bib);
}

// ---------------------------------------------------------------------------
// Tests — randomised race
// ---------------------------------------------------------------------------
describe("jersey ranking — 20-runner / 10-loop simulation", () => {
  const race = simulateRace({
    numRunners: NUM_RUNNERS,
    numLoops: NUM_LOOPS,
    seed: SEED,
  });
  const { runners, events, pinkPoints, greenPoints, payload, sexLookup } = race;

  it("ladders & window constants are wired correctly", () => {
    expect(JERSEY_PINK_POINTS).toEqual([3, 2, 1]);
    expect(JERSEY_GREEN_POINTS).toEqual([10, 8, 6, 4, 2, 1]);
    expect(LOOP_WINDOW_SEC).toBe(30 * 60);
  });

  it("simulated events respect the 800m-fits-within-loop invariant", () => {
    for (const [, laps] of events) {
      for (const e of laps) {
        expect(e.splitSec).toBeGreaterThan(e.loopStartSec);
        expect(e.splitSec).toBeLessThan(e.finishSec);
        expect(e.finishSec - e.loopStartSec).toBeLessThan(LOOP_WINDOW_SEC);
      }
    }
  });

  for (let cap = 1; cap <= NUM_LOOPS; cap += 1) {
    describe(`after loop ${cap}`, () => {
      for (const sex of ["K", "M"] as Sex[]) {
        it(`pink jersey holder + top-3 (${sex}) match the direct reference`, () => {
          const expected = expectedTopByPoints(runners, pinkPoints, cap, sex);
          const actual = rankByPoints(payload.pink, sexLookup, cap)[sex];
          expect(actual[0]?.bib).toBe(expected[0]);
          expect(actual.slice(0, 3).map((r) => r.bib)).toEqual(
            expected.slice(0, 3),
          );
        });

        it(`green jersey holder + top-3 (${sex}) match the direct reference`, () => {
          const expected = expectedTopByPoints(runners, greenPoints, cap, sex);
          const actual = rankByPoints(payload.green, sexLookup, cap)[sex];
          expect(actual[0]?.bib).toBe(expected[0]);
          expect(actual.slice(0, 3).map((r) => r.bib)).toEqual(
            expected.slice(0, 3),
          );
        });

        it(`yellow jersey holder + top-3 (${sex}) match the direct reference`, () => {
          const expected = expectedTopByYellow(runners, events, cap, sex);
          const actual = rankYellow(payload.yellow, sexLookup, cap)[sex];
          expect(actual[0]?.bib).toBe(expected[0]);
          expect(actual.slice(0, 3).map((r) => r.bib)).toEqual(
            expected.slice(0, 3),
          );
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Dedicated tie-break coverage. The randomised simulation is unlikely to
// produce exact ties on its own, so we construct minimal payloads to
// exercise the two tie-break paths explicitly.
// ---------------------------------------------------------------------------
describe("tie-break paths", () => {
  it("points tie → most points on the snapshot loop wins", () => {
    const sexLookup = new Map<string, string>([
      ["1", "K"],
      ["2", "K"],
    ]);
    const entries: JerseyEntry[] = [
      {
        bib: "1",
        name: "A",
        club: "",
        sex: "K",
        // Total 6 across loops 1+2; loop 2 = 3 points.
        perLoop: [
          { loop: 1, points: 3 },
          { loop: 2, points: 3 },
        ],
      },
      {
        bib: "2",
        name: "B",
        club: "",
        sex: "K",
        // Total 6 across loops 1+2; loop 2 = 5 points → wins tie.
        perLoop: [
          { loop: 1, points: 1 },
          { loop: 2, points: 5 },
        ],
      },
    ];
    const ranking = rankByPoints(entries, sexLookup, 2).K;
    expect(ranking.map((r) => r.bib)).toEqual(["2", "1"]);
  });

  it("yellow time tie → faster lap on the snapshot loop wins", () => {
    const sexLookup = new Map<string, string>([
      ["1", "M"],
      ["2", "M"],
    ]);
    const entries: JerseyEntry[] = [
      {
        bib: "1",
        name: "A",
        club: "",
        sex: "M",
        totalSec: 200,
        lapsCompleted: 2,
        perLoop: [
          { loop: 1, lapSec: 80, totalSec: 80 },
          { loop: 2, lapSec: 120, totalSec: 200 },
        ],
      },
      {
        bib: "2",
        name: "B",
        club: "",
        sex: "M",
        totalSec: 200,
        lapsCompleted: 2,
        perLoop: [
          { loop: 1, lapSec: 110, totalSec: 110 },
          { loop: 2, lapSec: 90, totalSec: 200 },
        ],
      },
    ];
    const ranking = rankYellow(entries, sexLookup, 2).M;
    expect(ranking.map((r) => r.bib)).toEqual(["2", "1"]);
  });
});

