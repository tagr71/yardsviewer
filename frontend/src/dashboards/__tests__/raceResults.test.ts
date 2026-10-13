import { describe, expect, it } from "vitest";
import { clockCompletedLoops, contrastText, lapSeconds, lineDash, plotData, plotLineLabels, remainingRunner, resultSnapshot, resultsPollDelay, runnerColors, selectTop15, type ResultRow } from "../raceResults";

function runner(bib: number, changes: Partial<ResultRow> = {}): ResultRow {
  return { place: bib, bib: String(bib), name: `Runner ${bib}`, club: "", country: "NOR", sex: "M",
    totalRank: bib, lapsCompleted: 2, lastLap: "20:00", fastestLap: "19:00", slowestLap: "20:00",
    averageLap: "19:30", status: "", gap: "", lapsBehind: 0, total: "39:00", totalSec: 2340,
    perLoop: [{ loop: 1, time: "19:00", lapSec: 1140, totalSec: 1140 },
      { loop: 2, time: "20:00", lapSec: 1200, totalSec: 2340 }], ...changes };
}
const live = { loop: 2, replay: false, finished: false };

describe("top-15 snapshots", () => {
  it("shares dash patterns between traces, connectors and legend", () => {
    expect([0, 4, 5, 9, 10, 14].map(lineDash)).toEqual([undefined, undefined, "6 3", "6 3", "2 3", "2 3"]);
  });
  it("labels the last available plotted point without using future or missing data", () => {
    const rows = [runner(1), runner(2, { perLoop: [{ loop: 1, time: "25:00" }, { loop: 3, time: "30:00" }] }), runner(3, { perLoop: [] })];
    expect(plotLineLabels(rows, 2)).toEqual([{ bib: "2", loop: 1, seconds: 1500 }, { bib: "1", loop: 2, seconds: 1200 }]);
  });
  it("keeps text legible on both dark and light runner-color tags", () => {
    expect(contrastText("#0072b2")).toBe("#ffffff");
    expect(contrastText("#0094a4")).toBe("#000000");
    expect(contrastText("#56b4e9")).toBe("#000000");
  });
  it("advances only at backyard and frontyard loop boundaries", () => {
    expect(clockCompletedLoops(3599, "backyard", 26, 27)).toBe(0);
    expect(clockCompletedLoops(3600, "backyard", 26, 27)).toBe(1);
    expect(clockCompletedLoops(1799, "frontyard", 26, 27)).toBe(0);
    expect(clockCompletedLoops(1800, "frontyard", 26, 27)).toBe(1);
    expect(resultsPollDelay(0, 3602000, "backyard", 26, 27)).toBe(3000);
    expect(resultsPollDelay(0, 1802000, "frontyard", 26, 27)).toBe(3000);
    expect(resultsPollDelay(null, 0, "backyard", 26, 27)).toBe(10000);
  });
  it.each([0, 1, 14, 15, 20])("fits %i available runners", (count) => {
    expect(selectTop15(Array.from({ length: count }, (_, index) => runner(index + 1)), live)).toHaveLength(Math.min(15, count));
  });
  it("uses overall standings instead of fastest last lap", () => {
    expect(selectTop15([runner(1, { lastLap: "29:00" }), runner(2, { lastLap: "10:00" })], live).map((row) => row.bib)).toEqual(["1", "2"]);
  });
  it.each(["DNF", "DNS", "DQ", "withdrawn"])("excludes %s live", (status) => {
    expect(selectTop15([runner(1, { status })], live)).toHaveLength(0);
  });
  it("keeps pre-race DNF placeholders but excludes DNS", () => {
    expect(remainingRunner(runner(1, { status: "DNF" }), { ...live, loop: 0 })).toBe(true);
    expect(remainingRunner(runner(1, { status: "DNS" }), { ...live, loop: 0 })).toBe(false);
  });
  it("replays only finishers of the selected loop and ignores final rank/status", () => {
    const rows = [runner(1, { totalRank: 1, status: "DNF", lapsCompleted: 1 }), runner(2, { totalRank: 2 })];
    expect(selectTop15(rows, { ...live, replay: true }).map((row) => row.bib)).toEqual(["2"]);
    expect(selectTop15([runner(2), runner(1, { status: "DNF" })], { ...live, loop: 1, replay: true })[0].snapshotTotal).toBe(1140);
  });
  it("does not borrow future total time when historical splits are missing", () => {
    expect(selectTop15([runner(1, { perLoop: [] })], { ...live, loop: 1, replay: true })[0].snapshotTotal).toBeNull();
  });
  it("retains final-loop finishers at race end", () => {
    expect(selectTop15([runner(1), runner(2, { status: "DNF", lapsCompleted: 1 })], { ...live, finished: true }).map((row) => row.bib)).toEqual(["1"]);
  });
  it("waits for the completed clock loop and caps at published data", () => {
    expect(resultSnapshot([runner(1)], 1, null, false).loop).toBe(1);
    expect(resultSnapshot([runner(1)], 3, null, false).loop).toBe(2);
    expect(resultSnapshot([runner(1)], null, null, false).loop).toBe(2);
    expect(resultSnapshot([runner(1)], 9, 1, true).loop).toBe(1);
  });
  it("uses published splits when the lap-count field is absent", () => {
    const rows = [runner(1, { lapsCompleted: null })];
    expect(resultSnapshot(rows, null, null, false).loop).toBe(2);
    expect(selectTop15(rows, { ...live, replay: true })[0].snapshotLaps).toBe(2);
    expect(selectTop15(rows, live)[0].snapshotLast).toBe(1200);
  });
  it("plots individual lap seconds with gaps, never cumulative totals or future loops", () => {
    expect(plotData([runner(1)], 1)).toEqual([{ loop: 1, "bib:1": 1140 }]);
    expect(plotData([runner(1, { perLoop: [] })], 1)[0]["bib:1"]).toBeNull();
  });
  it("accepts late split corrections", () => {
    expect(plotData([runner(1, { perLoop: [{ loop: 1, time: "18:00" }] })], 1)[0]["bib:1"]).toBe(1080);
  });
  it.each(["", "DNF", "2:99", "NaN", "0:00"])("rejects invalid time %s", (time) => {
    expect(lapSeconds({ time })).toBeNull();
  });
  it("keeps 15 unique runner colors across reordering and replacements", () => {
    const bibs = Array.from({ length: 15 }, (_, index) => String(index));
    const original = runnerColors(bibs, new Map());
    const next = runnerColors(["new", ...bibs.slice(1).reverse()], original);
    expect(new Set(next.values()).size).toBe(15);
    expect(next.get("1")).toBe(original.get("1"));
    expect(next.get("new")).toBe(original.get("0"));
  });
});