import { useEffect, useState } from "react";
import {
  FRONTYARD_LOCK_MAX,
  FRONTYARD_LOCK_MIN,
  FRONTYARD_MAX_CAP,
  FRONTYARD_START_MIN,
  NowOsloRow,
  beepKey,
  jerseyGreenKey,
  jerseyPinkKey,
  jerseyYellowKey,
  lockKey,
  locationKey,
  maxLoopsKey,
  modeKey,
  playBeep,
  startTimeKey,
  useNowTick,
  useTimerSettings,
  type Mode,
} from "./timerCore";

/** Normalises an internal start-time string to the value expected by
 * `<input type="datetime-local" step="1">` (`YYYY-MM-DDTHH:mm:ss`).
 * Pads missing seconds with `:00`; returns "" for unparseable input. */
function isoToPicker(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(iso);
  if (!m) return "";
  const [, y, mo, d, h, mi, s] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s ?? "00"}`;
}

export function Settings({ eventId, eventName, eventLocation }: { eventId: string; eventName?: string; eventLocation?: string }) {
  const now = useNowTick();
  const { startTime, setStartTime, mode, setMode, fyLock, setFyLock, fyMax, setFyMax,
    beepEnabled, setBeepEnabled, location, setLocation,
    jerseyPink, setJerseyPink, jerseyGreen, setJerseyGreen, jerseyYellow, setJerseyYellow } =
    useTimerSettings(eventId);

  const [startPicker, setStartPicker] = useState(() => isoToPicker(startTime));
  const [raceFinished, setRaceFinished] = useState(false);
  // Keep picker value in sync if startTime changes elsewhere (e.g. cross-tab
  // or the auto-fill effect below).
  useEffect(() => {
    setStartPicker(isoToPicker(startTime));
  }, [startTime]);

  // For a finished race, auto-populate the start time and mode from the
  // RaceResult event metadata if the user hasn't set them yet. Manual
  // edits are preserved — we only fill when the corresponding
  // localStorage key is unset.
  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    fetch(`/api/results?event_id=${encodeURIComponent(eventId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(
        (data: {
          raceFinished?: boolean;
          eventStartTime?: string;
          eventMode?: string;
        }) => {
          if (cancelled) return;
          setRaceFinished(Boolean(data.raceFinished));
          if (!data.raceFinished) return;
          const iso = (data.eventStartTime ?? "").trim();
          if (iso) {
            const existing = localStorage.getItem(startTimeKey(eventId));
            if (!existing || !existing.trim()) {
              setStartTime(iso);
              localStorage.setItem(startTimeKey(eventId), iso);
            }
          }
          const detected = (data.eventMode ?? "").trim();
          if (detected === "backyard" || detected === "frontyard") {
            if (localStorage.getItem(modeKey(eventId)) === null) {
              setMode(detected);
              localStorage.setItem(modeKey(eventId), detected);
            }
          }
        },
      )
      .catch(() => {
        /* network errors are non-fatal for auto-fill */
      });
    return () => {
      cancelled = true;
    };
  }, [eventId, setStartTime, setMode]);

  function onLocationChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setLocation(value);
    if (value.trim()) localStorage.setItem(locationKey(eventId), value);
    else localStorage.removeItem(locationKey(eventId));
  }

  function onBeepToggle(next: boolean) {
    setBeepEnabled(next);
    localStorage.setItem(beepKey(eventId), next ? "1" : "0");
    if (next) playBeep(); // unlock audio context with a user gesture
  }

  function onStartTimeDisplayChange(e: React.ChangeEvent<HTMLInputElement>) {
    // The browser's datetime-local picker always emits a well-formed
    // `YYYY-MM-DDTHH:mm` (or `YYYY-MM-DDTHH:mm:ss` when step=1) string;
    // we just normalise seconds to two digits before persisting.
    const value = e.target.value;
    setStartPicker(value);
    const iso = value
      ? value.length === 16
        ? `${value}:00`
        : value
      : "";
    setStartTime(iso);
    if (iso) localStorage.setItem(startTimeKey(eventId), iso);
    else localStorage.removeItem(startTimeKey(eventId));
  }

  function onModeChange(next: Mode) {
    setMode(next);
    localStorage.setItem(modeKey(eventId), next);
  }

  function onFyLockChange(next: number) {
    const clamped = Math.max(FRONTYARD_LOCK_MIN, Math.min(FRONTYARD_LOCK_MAX, next));
    setFyLock(clamped);
    localStorage.setItem(lockKey(eventId), String(clamped));
    if (fyMax <= clamped) {
      const bumped = Math.min(FRONTYARD_MAX_CAP, clamped + 1);
      setFyMax(bumped);
      localStorage.setItem(maxLoopsKey(eventId), String(bumped));
    }
  }

  function onFyMaxChange(next: number) {
    const clamped = Math.max(fyLock + 1, Math.min(FRONTYARD_MAX_CAP, next));
    setFyMax(clamped);
    localStorage.setItem(maxLoopsKey(eventId), String(clamped));
  }

  function onJerseyChange(
    which: "pink" | "green" | "yellow",
    next: number,
  ) {
    const clamped = Math.max(1, Math.min(fyMax, next));
    if (which === "pink") {
      setJerseyPink(clamped);
      localStorage.setItem(jerseyPinkKey(eventId), String(clamped));
    } else if (which === "green") {
      setJerseyGreen(clamped);
      localStorage.setItem(jerseyGreenKey(eventId), String(clamped));
    } else {
      setJerseyYellow(clamped);
      localStorage.setItem(jerseyYellowKey(eventId), String(clamped));
    }
  }

  const lockOptions: number[] = [];
  for (let i = FRONTYARD_LOCK_MIN; i <= FRONTYARD_LOCK_MAX; i += 1) lockOptions.push(i);
  const maxOptions: number[] = [];
  for (let i = fyLock + 1; i <= FRONTYARD_MAX_CAP; i += 1) maxOptions.push(i);
  const jerseyOptions: number[] = [];
  for (let i = 1; i <= fyMax; i += 1) jerseyOptions.push(i);

  return (
    <section
      style={{
        width: "100%",
        maxWidth: "1000px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "1.25rem",
      }}
    >
      <h1 style={{ margin: 0 }}>
        Settings{eventName ? ` — ${eventName}` : ""}
      </h1>

      <NowOsloRow now={now} eventLocation={location || eventLocation} />

      <label
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.25rem",
          width: "100%",
        }}
      >
        <span>Race location{raceFinished && " · locked (race finished)"}</span>
        <input
          type="text"
          value={location}
          placeholder={eventLocation || "e.g. Trondheim"}
          onChange={onLocationChange}
          disabled={raceFinished}
          style={{
            padding: "0.4rem 0.6rem",
            fontSize: "1rem",
            opacity: raceFinished ? 0.5 : 1,
            cursor: raceFinished ? "not-allowed" : "text",
          }}
        />
      </label>

      <label
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.25rem",
          width: "100%",
        }}
      >
        <span>Race start time (Oslo time){raceFinished && " · locked (race finished)"}</span>
        <input
          type="datetime-local"
          step={1}
          lang="no-NO"
          value={startPicker}
          onChange={onStartTimeDisplayChange}
          disabled={raceFinished}
          style={{
            padding: "0.4rem 0.6rem",
            fontSize: "1rem",
            border: "1px solid #ccc",
            borderRadius: "0.25rem",
            opacity: raceFinished ? 0.5 : 1,
            cursor: raceFinished ? "not-allowed" : "text",
          }}
        />
        <span style={{ fontSize: "0.85rem", color: "#666", fontFamily: "monospace" }}>
          ISO: {startPicker ? startPicker.replace("T", " ") : "—"}
        </span>
      </label>

      <fieldset
        disabled={raceFinished}
        style={{
          border: "1px solid #ddd",
          borderRadius: "0.4rem",
          padding: "0.5rem 1rem",
          display: "flex",
          gap: "1rem",
          width: "100%",
          opacity: raceFinished ? 0.5 : 1,
          cursor: raceFinished ? "not-allowed" : "auto",
        }}
      >
        <legend style={{ padding: "0 0.4rem", color: "#555" }}>
          Mode{raceFinished && " · locked (race finished)"}
        </legend>
        <label style={{ display: "flex", gap: "0.4rem", cursor: raceFinished ? "not-allowed" : "pointer" }}>
          <input
            type="radio"
            name="timer-mode"
            value="backyard"
            checked={mode === "backyard"}
            onChange={() => onModeChange("backyard")}
          />
          Backyard
        </label>
        <label style={{ display: "flex", gap: "0.4rem", cursor: raceFinished ? "not-allowed" : "pointer" }}>
          <input
            type="radio"
            name="timer-mode"
            value="frontyard"
            checked={mode === "frontyard"}
            onChange={() => onModeChange("frontyard")}
          />
          Frontyard
        </label>
      </fieldset>

      {mode === "frontyard" && (
        <div
          style={{
            width: "100%",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0.75rem",
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span>Hold time-limit after loop</span>
            <select
              value={fyLock}
              onChange={(e) => onFyLockChange(parseInt(e.target.value, 10))}
              style={{ padding: "0.4rem 0.6rem", fontSize: "1rem" }}
            >
              {lockOptions.map((n) => (
                <option key={n} value={n}>
                  Loop {n} ({Math.max(1, FRONTYARD_START_MIN + 1 - n)} min)
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span>Maximum number of loops</span>
            <select
              value={fyMax}
              onChange={(e) => onFyMaxChange(parseInt(e.target.value, 10))}
              style={{ padding: "0.4rem 0.6rem", fontSize: "1rem" }}
            >
              {maxOptions.map((n) => (
                <option key={n} value={n}>
                  {n} loops
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span>Pink jersey at loop</span>
            <select
              value={Math.min(jerseyPink, fyMax)}
              onChange={(e) => onJerseyChange("pink", parseInt(e.target.value, 10))}
              style={{ padding: "0.4rem 0.6rem", fontSize: "1rem" }}
            >
              {jerseyOptions.map((n) => (
                <option key={n} value={n}>
                  Loop {n}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span>Green jersey at loop</span>
            <select
              value={Math.min(jerseyGreen, fyMax)}
              onChange={(e) => onJerseyChange("green", parseInt(e.target.value, 10))}
              style={{ padding: "0.4rem 0.6rem", fontSize: "1rem" }}
            >
              {jerseyOptions.map((n) => (
                <option key={n} value={n}>
                  Loop {n}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span>Yellow &amp; Winner at loop</span>
            <select
              value={Math.min(jerseyYellow, fyMax)}
              onChange={(e) => onJerseyChange("yellow", parseInt(e.target.value, 10))}
              style={{ padding: "0.4rem 0.6rem", fontSize: "1rem" }}
            >
              {jerseyOptions.map((n) => (
                <option key={n} value={n}>
                  Loop {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          width: "100%",
          padding: "0.5rem 0.75rem",
          border: "1px solid #ddd",
          borderRadius: "0.4rem",
          cursor: raceFinished ? "not-allowed" : "pointer",
          opacity: raceFinished ? 0.5 : 1,
        }}
      >
        <input
          type="checkbox"
          checked={beepEnabled && !raceFinished}
          disabled={raceFinished}
          onChange={(e) => onBeepToggle(e.target.checked)}
        />
        <span>
          Beep at 3, 2 and 1 minute remaining, and bell at loop end
          {raceFinished && " · disabled (race finished)"}
        </span>
      </label>

      <p style={{ margin: 0, color: "#888", fontSize: "0.85rem", textAlign: "center" }}>
        Settings are saved automatically and used by the Dashboard.
      </p>
    </section>
  );
}
