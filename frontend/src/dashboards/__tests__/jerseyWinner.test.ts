/**
 * Unit tests for the overall-winner pure helpers:
 *   - `frontyardLoopLengthSec` — per-loop time-limit table.
 *   - `isRaceOver` — broad "race over" predicate used for gating UI.
 *   - `computeOverallWinner` — sex-independent winner selection:
 *       * Search loops L = min(snapshotLoop, jerseyYellow) downward to 1.
 *       * A runner "counts" on loop L only if their `lapSec` on L is
 *         > 0 and ≤ that loop's time limit.
 *       * Among counting runners, the smallest `lapSec` on L wins.
 *       * If nobody counts on the top loop (e.g. solo timeout), fall
 *         back to L−1, and so on.
 *   - `isWinnerFinal` — strict version of `isRaceOver`: the trophy is
 *       only awarded once the race is actually decided (end-loop
 *       reached, race-finished flag set, or a later loop attempt
 *       produced no qualifying finishers).
 *
 * Loop length:
 *   * Loop 1 = 30 min, each subsequent loop −1 min, until `lockAfter`
 *     where the length stays constant for all later loops.
 */

import { describe, expect, it } from "vitest";
import {
  computeOverallWinner,
  frontyardLoopLengthSec,
  isRaceOver,
  isWinnerFinal,
  type JerseyEntry,
  type WinnerRow,
} from "../jerseyRanking";

const entry = (
  bib: string,
  sex: "M" | "K",
  perLoop: { loop: number; lapSec: number; totalSec?: number }[],
): JerseyEntry => ({
  bib,
  name: `R${bib}`,
  club: "C",
  sex,
  perLoop: perLoop.map((p) => ({
    loop: p.loop,
    lapSec: p.lapSec,
    totalSec: p.totalSec ?? 0,
  })),
});

describe("frontyardLoopLengthSec", () => {
  it("loop 1 is 30 minutes", () => {
    expect(frontyardLoopLengthSec(1, 17)).toBe(30 * 60);
  });
  it("loop N shrinks by 1 min per loop up to lockAfter", () => {
    expect(frontyardLoopLengthSec(2, 17)).toBe(29 * 60);
    expect(frontyardLoopLengthSec(17, 17)).toBe(14 * 60);
  });
  it("after lockAfter the length holds constant", () => {
    expect(frontyardLoopLengthSec(18, 17)).toBe(14 * 60);
    expect(frontyardLoopLengthSec(27, 17)).toBe(14 * 60);
  });
  it("respects custom lockAfter", () => {
    expect(frontyardLoopLengthSec(10, 10)).toBe(21 * 60);
    expect(frontyardLoopLengthSec(20, 10)).toBe(21 * 60);
  });
  it("never returns less than 60 seconds", () => {
    expect(frontyardLoopLengthSec(100, 100)).toBeGreaterThanOrEqual(60);
  });
});

describe("isRaceOver", () => {
  it("returns true when raceFinished is true (regardless of snapshot)", () => {
    expect(isRaceOver(true, null, 27)).toBe(true);
    expect(isRaceOver(true, 0, 27)).toBe(true);
    expect(isRaceOver(true, 5, 27)).toBe(true);
  });
  it("returns false when snapshotLoop is null and race is not finished", () => {
    expect(isRaceOver(false, null, 27)).toBe(false);
  });
  it("returns false when snapshotLoop is below jerseyYellow", () => {
    expect(isRaceOver(false, 26, 27)).toBe(false);
    expect(isRaceOver(false, 1, 27)).toBe(false);
  });
  it("returns true when snapshotLoop reaches jerseyYellow", () => {
    expect(isRaceOver(false, 27, 27)).toBe(true);
  });
  it("returns true when snapshotLoop is past jerseyYellow", () => {
    expect(isRaceOver(false, 30, 27)).toBe(true);
  });
});

describe("computeOverallWinner — basic selection", () => {
  it("returns null when snapshotLoop is null", () => {
    const w = computeOverallWinner(
      [entry("1", "M", [{ loop: 1, lapSec: 60 }])],
      27,
      null,
      17,
    );
    expect(w).toBeNull();
  });

  it("returns null when snapshotLoop < 1", () => {
    expect(
      computeOverallWinner([entry("1", "M", [])], 27, 0, 17),
    ).toBeNull();
  });

  it("returns null when nobody has any completed loop within the limit", () => {
    const w = computeOverallWinner([], 27, 5, 17);
    expect(w).toBeNull();
  });

  it("picks the runner with the fastest lap on the highest reached loop", () => {
    const yellow = [
      entry("1", "M", [
        { loop: 1, lapSec: 1500 },
        { loop: 2, lapSec: 1400 },
      ]),
      entry("2", "K", [
        { loop: 1, lapSec: 1400 },
        { loop: 2, lapSec: 1300 },
      ]),
    ];
    const w = computeOverallWinner(yellow, 27, 2, 17);
    // Sex-independent: the K runner wins on loop 2.
    expect(w?.bib).toBe("2");
    expect(w?.lap).toBe(2);
    expect(w?.lapSec).toBe(1300);
  });

  it("caps the search at jerseyYellow even if snapshotLoop is larger", () => {
    const yellow = [
      entry("1", "M", [
        { loop: 1, lapSec: 1500 },
        { loop: 2, lapSec: 1400 },
        { loop: 3, lapSec: 1300 },
      ]),
    ];
    const w = computeOverallWinner(yellow, 2, 5, 17);
    expect(w?.lap).toBe(2);
    expect(w?.lapSec).toBe(1400);
  });
});

