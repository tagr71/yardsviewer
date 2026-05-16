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

/** Converts internal ISO-ish value ("yyyy-MM-ddTHH:mm:ss" or "yyyy-MM-ddTHH:mm")
 * to display format "dd.mm.yyyy HH.mm.ss". */
function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(iso);
  if (!m) return "";
  const [, y, mo, d, h, mi, s] = m;
  return `${d}.${mo}.${y} ${h}.${mi}.${s ?? "00"}`;
}

/** Parses "dd.mm.yyyy HH.mm.ss" (or HH.mm / HH:mm:ss / HH:mm) to ISO.
 * Returns null when not parseable. */
function displayToIso(text: string): string | null {
  const t = text.trim();
  if (!t) return "";
  const m = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})[ T]+(\d{1,2})[.:](\d{2})(?:[.:](\d{2}))?$/.exec(t);
  if (!m) return null;
  const [, d, mo, y, h, mi, s] = m;
  const dd = d.padStart(2, "0");
  const mm = mo.padStart(2, "0");
  const hh = h.padStart(2, "0");
  const di = Number(dd), moi = Number(mm), hi = Number(hh), mii = Number(mi), si = Number(s ?? "0");
  if (di < 1 || di > 31 || moi < 1 || moi > 12 || hi > 23 || mii > 59 || si > 59) return null;
  return `${y}-${mm}-${dd}T${hh}:${mi}:${(s ?? "00").padStart(2, "0")}`;
}

export function TimerSetupDashboard({ eventId, eventName, eventLocation }: { eventId: string; eventName?: string; eventLocation?: string }) {
  const now = useNowTick();
  const { startTime, setStartTime, mode, setMode, fyLock, setFyLock, fyMax, setFyMax,
    beepEnabled, setBeepEnabled, location, setLocation,
    jerseyPink, setJerseyPink, jerseyGreen, setJerseyGreen, jerseyYellow, setJerseyYellow } =
    useTimerSettings(eventId);

  const [startDisplay, setStartDisplay] = useState(() => isoToDisplay(startTime));
  const [startInvalid, setStartInvalid] = useState(false);
  // Keep display in sync if startTime changes elsewhere (e.g. cross-tab).
  useEffect(() => {
    setStartDisplay(isoToDisplay(startTime));
    setStartInvalid(false);
  }, [startTime]);

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
    const value = e.target.value;
    setStartDisplay(value);
    const iso = displayToIso(value);
    if (iso === null) {
      setStartInvalid(true);
      return;
    }
    setStartInvalid(false);
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
        maxWidth: "40rem",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "1.25rem",
      }}
    >
      <h1 style={{ margin: 0 }}>
        Timer set-up{eventName ? ` — ${eventName}` : ""}
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
        <span>Race location</span>
        <input
          type="text"
          value={location}
          placeholder={eventLocation || "e.g. Trondheim"}
          onChange={onLocationChange}
          style={{ padding: "0.4rem 0.6rem", fontSize: "1rem" }}
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
        <span>Race start time (Oslo time)</span>
        <input
          type="text"
          inputMode="numeric"
          placeholder="dd.mm.yyyy HH.mm.ss"
          value={startDisplay}
          onChange={onStartTimeDisplayChange}
          style={{
            padding: "0.4rem 0.6rem",
            fontSize: "1rem",
            border: `1px solid ${startInvalid ? "#c62828" : "#ccc"}`,
            borderRadius: "0.25rem",
          }}
        />
        {startInvalid && (
          <span style={{ fontSize: "0.85rem", color: "#c62828" }}>
            Expected format: dd.mm.yyyy HH.mm.ss
          </span>
        )}
      </label>

      <fieldset
        style={{
          border: "1px solid #ddd",
          borderRadius: "0.4rem",
          padding: "0.5rem 1rem",
          display: "flex",
          gap: "1rem",
          width: "100%",
        }}
      >
        <legend style={{ padding: "0 0.4rem", color: "#555" }}>Mode</legend>
        <label style={{ display: "flex", gap: "0.4rem", cursor: "pointer" }}>
          <input
            type="radio"
            name="timer-mode"
            value="backyard"
            checked={mode === "backyard"}
            onChange={() => onModeChange("backyard")}
          />
          Backyard
        </label>
        <label style={{ display: "flex", gap: "0.4rem", cursor: "pointer" }}>
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
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={beepEnabled}
          onChange={(e) => onBeepToggle(e.target.checked)}
        />
        <span>Beep at 3, 2 and 1 minute remaining, and bell at loop end</span>
      </label>

      <p style={{ margin: 0, color: "#888", fontSize: "0.85rem", textAlign: "center" }}>
        Settings are saved automatically and used by the Timer dashboard.
      </p>
    </section>
  );
}
