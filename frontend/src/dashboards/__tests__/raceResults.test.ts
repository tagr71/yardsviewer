import { afterEach, describe, expect, it, vi } from "vitest";
import { clockCompletedLoops, collectLiveSplits, contrastText, lapSeconds, lineDash, plotData, plotLineLabels, plotSignature, readLiveSplits, remainingRunner, resultSnapshot, resultsPollDelay, runnerColors, saveLiveSplits, selectTop15, type ResultRow } from "../raceResults";

function runner(bib: number, changes: Partial<ResultRow> = {}): ResultRow {
  return { place: bib, bib: String(bib), name: `Runner ${bib}`, club: "", country: "NOR", sex: "M",
    totalRank: bib, lapsCompleted: 2, lastLap: "20:00", fastestLap: "19:00", slowestLap: "20:00",
    averageLap: "19:30", status: "", gap: "", lapsBehind: 0, total: "39:00", totalSec: 2340,
    perLoop: [{ loop: 1, time: "19:00", lapSec: 1140, totalSec: 1140 },
      { loop: 2, time: "20:00", lapSec: 1200, totalSec: 2340 }], ...changes };
}
const live = { loop: 2, replay: false, finished: false };

afterEach(() => vi.unstubAllGlobals());

describe("live split recording", () => {
  it("records only the observed last lap and leaves earlier loops empty", () => {
    const result = collectLiveSplits([runner(1, { perLoop: undefined })]);
    expect(result.rows[0].perLoop).toEqual([{ loop: 2, time: "20:00", lapSec: 1200, totalSec: 2340 }]);
    expect(plotData(result.rows, 2)).toEqual([{ loop: 1, "bib:1": null }, { loop: 2, "bib:1": 1200 }]);
  });
  it("keeps observed laps across polls without filling missed loops", () => {
    const first = collectLiveSplits([runner(1, { perLoop: undefined })]);
    const next = collectLiveSplits([runner(1, { lapsCompleted: 4, lastLap: "22:00", totalSec: 4800, perLoop: [] })], first.history);
    expect(next.rows[0].perLoop?.map((split) => split.loop)).toEqual([2, 4]);
    expect(plotData(next.rows, 4).map((point) => point["bib:1"])).toEqual([null, 1200, null, 1320]);
    expect(first.history.get("1")).toHaveLength(1);
  });
  it("accepts corrections without duplicating a recorded loop", () => {
    const first = collectLiveSplits([runner(1, { perLoop: [] })]);
    const corrected = collectLiveSplits([runner(1, { lastLap: "21:00", totalSec: 2400, perLoop: [] })], first.history);
    expect(corrected.rows[0].perLoop).toEqual([{ loop: 2, time: "21:00", lapSec: 1260, totalSec: 2400 }]);
  });
  it("prefers published Details splits over the last-lap fallback", () => {
    const first = collectLiveSplits([runner(1, { perLoop: [] })]);
    const published = collectLiveSplits([runner(1, { lastLap: "25:00" })], first.history);
    expect(published.rows[0].perLoop).toEqual(runner(1).perLoop);
  });
  it("applies the same validation to cached and published splits", () => {
    const invalid = [{ loop: 1, time: "20:00", lapSec: -1 }, { loop: 2, time: "20:00", totalSec: -1 }];
    const rows = [runner(1, { lastLap: "", perLoop: invalid })];
    const result = collectLiveSplits(rows, new Map([["1", invalid]]));
    expect(result.history.size).toBe(0);
    expect(result.rows[0].perLoop).toEqual([]);
  });
  it.each([null, 0, -1, 1.5, NaN])("does not associate a last lap with invalid or zero count %s", (lapsCompleted) => {
    expect(collectLiveSplits([runner(1, { lapsCompleted, perLoop: undefined })]).history.size).toBe(0);
  });
  it.each(["", "DNF", "2:99", "0:00"])("does not record an invalid last lap %s", (lastLap) => {
    expect(collectLiveSplits([runner(1, { lastLap, perLoop: undefined })]).history.size).toBe(0);
  });
  it("preserves observations when a later response omits the last-lap value", () => {
    const first = collectLiveSplits([runner(1, { perLoop: [] })]);
    const missing = collectLiveSplits([runner(1, { lastLap: "", perLoop: [] })], first.history);
    expect(missing.rows[0].perLoop).toEqual(first.rows[0].perLoop);
    expect(collectLiveSplits([], first.history).history.get("1")).toEqual(first.rows[0].perLoop);
  });
  it("drops recorded future laps if the published completed count is corrected", () => {
    const first = collectLiveSplits([runner(1)]);
    const corrected = collectLiveSplits([runner(1, { lapsCompleted: 1, lastLap: "19:00", totalSec: 1140, perLoop: [] })], first.history);
    expect(corrected.rows[0].perLoop?.map((split) => split.loop)).toEqual([1]);
  });
  it("records all runners rather than only the current top fifteen", () => {
    expect(collectLiveSplits(Array.from({ length: 20 }, (_, index) => runner(index + 1, { perLoop: [] }))).history.size).toBe(20);
  });
  it("does not infer an accumulated time or average from incomplete recorded history", () => {
    const result = collectLiveSplits([runner(1, { perLoop: [], totalSec: 0 })]);
    const snapshot = selectTop15(result.rows, { ...live, replay: true })[0];
    expect(snapshot.snapshotTotal).toBeNull();
    expect(snapshot.snapshotAverage).toBeNull();
  });
});