describe("computeOverallWinner — time-limit enforcement", () => {
  it("excludes runners whose lap exceeded the loop limit", () => {
    // Loop 2 limit = 29 min = 1740s.
    const yellow = [
      entry("1", "M", [{ loop: 1, lapSec: 1500 }, { loop: 2, lapSec: 1800 }]),
      entry("2", "M", [{ loop: 1, lapSec: 1600 }, { loop: 2, lapSec: 1700 }]),
    ];
    const w = computeOverallWinner(yellow, 27, 2, 17);
    expect(w?.bib).toBe("2");
    expect(w?.lap).toBe(2);
  });

  it("falls back to the previous loop when the solo runner times out", () => {
    // Loop 3 limit = 28 min = 1680s; runner takes 1700s → timeout.
    const yellow = [
      entry("1", "M", [
        { loop: 1, lapSec: 1500 },
        { loop: 2, lapSec: 1600 },
        { loop: 3, lapSec: 1700 },
      ]),
    ];
    const w = computeOverallWinner(yellow, 27, 3, 17);
    expect(w?.bib).toBe("1");
    expect(w?.lap).toBe(2);
    expect(w?.lapSec).toBe(1600);
  });

  it("excludes laps with lapSec <= 0 (DNF / no time recorded)", () => {
    const yellow = [
      entry("1", "M", [{ loop: 1, lapSec: 1500 }, { loop: 2, lapSec: 0 }]),
      entry("2", "M", [{ loop: 1, lapSec: 1600 }]),
    ];
    const w = computeOverallWinner(yellow, 27, 2, 17);
    expect(w?.bib).toBe("1");
    expect(w?.lap).toBe(1);
    expect(w?.lapSec).toBe(1500);
  });

  it("respects lockAfter when checking the time limit", () => {
    // With lockAfter=10, loop 20 limit = 21 min = 1260s.
    const yellow = [
      entry("1", "M", Array.from({ length: 20 }, (_, i) => ({
        loop: i + 1,
        lapSec: 1200,
        totalSec: (i + 1) * 1200,
      }))),
    ];
    const w = computeOverallWinner(yellow, 27, 20, 10);
    expect(w?.lap).toBe(20);
    expect(w?.lapSec).toBe(1200);
  });

  it("falls back when the runner exceeds the locked limit on a late loop", () => {
    const yellow = [
      entry("1", "M", [
        { loop: 19, lapSec: 1200, totalSec: 19 * 1200 },
        { loop: 20, lapSec: 1300, totalSec: 19 * 1200 + 1300 },
      ]),
    ];
    const w = computeOverallWinner(yellow, 27, 20, 10);
    expect(w?.lap).toBe(19);
    expect(w?.lapSec).toBe(1200);
  });
});

describe("computeOverallWinner — output payload", () => {
  it("returns bib, name, club, lap, lapSec and totalSec from the winning loop", () => {
    const yellow = [
      entry("1", "M", [
        { loop: 1, lapSec: 1500, totalSec: 1500 },
        { loop: 2, lapSec: 1400, totalSec: 2900 },
      ]),
    ];
    const w = computeOverallWinner(yellow, 27, 2, 17);
    expect(w).toEqual({
      bib: "1",
      name: "R1",
      club: "C",
      lap: 2,
      lapSec: 1400,
      totalSec: 2900,
    });
  });
});

describe("isWinnerFinal", () => {
  const w = (lap: number): WinnerRow => ({
    bib: "1",
    name: "R1",
    club: "C",
    lap,
    lapSec: 1200,
    totalSec: lap * 1200,
  });

  it("returns true when raceFinished is set (even with no winner)", () => {
    expect(isWinnerFinal(null, 5, 27, true)).toBe(true);
  });

  it("returns false when no winner is provided", () => {
    expect(isWinnerFinal(null, 5, 27, false)).toBe(false);
  });

  it("returns false when snapshotLoop is null", () => {
    expect(isWinnerFinal(w(5), null, 27, false)).toBe(false);
  });

  it("returns true when the winning loop reaches the configured end-loop", () => {
    expect(isWinnerFinal(w(27), 27, 27, false)).toBe(true);
  });

  it("returns true when winner.lap < snapshotLoop (later loop produced no finishers)", () => {
    // The race naturally ended on loop 6 because everyone DNF'd; the
    // last decided loop is 5.
    expect(isWinnerFinal(w(5), 6, 27, false)).toBe(true);
  });

  it("returns false while the race is mid-way and the leader is still in", () => {
    // snapshot 5, winner decided on 5, end-loop 27 → race could still
    // continue, leader is provisional.
    expect(isWinnerFinal(w(5), 5, 27, false)).toBe(false);
  });
});
