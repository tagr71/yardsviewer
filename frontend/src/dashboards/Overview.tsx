import { useEffect, useMemo, useRef, useState } from "react";
import {
  BACKYARD_LOOP_KM,
  FRONTYARD_LOOP_KM,
  useTimerSettings,
  useViewLoop,
} from "./timerCore";

type CountResponse = { count: number; eventName?: string };
type ResultRow = {
  sex?: string;
  status?: string;
  lapsCompleted?: number | null;
};
type ResultsResponse = { raceFinished?: boolean; rows?: ResultRow[] };

const OUT_PATTERN = /dnf|dns|dq|withdrawn/i;
const DNS_PATTERN = /dns/i;

const REFRESH_MS = 30_000;

export function Overview({ eventId }: { eventId: string }) {
  const { mode } = useTimerSettings(eventId);
  const { viewLoop, setViewLoop } = useViewLoop(eventId);
  const [count, setCount] = useState<number | null>(null);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [eventName, setEventName] = useState<string>("");
  const [raceFinished, setRaceFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const idRef = useRef(eventId);
  idRef.current = eventId;

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    async function load() {
      const id = idRef.current;
      try {
        const [countRes, resultsRes] = await Promise.all([
          fetch(`/api/participants/count?event_id=${encodeURIComponent(id)}`),
          fetch(`/api/results?event_id=${encodeURIComponent(id)}`),
        ]);
        if (!countRes.ok) {
          throw new Error(`HTTP ${countRes.status}: ${await countRes.text()}`);
        }
        const countData: CountResponse = await countRes.json();
        const resultsData: ResultsResponse = resultsRes.ok
          ? await resultsRes.json()
          : {};
        if (cancelled || idRef.current !== id) return;
        setCount(countData.count);
        setRows(resultsData.rows ?? []);
        setEventName(countData.eventName ?? "");
        setRaceFinished(Boolean(resultsData.raceFinished));
        setError(null);
        setLastUpdated(new Date());
        // No point polling once the race is over — the data is static.
        if (resultsData.raceFinished && timer !== null) {
          window.clearInterval(timer);
          timer = null;
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    setLoading(true);
    setCount(null);
    setRows([]);
    setEventName("");
    setRaceFinished(false);
    setError(null);
    load();
    timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [eventId]);

  const loopKm = mode === "frontyard" ? FRONTYARD_LOOP_KM : BACKYARD_LOOP_KM;
  const maxLoop = useMemo(() => {
    let max = 0;
    for (const r of rows) {
      if (typeof r.lapsCompleted === "number" && r.lapsCompleted > max) {
        max = r.lapsCompleted;
      }
    }
    return max;
  }, [rows]);
  const effectiveViewLoop =
    viewLoop !== null && maxLoop >= 1
      ? Math.min(Math.max(1, viewLoop), maxLoop)
      : null;

  // "Still in" means runners who actually completed the lap we are looking
  // at — runners who started the lap but DNF'd are excluded.
  //   - replay at loop L  → completed >= L laps
  //   - finished, static  → completed >= maxLoop laps (i.e. the winner(s))
  //   - live              → status is not DNF/DNS/DQ/withdrawn
  const sexOf = (r: ResultRow) => (r.sex ?? "").toUpperCase();
  const isStillIn = (r: ResultRow) => {
    if (effectiveViewLoop !== null) {
      return typeof r.lapsCompleted === "number"
        ? r.lapsCompleted >= effectiveViewLoop
        : false;
    }
    if (raceFinished && maxLoop >= 1) {
      return typeof r.lapsCompleted === "number"
        ? r.lapsCompleted >= maxLoop
        : false;
    }
    return !OUT_PATTERN.test(r.status ?? "");
  };

  const female = rows.filter((r) => sexOf(r) === "K").length;
  const male = rows.filter((r) => sexOf(r) === "M").length;
  const starting = rows.filter((r) => !DNS_PATTERN.test(r.status ?? "")).length;
  const stillIn = rows.filter(isStillIn).length;
  const femaleStillIn = rows.filter((r) => sexOf(r) === "K" && isStillIn(r)).length;
  const maleStillIn = rows.filter((r) => sexOf(r) === "M" && isStillIn(r)).length;
  // Effective completed laps: DNF/DNS/DQ/withdrawn runners did not complete
  // the final lap they're recorded against, so cap them at maxLoop - 1.
  const completedLaps = (r: ResultRow) => {
    if (typeof r.lapsCompleted !== "number") return 0;
    if (OUT_PATTERN.test(r.status ?? "") && maxLoop >= 1) {
      return Math.min(r.lapsCompleted, maxLoop - 1);
    }
    return r.lapsCompleted;
  };
  const accKm = rows.reduce((sum, r) => {
    const laps =
      effectiveViewLoop !== null
        ? Math.min(completedLaps(r), effectiveViewLoop)
        : completedLaps(r);
    return sum + laps * loopKm;
  }, 0);
  const currentLoop = effectiveViewLoop ?? maxLoop;
  const hasResults = rows.length > 0;
  const fmt = (n: number) => (hasResults ? n.toString() : "—");
  const fmtKm = (n: number) =>
    hasResults ? n.toFixed(1) : "—";

  return (
    <section
      style={{
        width: "100%",
        maxWidth: "1800px",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.75rem",
        textAlign: "center",
        overflow: "auto",
      }}
    >
      {eventName && (
        <h2 style={{ margin: 0, fontWeight: 500, color: "#555" }}>{eventName}</h2>
      )}
      <h1 style={{ margin: 0 }}>Overview</h1>
      {maxLoop >= 1 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.4rem 0.6rem",
            background: effectiveViewLoop !== null ? "#fff7ed" : "#f3f3f3",
            border: "1px solid #ddd",
            borderRadius: "0.3rem",
          }}
        >
          <strong>{raceFinished ? "Race finished:" : "Replay:"}</strong>
          <button
            type="button"
            onClick={() => setViewLoop(1)}
            style={playbackBtn}
            aria-label="Jump to first loop"
          >
            ⏮
          </button>
          <button
            type="button"
            onClick={() =>
              setViewLoop(Math.max(1, (effectiveViewLoop ?? maxLoop) - 1))
            }
            style={playbackBtn}
            aria-label="Previous loop"
          >
            ◀
          </button>
          <span style={{ minWidth: "9rem", textAlign: "center" }}>
            {effectiveViewLoop !== null
              ? `Loop ${effectiveViewLoop} / ${maxLoop}`
              : `Live · loop ${maxLoop}`}
          </span>
          <button
            type="button"
            onClick={() =>
              setViewLoop(Math.min(maxLoop, (effectiveViewLoop ?? 0) + 1))
            }
            style={playbackBtn}
            aria-label="Next loop"
          >
            ▶
          </button>
          <button
            type="button"
            onClick={() => setViewLoop(maxLoop)}
            style={playbackBtn}
            aria-label="Jump to last loop"
          >
            ⏭
          </button>
          <button
            type="button"
            onClick={() => setViewLoop(null)}
            style={{
              ...playbackBtn,
              marginLeft: "auto",
              cursor: effectiveViewLoop === null ? "default" : "pointer",
              opacity: effectiveViewLoop === null ? 0.5 : 1,
            }}
            disabled={effectiveViewLoop === null}
          >
            Live
          </button>
        </div>
      )}
      {loading && count === null && <p>Loading…</p>}
      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
      {count !== null && (
        <>
          <div style={registeredRow}>
            <RegisteredCell label="Registered participants" value={count} />
            <RegisteredCell label="Starting runners" value={fmt(starting)} bg="#facc15" color="black" />
            <RegisteredCell label="Starting Females (K)" value={fmt(female)} bg="#dc2626" color="white" />
            <RegisteredCell label="Starting Males (M)" value={fmt(male)} bg="#2563eb" color="white" />
          </div>
          <div style={statGridFour}>
            <StatCard label="Still in competition" value={fmt(stillIn)} bg="#facc15" color="black" />
            <StatCard label="Female still in" value={fmt(femaleStillIn)} bg="#dc2626" color="white" />
            <StatCard label="Men still in" value={fmt(maleStillIn)} bg="#2563eb" color="white" />
          </div>
          <div style={statGridBottom}>
            <StatCard label="Current loop" value={fmt(currentLoop)} bg="#0f766e" color="white" />
            <StatCard label="Acc. distance (km)" value={fmtKm(accKm)} bg="#117a3a" color="white" />
          </div>
        </>
      )}
      {lastUpdated && (
        <p style={{ margin: 0, color: "#888", fontSize: "0.85rem" }}>
          {raceFinished
            ? "Final results"
            : `Updated ${lastUpdated.toLocaleTimeString()} · auto-refresh every ${REFRESH_MS / 1000}s`}
        </p>
      )}
    </section>
  );
}