describe("live split storage", () => {
  it("restores observations after reload and separates event IDs and start times", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } });
    const first = collectLiveSplits([runner(1, { perLoop: [] })]);
    saveLiveSplits("361312", 1000, first.history);
    expect(readLiveSplits("361312", 1000)).toEqual(first.history);
    expect(readLiveSplits("423509", 1000).size).toBe(0);
    expect(readLiveSplits("361312", 2000).size).toBe(0);
    expect(readLiveSplits("361312", null).size).toBe(0);
    const next = collectLiveSplits([runner(1, { lapsCompleted: 3, lastLap: "21:00", perLoop: [] })], readLiveSplits("361312", 1000));
    expect(next.rows[0].perLoop?.map((split) => split.loop)).toEqual([2, 3]);
    expect([...values.values()].join(" ")).not.toContain("Runner");
  });
  it("does not rewrite unchanged history", () => {
    let stored: string | null = null;
    const setItem = vi.fn((_key: string, value: string) => { stored = value; });
    vi.stubGlobal("window", { localStorage: { getItem: () => stored, setItem } });
    const history = collectLiveSplits([runner(1)]).history;
    saveLiveSplits("361312", null, history);
    saveLiveSplits("361312", null, history);
    expect(setItem).toHaveBeenCalledTimes(1);
  });
  it.each(["invalid", "null", "{}", '[null, [1, []], ["1", null]]'])("ignores malformed storage %s", (stored) => {
    vi.stubGlobal("window", { localStorage: { getItem: () => stored } });
    expect(readLiveSplits("361312", null).size).toBe(0);
  });
  it("validates stored loop numbers, time values and optional numeric fields", () => {
    const stored = JSON.stringify([["1", [null, { loop: 0, time: "20:00" }, { loop: 1, time: null },
      { loop: 1.5, time: "20:00" }, { loop: 1, time: "DNF" }, { loop: 1, time: "20:00", lapSec: "1200" },
      { loop: 1, time: "20:00", totalSec: "1200" }, { loop: 2, time: "20:00" }]]]);
    vi.stubGlobal("window", { localStorage: { getItem: () => stored } });
    expect(readLiveSplits("361312", null).get("1")).toEqual([{ loop: 2, time: "20:00" }]);
  });
  it("continues without persistence when storage is unavailable", () => {
    vi.stubGlobal("window", { localStorage: {
      getItem: () => { throw new Error("Storage disabled"); },
      setItem: () => { throw new Error("Storage disabled"); },
    } });
    const first = collectLiveSplits([runner(1, { perLoop: [] })], readLiveSplits("361312", null));
    expect(() => saveLiveSplits("361312", null, first.history)).not.toThrow();
    const next = collectLiveSplits([runner(1, { lapsCompleted: 3, perLoop: [] })], first.history);
    expect(next.rows[0].perLoop?.map((split) => split.loop)).toEqual([2, 3]);
  });
});

describe("top-15 snapshots", () => {
  it("keeps the plot signature stable across unchanged polls and unrelated metadata changes", () => {
    const original = runner(1);
    const refreshed = runner(1, { club: "Updated club", totalRank: 2, status: "DNF", totalSec: 2400 });
    expect(plotSignature([refreshed], 2)).toBe(plotSignature([original], 2));
  });
  it("updates the plot signature for corrected splits", () => {
    const corrected = runner(1, { perLoop: [{ loop: 1, time: "18:00", lapSec: 1080 }] });
    expect(plotSignature([corrected], 2)).not.toBe(plotSignature([runner(1)], 2));
  });
  it("updates the plot signature for names, membership, order and selected loop", () => {
    const original = [runner(1), runner(2)];
    const signature = plotSignature(original, 2);
    expect(plotSignature([runner(1, { name: "Updated name" }), runner(2)], 2)).not.toBe(signature);
    expect(plotSignature([runner(1)], 2)).not.toBe(signature);
    expect(plotSignature([...original].reverse(), 2)).not.toBe(signature);
    expect(plotSignature(original, 1)).not.toBe(signature);
  });
  it("ignores future splits in the plot signature until their loop is selected", () => {
    const original = runner(1);
    const future = runner(1, { perLoop: [...original.perLoop!, { loop: 3, time: "21:00", lapSec: 1260 }] });
    expect(plotSignature([future], 2)).toBe(plotSignature([original], 2));
    expect(plotSignature([future], 3)).not.toBe(plotSignature([original], 3));
  });
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