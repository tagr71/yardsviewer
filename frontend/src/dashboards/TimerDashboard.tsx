import { useEffect, useRef } from "react";
import {
  BACKYARD_LOOP_KM,
  FRONTYARD_LOOP_KM,
  FRONTYARD_START_MIN,
  LOOP_SECONDS,
  NowOsloRow,
  StatCard,
  formatDuration,
  formatKm,
  formatOslo,
  frontyardState,
  osloWallClockToInstant,
  pad,
  panel,
  playBeep,
  playBell,
  useNowTick,
  useTimerSettings,
} from "./timerCore";

export function TimerDashboard({ eventId, eventName, eventLocation }: { eventId: string; eventName?: string; eventLocation?: string }) {
  const now = useNowTick();
  const { startTime, mode, fyLock, fyMax, beepEnabled, location,
    jerseyPink, jerseyGreen, jerseyYellow } = useTimerSettings(eventId);

  /** Background for the Remaining min of loop card based on seconds left. */
  function remainingBg(secondsLeft: number): string {
    if (secondsLeft < 180) return "#fecaca"; // red
    if (secondsLeft < 360) return "#fef08a"; // yellow
    return "#ffffff"; // white
  }

  /** Required average pace given a loop time limit (min) and distance (km).
   * Returns `{ pace: "MM:SS", kmh: "N.N" }` (per km per hour). */
  function requiredPace(loopMin: number, distKm: number) {
    if (!isFinite(loopMin) || !isFinite(distKm) || loopMin <= 0 || distKm <= 0) {
      return { pace: "—", kmh: "—" };
    }
    const secPerKm = Math.round((loopMin * 60) / distKm);
    const m = Math.floor(secPerKm / 60);
    const s = secPerKm % 60;
    const kmh = (distKm / loopMin) * 60;
    return { pace: `${pad(m)}:${pad(s)}`, kmh: kmh.toFixed(1) };
  }

  const startInstant = osloWallClockToInstant(startTime);
  const diffMs = startInstant ? now.getTime() - startInstant.getTime() : 0;
  const beforeStart = diffMs < 0;
  const label = beforeStart
    ? "Remaining time until race starts"
    : "Time after race was started";

  const elapsedSeconds = Math.max(0, Math.floor(diffMs / 1000));

  // Backyard
  const loopsCompleted = Math.floor(elapsedSeconds / LOOP_SECONDS);
  const remainingInLoop = LOOP_SECONDS - (elapsedSeconds % LOOP_SECONDS);
  const remMin = Math.floor(remainingInLoop / 60);
  const remSec = remainingInLoop % 60;

  // Frontyard
  const fy = frontyardState(elapsedSeconds, fyLock, fyMax);
  const fyMin = Math.floor(fy.remainingSec / 60);
  const fySec = fy.remainingSec % 60;

  const backyardCompleted = beforeStart ? 0 : loopsCompleted;
  const backyardDistance = backyardCompleted * BACKYARD_LOOP_KM;
  const frontyardCompleted = beforeStart ? 0 : fy.loopsCompleted;
  const frontyardDistance = frontyardCompleted * FRONTYARD_LOOP_KM;

  /** Length (min) of the loop after `currentLoopNumber` in frontyard, or null if none. */
  function nextFrontyardLoopMin(currentLoopNumber: number): number | null {
    const nextK = currentLoopNumber + 1;
    if (nextK > fyMax) return null;
    const lockedLen = Math.max(1, FRONTYARD_START_MIN + 1 - fyLock);
    const naturalLen = Math.max(1, FRONTYARD_START_MIN + 1 - nextK);
    return nextK <= fyLock ? naturalLen : lockedLen;
  }

  /** Image sources awarded for completing `loopNumber` (frontyard). */
  function jerseyImagesFor(loopNumber: number): string[] {
    const imgs: string[] = [];
    if (loopNumber === jerseyPink) imgs.push("/rosa.png");
    if (loopNumber === jerseyGreen) imgs.push("/gr\u00f8nn.png");
    if (loopNumber === jerseyYellow) {
      imgs.push("/gul.png");
      imgs.push("/vinner.png");
    }
    return imgs;
  }

  function JerseyCard({ loopNumber }: { loopNumber: number | null }) {
    const imgs = loopNumber === null ? [] : jerseyImagesFor(loopNumber);
    return (
      <div style={panel}>
        <p style={{ margin: 0, color: "#555", fontWeight: 600 }}>
          Competion this round
        </p>
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "5rem",
          }}
        >
          {imgs.length === 0 ? (
            <span style={{ color: "#bbb", fontSize: "2rem" }}>—</span>
          ) : (
            imgs.map((src) => (
              <img
                key={src}
                src={src}
                alt=""
                style={{ height: "5rem", width: "auto", objectFit: "contain" }}
              />
            ))
          )}
        </div>
      </div>
    );
  }

  // Beep at 3 (×3), 2 (×2) and 1 (×1) minute remaining of the current loop,
  // and ring a bell at each loop rollover and on race finish (frontyard).
  const activeRemainingSec: number | null =
    !startInstant || beforeStart
      ? null
      : mode === "backyard"
        ? remainingInLoop
        : fy.finished
          ? null
          : fy.remainingSec;
  const prevRemainingRef = useRef<number | null>(null);
  const prevFinishedRef = useRef<boolean>(false);
  useEffect(() => {
    const prev = prevRemainingRef.current;
    prevRemainingRef.current = activeRemainingSec;
    if (!beepEnabled) return;
    // Loop boundary: remaining counted down toward 0 and then jumped up
    // (rollover to the next loop), or the race just finished.
    const justFinished = mode === "frontyard" && fy.finished && !prevFinishedRef.current;
    prevFinishedRef.current = mode === "frontyard" ? fy.finished : false;
    if (
      prev !== null &&
      activeRemainingSec !== null &&
      prev > 0 &&
      prev <= 5 &&
      activeRemainingSec > prev
    ) {
      playBell(2000);
      return;
    }
    if (justFinished) {
      playBell(2000);
      return;
    }
    if (activeRemainingSec === null || prev === null) return;
    const thresholds: { sec: number; beeps: number }[] = [
      { sec: 180, beeps: 3 },
      { sec: 120, beeps: 2 },
      { sec: 60, beeps: 1 },
    ];
    for (const { sec, beeps } of thresholds) {
      if (prev > sec && activeRemainingSec <= sec) {
        for (let i = 0; i < beeps; i += 1) {
          playBeep(880, 250, i * 400);
        }
        break;
      }
    }
  }, [activeRemainingSec, beepEnabled, mode, fy.finished]);

  return (
    <section
      style={{
        width: "100%",
        maxWidth: "72rem",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "1.25rem",
      }}
    >
      <h1 style={{ margin: 0 }}>
        Timer dashboard{eventName ? ` — ${eventName}` : ""}
      </h1>

      <NowOsloRow now={now} eventLocation={location || eventLocation} />

      {startInstant ? (
        <>
          <p style={{ margin: 0, color: "#555" }}>{label}</p>
          {(() => {
            const { signedDays, hms } = formatDuration(diffMs);
            const clockColor =
              signedDays < 0 ? "#c62828" : signedDays > 0 ? "#1f6feb" : "#117a3a";
            return (
              <div
                style={{
                  fontSize: "3.5rem",
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 600,
                  color: clockColor,
                  letterSpacing: "0.02em",
                  display: "flex",
                  alignItems: "baseline",
                  gap: "1.5rem",
                }}
              >
                {signedDays !== 0 && <span>days = {signedDays}</span>}
                <span>{hms}</span>
              </div>
            );
          })()}
          <p style={{ margin: 0, color: "#888", fontSize: "0.85rem" }}>
            Start: {formatOslo(startInstant)} (Oslo) · Mode: {mode}
          </p>

          {mode === "backyard" && (
            <div
              style={{
                width: "100%",
                marginTop: "0.5rem",
                display: "flex",
                flexWrap: "wrap",
                gap: "0.75rem",
              }}
            >
              <StatCard
                label="Loops completed"
                value={String(backyardCompleted)}
              bg="#117a3a" valueColor="white" labelColor="white" />
              <StatCard
                label="Current loop"
                value={beforeStart ? "—" : String(backyardCompleted + 1)}
              bg="#facc15" valueColor="black" labelColor="black" />
              <StatCard label="Loop time-limit (min)" value="60" valueColor="black" labelColor="black" />
              <StatCard label="Next loop time-limit (min)" value="60" valueColor="black" labelColor="black" />
              <StatCard
                label="Distance completed"
                value={formatKm(backyardDistance)}
              valueColor="black" labelColor="black" />
              {(() => {
                const r = requiredPace(60, BACKYARD_LOOP_KM);
                return (
                  <StatCard
                    label="Speed min:sek per km"
                    value={`${r.pace}`}
                    sub={`(${r.kmh} km/t)`}
                  valueColor="black" labelColor="black" />
                );
              })()}
              <StatCard
                label={
                  beforeStart
                    ? "Loop starts at race start"
                    : "Remaining min of loop"
                }
                value={`${pad(remMin)}:${pad(remSec)}`}
                bg={beforeStart ? undefined : remainingBg(remainingInLoop)}
                valueColor="black"
                labelColor="black"
              />
            </div>
          )}

          {mode === "frontyard" && (
            <div
              style={{
                width: "100%",
                marginTop: "0.5rem",
                display: "flex",
                flexWrap: "wrap",
                gap: "0.75rem",
              }}
            >
              {beforeStart ? (
                <>
                  <StatCard
                    label="Loops completed"
                    value="0"
                  bg="#117a3a" valueColor="white" labelColor="white" />
                  <StatCard label="Current loop" value="1" bg="#facc15" valueColor="black" labelColor="black" />
                  <StatCard
                    label="Loop time-limit (min)"
                    value={String(FRONTYARD_START_MIN)}
                  valueColor="black" labelColor="black" />
                  {(() => {
                    const next = nextFrontyardLoopMin(1);
                    return (
                      <StatCard
                        label="Next loop time-limit (min)"
                        value={next === null ? "—" : String(next)}
                      valueColor="black" labelColor="black" />
                    );
                  })()}
                  <StatCard
                    label="Distance completed"
                    value={formatKm(0)}
                  valueColor="black" labelColor="black" />
                  {(() => {
                    const r = requiredPace(FRONTYARD_START_MIN, FRONTYARD_LOOP_KM);
                    return (
                      <StatCard
                        label="Speed min:sek per km"
                        value={`${r.pace}`}
                        sub={`(${r.kmh} km/t)`}
                      valueColor="black" labelColor="black" />
                    );
                  })()}
                  <StatCard
                    label="Loop starts at race start"
                    value="30:00"
                  />
                  <JerseyCard loopNumber={1} />
                </>
              ) : fy.finished ? (
                <>
                  <StatCard
                    label="Loops completed"
                    value={String(frontyardCompleted)}
                  bg="#117a3a" valueColor="white" labelColor="white" />
                  <StatCard label="Current loop" value="—" bg="#facc15" valueColor="black" labelColor="black" />
                  <StatCard label="Loop time-limit (min)" value="—" valueColor="black" labelColor="black" />
                  <StatCard label="Next loop time-limit (min)" value="—" valueColor="black" labelColor="black" />
                  <StatCard
                    label="Distance completed"
                    value={formatKm(frontyardDistance)}
                  valueColor="black" labelColor="black" />
                  <StatCard
                    label="Speed min:sek per km"
                    value="—"
                    sub="(—)"
                  valueColor="black" labelColor="black" />
                  <StatCard
                    label="Race finished"
                    value="00:00"
                    valueColor="#117a3a"
                  />
                  <JerseyCard loopNumber={null} />
                </>
              ) : (
                <>
                  <StatCard
                    label="Loops completed"
                    value={String(frontyardCompleted)}
                  bg="#117a3a" valueColor="white" labelColor="white" />
                  <StatCard
                    label="Current loop"
                    value={String(fy.loopNumber)}
                  bg="#facc15" valueColor="black" labelColor="black" />
                  <StatCard
                    label="Loop time-limit (min)"
                    value={String(fy.loopLengthMin)}
                  valueColor="black" labelColor="black" />
                  {(() => {
                    const next = nextFrontyardLoopMin(fy.loopNumber);
                    return (
                      <StatCard
                        label="Next loop time-limit (min)"
                        value={next === null ? "—" : String(next)}
                      valueColor="black" labelColor="black" />
                    );
                  })()}
                  <StatCard
                    label="Distance completed"
                    value={formatKm(frontyardDistance)}
                  valueColor="black" labelColor="black" />
                  {(() => {
                    const r = requiredPace(fy.loopLengthMin, FRONTYARD_LOOP_KM);
                    return (
                      <StatCard
                        label="Speed min:sek per km"
                        value={`${r.pace}`}
                        sub={`(${r.kmh} km/t)`}
                      valueColor="black" labelColor="black" />
                    );
                  })()}
                  <StatCard
                    label="Remaining min of loop"
                    value={`${pad(fyMin)}:${pad(fySec)}`}
                    bg={remainingBg(fy.remainingSec)}
                    valueColor="black"
                    labelColor="black"
                  />
                  <JerseyCard loopNumber={fy.loopNumber} />
                </>
              )}
            </div>
          )}
        </>
      ) : (
        <p style={{ color: "#888" }}>
          Set the race start time in the Timer set-up dashboard to start the clock.
        </p>
      )}
    </section>
  );
}