function StatCard({
  label,
  value,
  bg,
  color,
}: {
  label: string;
  value: string | number;
  bg?: string;
  color?: string;
}) {
  return (
    <div style={{ ...statCard, ...(bg ? { background: bg } : {}) }}>
      <div style={{ ...statCardLabel, ...(color ? { color } : {}) }}>{label}</div>
      <div style={{ ...statCardValue, ...(color ? { color } : {}) }}>{value}</div>
    </div>
  );
}

function RegisteredCell({
  label,
  value,
  bg,
  color,
}: {
  label: string;
  value: string | number;
  bg?: string;
  color?: string;
}) {
  const cellStyle: React.CSSProperties = {
    ...registeredCell,
    ...(bg ? { background: bg, padding: "0.75rem", borderRadius: "0.4rem" } : {}),
  };
  const labelStyle: React.CSSProperties = {
    ...statLabel,
    ...(color ? { color } : {}),
  };
  const valueStyle: React.CSSProperties = {
    ...bigNumber,
    ...(color ? { color } : {}),
  };
  return (
    <div style={cellStyle}>
      <div style={labelStyle}>{label}</div>
      <p style={valueStyle}>{value}</p>
    </div>
  );
}

const bigNumber: React.CSSProperties = {
  fontSize: "6rem",
  fontWeight: 700,
  margin: 0,
  lineHeight: 1,
};

const statLabel: React.CSSProperties = {
  color: "#666",
  fontSize: "1rem",
};

const statGridFour: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: "1rem",
  width: "100%",
  marginTop: "1rem",
};

const registeredRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: "1rem",
  width: "100%",
  alignItems: "end",
};

const registeredCell: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "0.25rem",
};

const statGridBottom: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: "1rem",
  width: "100%",
};

const playbackBtn: React.CSSProperties = {
  padding: "0.3rem 0.6rem",
  fontSize: "1rem",
  border: "1px solid #ccc",
  borderRadius: "0.3rem",
  background: "white",
  cursor: "pointer",
};

const statCard: React.CSSProperties = {
  border: "1px solid #ddd",
  borderRadius: "0.4rem",
  padding: "0.75rem 1rem",
  background: "#fafafa",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "0.25rem",
};

const statCardLabel: React.CSSProperties = {
  color: "#666",
  fontSize: "1rem",
};

const statCardValue: React.CSSProperties = {
  fontSize: "6rem",
  fontWeight: 700,
  lineHeight: 1,
  fontVariantNumeric: "tabular-nums",
};
