import { useEffect, useState } from "react";
import type React from "react";

export const OSLO_TZ = "Europe/Oslo";
export const LOOP_SECONDS = 60 * 60; // 60 minutes per loop in Backyard mode
export const FRONTYARD_START_MIN = 30; // first loop in Frontyard mode is 30 minutes
export const FRONTYARD_LOCK_DEFAULT = 17;
export const FRONTYARD_MAX_DEFAULT = 27;
export const FRONTYARD_LOCK_MIN = 1;
export const FRONTYARD_LOCK_MAX = 26;
export const FRONTYARD_MAX_CAP = 27;
export const JERSEY_PINK_DEFAULT = 10;
export const JERSEY_GREEN_DEFAULT = 15;
export const JERSEY_YELLOW_DEFAULT = 27;
export const BACKYARD_LOOP_KM = 6.706;
export const FRONTYARD_LOOP_KM = 3;

export type Mode = "backyard" | "frontyard";

/** Frontyard: loops shrink 30, 29, ..., until loop `lockAfter` whose length
 * is reused for every later loop. The race ends after `maxLoops` loops. */
export function frontyardState(
  elapsedSec: number,
  lockAfter: number,
  maxLoops: number,
): {
  loopsCompleted: number;
  loopNumber: number;
  loopLengthMin: number;
  remainingSec: number;
  finished: boolean;
} {
  const lockedLen = Math.max(1, FRONTYARD_START_MIN + 1 - lockAfter);
  let loopsCompleted = 0;
  let loopStart = 0;
  for (let k = 1; k <= maxLoops; k += 1) {
    const naturalLen = Math.max(1, FRONTYARD_START_MIN + 1 - k);
    const len = k <= lockAfter ? naturalLen : lockedLen;
    const loopEnd = loopStart + len * 60;
    if (elapsedSec < loopEnd) {
      return {
        loopsCompleted,
        loopNumber: k,
        loopLengthMin: len,
        remainingSec: loopEnd - elapsedSec,
        finished: false,
      };
    }
    loopsCompleted += 1;
    loopStart = loopEnd;
  }
  return {
    loopsCompleted,
    loopNumber: maxLoops,
    loopLengthMin: 0,
    remainingSec: 0,
    finished: true,
  };
}

export function startTimeKey(eventId: string) {
  return `raceresult.startTime.${eventId}`;
}
export function modeKey(eventId: string) {
  return `raceresult.timerMode.${eventId}`;
}
export function lockKey(eventId: string) {
  return `raceresult.timerFrontyardLock.${eventId}`;
}
export function maxLoopsKey(eventId: string) {
  return `raceresult.timerFrontyardMax.${eventId}`;
}
export function beepKey(eventId: string) {
  return `raceresult.timerBeep.${eventId}`;
}
export function locationKey(eventId: string) {
  return `raceresult.eventLocation.${eventId}`;
}
export function jerseyPinkKey(eventId: string) {
  return `raceresult.jerseyPink.${eventId}`;
}
export function jerseyGreenKey(eventId: string) {
  return `raceresult.jerseyGreen.${eventId}`;
}
export function jerseyYellowKey(eventId: string) {
  return `raceresult.jerseyYellow.${eventId}`;
}
export function viewLoopKey(eventId: string) {
  return `raceresult.viewLoop.${eventId}`;
}

/** Cumulative seconds from race start to the START of loop `loopNumber` in
 * frontyard mode (1-indexed). Loop 1 starts at 0 s. */
export function frontyardElapsedAtLoopStart(
  loopNumber: number,
  lockAfter: number,
): number {
  const lockedLen = Math.max(1, FRONTYARD_START_MIN + 1 - lockAfter);
  let total = 0;
  for (let k = 1; k < loopNumber; k += 1) {
    const naturalLen = Math.max(1, FRONTYARD_START_MIN + 1 - k);
    const len = k <= lockAfter ? naturalLen : lockedLen;
    total += len * 60;
  }
  return total;
}

/** Cross-tab-synced viewed-loop state. `null` means "live" (no override).
 * Persisted in localStorage so the leaderboard tab sees the same value. */
