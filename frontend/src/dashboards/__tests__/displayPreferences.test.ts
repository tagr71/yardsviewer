import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTOMATIC_THEME_KEY, initialTheme, norwegianThemeAt, readPreference, THEME_KEY } from "../../theme";

afterEach(() => vi.unstubAllGlobals());
describe("display preferences", () => {
  it.each([
    ["2026-06-10T06:00:00Z", "day"],
    ["2026-06-10T15:00:00Z", "night"],
  ])("defaults to the Norwegian schedule without storage at %s", (instant, theme) => {
    expect(initialTheme(new Date(instant))).toBe(theme);
  });
  it.each([null, "true", "false", '"true"', "invalid"])("validates automatic preference %s", (raw) => {
    vi.stubGlobal("window", {
      localStorage: { getItem: (key: string) => key === AUTOMATIC_THEME_KEY ? raw : '"day"' },
    });
    expect(initialTheme(new Date("2026-06-10T15:00:00Z"))).toBe(raw === "false" ? "day" : "night");
  });
  it.each(['"night"', '"day"', '"unknown"', 'invalid'])("validates stored theme %s", (raw) => {
    vi.stubGlobal("window", {
      localStorage: { getItem: vi.fn((key: string) => key === AUTOMATIC_THEME_KEY ? "false" : raw) },
    });
    expect(initialTheme()).toBe(raw === '"night"' ? "night" : "day");
    expect(window.localStorage.getItem).toHaveBeenCalledWith(THEME_KEY);
  });
  it("defaults participant info and the Leaderboard plot to On", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => null } });
    expect(readPreference("view", true, (value): value is boolean => typeof value === "boolean")).toBe(true);
  });
  it.each([null, "invalid", '"true"'])("defaults Dashboard top-15 to Off for %s", (raw) => {
    vi.stubGlobal("window", { localStorage: { getItem: () => raw } });
    expect(readPreference("raceresult.dashboard.showTop15", false, (value): value is boolean => typeof value === "boolean")).toBe(false);
  });
  it("preserves a saved Dashboard top-15 On choice", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => "true" } });
    expect(readPreference("raceresult.dashboard.showTop15", false, (value): value is boolean => typeof value === "boolean")).toBe(true);
  });
  it.each([null, "true", "false"])("defaults cumulative loops to On and preserves saved choice %s", (raw) => {
    vi.stubGlobal("window", { localStorage: { getItem: () => raw } });
    expect(readPreference("raceresult.leaderboard.showCumulativeLoops", true, (value): value is boolean => typeof value === "boolean")).toBe(raw !== "false");
  });
  it("restores an explicit Off", () => {
    vi.stubGlobal("window", { localStorage: { getItem: () => "false" } });
    expect(readPreference("view", true, (value): value is boolean => typeof value === "boolean")).toBe(false);
  });
  it.each([
    ["2026-06-10T05:59:59Z", "night"],
    ["2026-06-10T06:00:00Z", "day"],
    ["2026-06-10T14:59:59Z", "day"],
    ["2026-06-10T15:00:00Z", "night"],
    ["2026-01-10T06:59:59Z", "night"],
    ["2026-01-10T07:00:00Z", "day"],
    ["2026-01-10T15:59:59Z", "day"],
    ["2026-01-10T16:00:00Z", "night"],
    ["2026-03-29T06:00:00Z", "day"],
    ["2026-10-25T07:00:00Z", "day"],
    ["2026-06-10T22:00:00Z", "night"],
  ])("uses Norwegian time at %s", (instant, theme) => {
    expect(norwegianThemeAt(new Date(instant))).toBe(theme);
  });
  it("automatic mode overrides, but does not erase, the manual choice", () => {
    const values: Record<string, string> = { [AUTOMATIC_THEME_KEY]: "true", [THEME_KEY]: '"day"' };
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => values[key] ?? null } });
    expect(initialTheme(new Date("2026-06-10T15:00:00Z"))).toBe("night");
    values[AUTOMATIC_THEME_KEY] = "false";
    expect(initialTheme(new Date("2026-06-10T15:00:00Z"))).toBe("day");
  });
});