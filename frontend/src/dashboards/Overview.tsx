import { useEffect, useMemo, useRef, useState } from "react";
import {
  BACKYARD_LOOP_KM,
  FRONTYARD_LOOP_KM,
  playbackBtn,
  playbackBarSticky,
  useTimerSettings,
  useViewLoop,
} from "./timerCore";
import { friendlyFetchError } from "../utils/fetchError";
import { DisplayToggle, useDisplayPreference } from "../theme";
import { cumulativeLoopStandings, publishedLoop, remainingRunner, type ResultRow } from "./raceResults";

type CountResponse = { count: number; eventName?: string };
type ResultsResponse = { raceFinished?: boolean; rows?: ResultRow[] };

const DNS_PATTERN = /dns/i;

const REFRESH_MS = 10_000;

export function Overview({ eventId }: { eventId: string }) {
  const [showInfo, setShowInfo] = useDisplayPreference("overview.showParticipantInfo");
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
          throw await friendlyFetchError(countRes);
        }
        if (!resultsRes.ok) {
          throw await friendlyFetchError(resultsRes);
        }
        const countData: CountResponse = await countRes.json();
        const resultsData: ResultsResponse = await resultsRes.json();
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
  const maxLoop = useMemo(() => publishedLoop(rows), [rows]);
  const effectiveViewLoop =
    viewLoop !== null && maxLoop >= 1
      ? Math.min(Math.max(1, viewLoop), maxLoop)
      : null;

  // "Still in" means runners who actually completed the lap we are looking
  // at — runners who started the lap but DNF'd are excluded.
  //   - pre-race (maxLoop=0) → same filter as "starting": exclude DNS only
  //                            (RaceResult publishes all participants as DNF
  //                            before the race begins, so OUT_PATTERN would
  //                            incorrectly exclude everyone)
  //   - replay at loop L     → completed >= L laps
  //   - finished, static     → completed >= maxLoop laps (i.e. the winner(s))
  //   - live                 → status is not DNF/DNS/DQ/withdrawn
  const sexOf = (r: ResultRow) => (r.sex ?? "").toUpperCase();
  const isStillIn = (r: ResultRow) => remainingRunner(r, {
    loop: effectiveViewLoop ?? maxLoop, replay: effectiveViewLoop !== null, finished: raceFinished,
  });

  const female = rows.filter((r) => sexOf(r) === "K").length;
  const male = rows.filter((r) => sexOf(r) === "M").length;
  const starting = rows.filter((r) => !DNS_PATTERN.test(r.status ?? "")).length;
  const stillIn = rows.filter(isStillIn).length;
  const femaleStillIn = rows.filter((r) => sexOf(r) === "K" && isStillIn(r)).length;
  const maleStillIn = rows.filter((r) => sexOf(r) === "M" && isStillIn(r)).length;
  const accLoops = cumulativeLoopStandings(rows, effectiveViewLoop).totalLoops;
  const accKm = accLoops * loopKm;
  const currentLoop = effectiveViewLoop ?? maxLoop;
  const hasResults = rows.length > 0;
  const fmt = (n: number) => (hasResults ? n.toString() : "—");
  const fmtKm = (n: number) =>
    hasResults ? n.toFixed(1) : "—";
  const fmtPct = (part: number, total: number): string => {
    if (!hasResults || total === 0) return "";
    return ` (${((part / total) * 100).toFixed(1)}%)`;
  };

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
        <h2 style={{ margin: 0, fontWeight: 500, color: "var(--muted)" }}>{eventName}</h2>
      )}
      <div className="page-heading">
        <h1>Overview</h1>
        <DisplayToggle label="Show participant info" checked={showInfo} onChange={setShowInfo} />
      </div>
      {maxLoop >= 1 && (
        <div
          role="group"
          aria-label="Replay controls"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              setViewLoop(Math.max(1, (effectiveViewLoop ?? maxLoop) - 1));
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              setViewLoop(Math.min(maxLoop, (effectiveViewLoop ?? 0) + 1));
            } else if (e.key === "Home") {
              e.preventDefault();
              setViewLoop(1);
            } else if (e.key === "End") {
              e.preventDefault();
              setViewLoop(maxLoop);
            } else if (e.key.toLowerCase() === "l") {
              e.preventDefault();
              setViewLoop(null);
            }
          }}
          style={{
            ...playbackBarSticky,
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.4rem 0.6rem",
            background: effectiveViewLoop !== null ? "var(--replay)" : "var(--surface-strong)",
            border: "1px solid var(--border)",
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
      {error && <p style={{ color: "var(--danger)" }}>Error: {error}</p>}
      {count !== null && (
        <>
          {showInfo && <div className="overview-participants" style={registeredRow}>
            <RegisteredCell label="Starting runners" value={fmt(starting)} bg="var(--stat-yellow)" color="var(--text)" />
            <RegisteredCell label="Starting Females (K)" value={fmt(female)} bg="#dc2626" color="white" />
            <RegisteredCell label="Starting Males (M)" value={fmt(male)} bg="#2563eb" color="white" />
          </div>}
          {showInfo && <div className="overview-participants" style={statGridFour}>
            <StatCard label={`Still in${fmtPct(stillIn, starting)}`} value={fmt(stillIn)} bg="var(--stat-yellow)" color="var(--text)" />
            <StatCard label={`Female still in${fmtPct(femaleStillIn, female)}`} value={fmt(femaleStillIn)} bg="#dc2626" color="white" />
            <StatCard label={`Men still in${fmtPct(maleStillIn, male)}`} value={fmt(maleStillIn)} bg="#2563eb" color="white" />
          </div>}
          <div className="overview-metrics" style={{
            ...statGridBottom,
            gridTemplateColumns: showInfo
              ? statGridBottom.gridTemplateColumns
              : "repeat(auto-fit, minmax(min(100%, 18rem), 1fr))",
          }}>
            {!showInfo && <StatCard label={`Still in${fmtPct(stillIn, starting)}`} value={fmt(stillIn)} bg="var(--stat-yellow)" color="var(--text)" />}
            <StatCard label="Current loop" value={fmt(currentLoop)} bg="#0f766e" color="white" />
            {!showInfo && <StatCard label="Acc. loops" value={fmt(accLoops)} valueStyle={{ fontSize: "4rem" }} />}
            <StatCard label="Acc. distance (km)" value={fmtKm(accKm)} bg="#117a3a" color="white" valueStyle={{ fontSize: "4rem" }} />
            {showInfo && <StatCard label="Registered participants" value={fmt(count)} />}
          </div>
        </>
      )}
      {lastUpdated && (
        <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.85rem" }}>
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
  valueStyle,
}: {
  label: string;
  value: string | number;
  bg?: string;
  color?: string;
  valueStyle?: React.CSSProperties;
}) {
  return (
    <div style={{ ...statCard, ...(bg ? { background: bg } : {}) }}>
      <div style={{ ...statCardLabel, ...(color ? { color } : {}) }}>{label}</div>
      <div style={{ ...statCardValue, ...(color ? { color } : {}), ...valueStyle }}>{value}</div>
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
  color: "var(--muted)",
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
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
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
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: "1rem",
  width: "100%",
};

const statCard: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "0.4rem",
  padding: "0.75rem 1rem",
  background: "var(--surface)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "0.25rem",
};

const statCardLabel: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: "1rem",
};

const statCardValue: React.CSSProperties = {
  fontSize: "6rem",
  fontWeight: 700,
  lineHeight: 1,
  fontVariantNumeric: "tabular-nums",
};