export function useViewLoop(eventId: string): {
  viewLoop: number | null;
  setViewLoop: (next: number | null) => void;
} {
  const read = () => {
    const raw = localStorage.getItem(viewLoopKey(eventId));
    if (raw === null) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 1 ? n : null;
  };
  const [viewLoop, setLocal] = useState<number | null>(read);
  useEffect(() => {
    setLocal(read());
    function onStorage(e: StorageEvent) {
      if (e.key === viewLoopKey(eventId)) setLocal(read());
    }
    window.addEventListener("storage", onStorage);
    const poll = window.setInterval(() => setLocal(read()), 2000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);
  function setViewLoop(next: number | null) {
    if (next === null) localStorage.removeItem(viewLoopKey(eventId));
    else localStorage.setItem(viewLoopKey(eventId), String(next));
    setLocal(next);
  }
  return { viewLoop, setViewLoop };
}

function readIntSetting(key: string, fallback: number): number {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function pad(n: number) {
  return n.toString().padStart(2, "0");
}

export function formatDuration(totalMs: number): { signedDays: number; hms: string } {
  const sign = totalMs < 0 ? -1 : 1;
  // For elapsed (positive) use floor: seconds completed.
  // For countdown (negative) use ceil: seconds remaining, so the user sees
  // "...3, 2, 1, 0" reaching :00 exactly at the start instant rather than
  // half a second early.
  const absMs = Math.abs(totalMs);
  const totalSeconds = totalMs < 0
    ? Math.ceil(absMs / 1000)
    : Math.floor(absMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return {
    signedDays: sign * days,
    hms: `${pad(hours)}.${pad(minutes)}.${pad(seconds)}`,
  };
}

export function formatKm(km: number): string {
  return `${km.toFixed(1)} km`;
}

/** Format a non-negative seconds count as ``H:MM:SS`` (drops the hour
 * when zero, so short laps render as ``MM:SS``). */
export function formatHms(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = pad(m);
  const ss = pad(r);
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Shared button style used by the per-loop replay scrubber in every
 * dashboard (Leaderboard, Jerseys, Dashboard). */
export const playbackBtn: React.CSSProperties = {
  padding: "0.3rem 0.6rem",
  fontSize: "1rem",
  border: "1px solid #ccc",
  borderRadius: "0.3rem",
  background: "white",
  cursor: "pointer",
};

function osloOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: OSLO_TZ,
    timeZoneName: "shortOffset",
  }).formatToParts(instant);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
  const m = tz.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
  if (!m) return 60;
  const h = parseInt(m[1], 10);
  const mm = m[2] ? parseInt(m[2], 10) : 0;
  const sign = h < 0 ? -1 : 1;
  return h * 60 + sign * mm;
}

/** Interpret a `datetime-local` value as Oslo wall-clock time and return
 * the corresponding UTC instant. */
export function osloWallClockToInstant(value: string): Date | null {
  if (!value) return null;
  const m = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const utcGuess = Date.UTC(
    parseInt(y, 10),
    parseInt(mo, 10) - 1,
    parseInt(d, 10),
    parseInt(h, 10),
    parseInt(mi, 10),
    s ? parseInt(s, 10) : 0,
  );
  const off1 = osloOffsetMinutes(new Date(utcGuess));
  const instant1 = utcGuess - off1 * 60 * 1000;
  const off2 = osloOffsetMinutes(new Date(instant1));
  return new Date(utcGuess - off2 * 60 * 1000);
}

export function formatOslo(instant: Date): string {
  const { date, time } = formatOsloParts(instant);
  return `${date} ${time}`;
}

/** Format an instant in Oslo as { date: "yyyy-mm-dd", time: "HH.mm.ss" }. */
export function formatOsloParts(instant: Date): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: OSLO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}.${get("minute")}.${get("second")}`,
  };
}

export const panel: React.CSSProperties = {
  flex: "1 1 0",
  minWidth: "13rem",
  padding: "1.6rem 1.75rem",
  border: "1px solid #ddd",
  borderRadius: "0.75rem",
  background: "#fafafa",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "0.6rem",
};

export const bigClock: React.CSSProperties = {
  fontSize: "3.6rem",
  fontVariantNumeric: "tabular-nums",
  fontWeight: 600,
  color: "#b8860b",
};

const panelLabel: React.CSSProperties = {
  margin: 0,
  color: "#555",
  fontSize: "1.15rem",
  textAlign: "center",
};

const panelSub: React.CSSProperties = {
  margin: 0,
  color: "#888",
  fontSize: "1rem",
};

export function StatCard({
  label,
  value,
  valueColor,
  sub,
  bg,
  labelColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
  sub?: string;
  bg?: string;
  labelColor?: string;
}) {
  return (
    <div style={{ ...panel, background: bg ?? panel.background }}>
      <p style={{ ...panelLabel, color: labelColor ?? panelLabel.color }}>{label}</p>
      <div style={{ ...bigClock, color: valueColor ?? bigClock.color }}>{value}</div>
      {sub && <p style={panelSub}>{sub}</p>}
    </div>
  );
}

/** Shared clock tick. Uses a self-correcting `setTimeout` that fires as
 * close as possible to each wall-clock second boundary, so a render with
 * `Math.floor(diffMs/1000)` reliably catches the `:00` frame at the
 * top of every second (instead of drifting and skipping it). */
export function useNowTick(): Date {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    const schedule = () => {
      if (cancelled) return;
      // Time until the next wall-clock second boundary (with a tiny
      // 5 ms cushion so we land *just after* the rollover, not before).
      const ms = 1000 - (Date.now() % 1000) + 5;
      timeoutId = window.setTimeout(() => {
        if (cancelled) return;
        setNow(new Date());
        schedule();
      }, ms);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, []);
  return now;
}

/** Reads settings from localStorage and re-reads on a periodic poll so the
 * display dashboard reflects edits made on the setup dashboard. */
export function useTimerSettings(eventId: string) {
  const [startTime, setStartTime] = useState<string>(
    () => localStorage.getItem(startTimeKey(eventId)) ?? "",
  );
  const [mode, setMode] = useState<Mode>(
    () => (localStorage.getItem(modeKey(eventId)) as Mode | null) ?? "backyard",
  );
  const [fyLock, setFyLock] = useState<number>(
    () => Math.min(
      FRONTYARD_LOCK_MAX,
      Math.max(FRONTYARD_LOCK_MIN, readIntSetting(lockKey(eventId), FRONTYARD_LOCK_DEFAULT)),
    ),
  );
  const [fyMax, setFyMax] = useState<number>(
    () => Math.min(FRONTYARD_MAX_CAP, readIntSetting(maxLoopsKey(eventId), FRONTYARD_MAX_DEFAULT)),
  );
  const [beepEnabled, setBeepEnabled] = useState<boolean>(
    () => localStorage.getItem(beepKey(eventId)) === "1",
  );
  const [location, setLocation] = useState<string>(
    () => localStorage.getItem(locationKey(eventId)) ?? "",
  );
  const [jerseyPink, setJerseyPink] = useState<number>(
    () => readIntSetting(jerseyPinkKey(eventId), JERSEY_PINK_DEFAULT),
  );
  const [jerseyGreen, setJerseyGreen] = useState<number>(
    () => readIntSetting(jerseyGreenKey(eventId), JERSEY_GREEN_DEFAULT),
  );
  const [jerseyYellow, setJerseyYellow] = useState<number>(
    () => readIntSetting(jerseyYellowKey(eventId), JERSEY_YELLOW_DEFAULT),
  );

  function reload() {
    setStartTime(localStorage.getItem(startTimeKey(eventId)) ?? "");
    setMode((localStorage.getItem(modeKey(eventId)) as Mode | null) ?? "backyard");
    setFyLock(
      Math.min(
        FRONTYARD_LOCK_MAX,
        Math.max(FRONTYARD_LOCK_MIN, readIntSetting(lockKey(eventId), FRONTYARD_LOCK_DEFAULT)),
      ),
    );
    setFyMax(
      Math.min(FRONTYARD_MAX_CAP, readIntSetting(maxLoopsKey(eventId), FRONTYARD_MAX_DEFAULT)),
    );
    setBeepEnabled(localStorage.getItem(beepKey(eventId)) === "1");
    setLocation(localStorage.getItem(locationKey(eventId)) ?? "");
    setJerseyPink(readIntSetting(jerseyPinkKey(eventId), JERSEY_PINK_DEFAULT));
    setJerseyGreen(readIntSetting(jerseyGreenKey(eventId), JERSEY_GREEN_DEFAULT));
    setJerseyYellow(readIntSetting(jerseyYellowKey(eventId), JERSEY_YELLOW_DEFAULT));
  }

  useEffect(() => {
    reload();
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (
        e.key === startTimeKey(eventId) ||
        e.key === modeKey(eventId) ||
        e.key === lockKey(eventId) ||
        e.key === maxLoopsKey(eventId) ||
        e.key === beepKey(eventId) ||
        e.key === locationKey(eventId) ||
        e.key === jerseyPinkKey(eventId) ||
        e.key === jerseyGreenKey(eventId) ||
        e.key === jerseyYellowKey(eventId)
      ) {
        reload();
      }
    };
    window.addEventListener("storage", onStorage);
    const id = window.setInterval(reload, 2000);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  return {
    startTime,
    setStartTime,
    mode,
    setMode,
    fyLock,
    setFyLock,
    fyMax,
    setFyMax,
    beepEnabled,
    setBeepEnabled,
    location,
    setLocation,
    jerseyPink,
    setJerseyPink,
    jerseyGreen,
    setJerseyGreen,
    jerseyYellow,
    setJerseyYellow,
  };
}

/** Play a short beep tone via Web Audio. Returns true on success. */
let _audioCtx: AudioContext | null = null;
export function playBeep(frequency = 880, durationMs = 250, delayMs = 0) {
  try {
    if (!_audioCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return false;
      _audioCtx = new Ctor();
    }
    const ctx = _audioCtx;
    if (ctx.state === "suspended") ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    const startAt = ctx.currentTime + Math.max(0, delayMs) / 1000;
    const dur = durationMs / 1000;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.3, startAt + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(startAt);
    osc.stop(startAt + dur);
    return true;
  } catch {
    return false;
  }
}

/** Play a bell-like tone (inharmonic partials, ~2s decay) via Web Audio. */
export function playBell(durationMs = 2000) {
  try {
    if (!_audioCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return false;
      _audioCtx = new Ctor();
    }
    const ctx = _audioCtx;
    if (ctx.state === "suspended") ctx.resume();
    const dur = durationMs / 1000;
    const start = ctx.currentTime;
    const fundamental = 587; // D5 — bright bell pitch

    // Inharmonic partials of a struck bell:
    // hum (½ × fundamental), prime, minor-third, perfect-fifth, nominal (2×),
    // and higher overtones. Decay shortens with frequency.
    const partials: { ratio: number; amp: number; decay: number }[] = [
      { ratio: 0.5, amp: 0.25, decay: 1.0 },
      { ratio: 1.0, amp: 0.4, decay: 0.9 },
      { ratio: 1.19, amp: 0.3, decay: 0.7 }, // minor third (inharmonic)
      { ratio: 1.5, amp: 0.22, decay: 0.55 },
      { ratio: 2.0, amp: 0.35, decay: 0.45 },
      { ratio: 2.51, amp: 0.18, decay: 0.3 },
      { ratio: 3.01, amp: 0.12, decay: 0.22 },
      { ratio: 4.13, amp: 0.08, decay: 0.15 },
    ];

    const master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);

    for (const { ratio, amp, decay } of partials) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = fundamental * ratio;
      const partialDur = Math.min(dur, dur * decay);
      // Fast attack, exponential decay
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(amp, start + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + partialDur);
      osc.connect(gain).connect(master);
      osc.start(start);
      osc.stop(start + partialDur + 0.02);
    }

    // Short noise burst for the strike attack (~25 ms).
    const noiseLen = Math.floor(ctx.sampleRate * 0.04);
    const noiseBuf = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;
    const noiseHP = ctx.createBiquadFilter();
    noiseHP.type = "highpass";
    noiseHP.frequency.value = 2000;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, start);
    noiseGain.gain.exponentialRampToValueAtTime(0.4, start + 0.002);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.05);
    noise.connect(noiseHP).connect(noiseGain).connect(master);
    noise.start(start);
    noise.stop(start + 0.06);

    return true;
  } catch {
    return false;
  }
}

const nowRowStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  border: "1px solid #eee",
  borderRadius: "0.4rem",
  background: "#fafafa",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  gap: "0.75rem",
  fontVariantNumeric: "tabular-nums",
};

export function NowOsloRow({ now, eventLocation }: { now: Date; eventLocation?: string }) {
  const parts = formatOsloParts(now);
  return (
    <div style={nowRowStyle}>
      <span style={{ color: "#888", fontSize: "0.85rem" }}>Now (Oslo)</span>
      <span style={{ fontSize: "1.1rem" }}>
        {parts.date} &nbsp; {parts.time}
      </span>
      {eventLocation && (
        <>
          <span style={{ color: "#888", fontSize: "0.85rem", marginLeft: "1.5rem" }}>
            Location
          </span>
          <span style={{ fontSize: "1.1rem" }}>{eventLocation}</span>
        </>
      )}
    </div>
  );
}
