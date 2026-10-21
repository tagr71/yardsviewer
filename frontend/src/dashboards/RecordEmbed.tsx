import { useEffect, useState, type CSSProperties } from "react";
import { norwegianRecord, resultsPollDelay, type ResultsResponse } from "./raceResults";
import {
  FRONTYARD_LOCK_DEFAULT,
  FRONTYARD_MAX_DEFAULT,
  LOOP_SECONDS,
  formatElapsedClock,
  osloWallClockToInstant,
  useNowTick,
} from "./timerCore";
import { friendlyFetchError } from "../utils/fetchError";

type EmbedKind = "women-record" | "overall-record" | "elapsed";
type EmbedRoute = { kind: EmbedKind; eventId: string };

export function parseEmbedRoute(pathname: string): EmbedRoute | null {
  const match = /^\/embed\/(women-record|overall-record|elapsed)\/([A-Za-z0-9]{1,10})\/?$/.exec(pathname);
  return match ? { kind: match[1] as EmbedKind, eventId: match[2] } : null;
}

export function embedColour(search: string): string | null {
  const value = new URLSearchParams(search).get("color")?.trim() ?? "";
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec(value);
  return match ? `#${match[1]}` : null;
}

function LiveEmbed({ kind, eventId, appearance }: EmbedRoute & { appearance: CSSProperties }) {
  const [data, setData] = useState<ResultsResponse | null>(null);
  const [startInstant, setStartInstant] = useState<Date | null>(null);
  const [failed, setFailed] = useState(false);
  const now = useNowTick();

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let startMs: number | null = null;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/results?event_id=${encodeURIComponent(eventId)}`, { signal: controller.signal });
        if (!response.ok) throw await friendlyFetchError(response);
        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object" || !("rows" in payload) || !Array.isArray(payload.rows)
          || payload.rows.some((row: unknown) => !row || typeof row !== "object"
            || !("bib" in row) || typeof row.bib !== "string" || !("name" in row) || typeof row.name !== "string")) {
          throw new Error("Invalid results response");
        }
        if (cancelled) return;
        const results = payload as ResultsResponse;
        const start = osloWallClockToInstant(typeof results.eventStartTime === "string" ? results.eventStartTime : "");
        if (start) {
          startMs = start.getTime();
          setStartInstant(start);
        }
        setData(results);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) {
          const delay = kind === "elapsed" ? 60_000
            : resultsPollDelay(startMs, Date.now(), "backyard", FRONTYARD_LOCK_DEFAULT, FRONTYARD_MAX_DEFAULT);
          timer = window.setTimeout(load, delay);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [eventId, kind]);

  const elapsed = startInstant ? (now.getTime() - startInstant.getTime()) / 1000 : null;
  const record = norwegianRecord(elapsed !== null && elapsed < 0 ? [] : data?.rows ?? [],
    kind === "women-record" ? "women" : "overall", elapsed === null ? undefined : Math.max(0, Math.floor(elapsed / LOOP_SECONDS)));
  const label = kind === "elapsed" ? "Tid siden start" : record.label;
  useEffect(() => { document.title = label; }, [label]);
  const status = failed
    ? data ? "Viser sist hentede resultater" : "Resultater utilgjengelige"
    : data === null ? kind === "elapsed" ? "Henter starttid..." : "Henter resultater..."
    : kind === "elapsed" && startInstant === null ? "Starttid er ikke tilgjengelig" : null;

  return (
    <main className="embed-widget" data-kind={kind} style={appearance}>
      {kind === "elapsed" ? (
        <div className="embed-record">
          <h1>{label}</h1>
          <p className="embed-clock" role="timer" aria-live="off">{formatElapsedClock(elapsed)}</p>
        </div>
      ) : (
        <div className="embed-record" role="status" aria-live="polite" aria-atomic="true">
          <h1>{label}</h1>
          <p className="embed-count"><span>{record.loops}</span> <span className="embed-unit">runder</span></p>
          <div className="embed-details">
            {record.names.length > 0 && <ul className="embed-names" aria-label="Rekordholder">
              {record.names.map((name, index) => <li key={`${index}:${name}`}>{name}</li>)}
            </ul>}
            {record.year !== null && <p className="embed-year">{record.year}</p>}
          </div>
        </div>
      )}
      {status && <p className="embed-status" role="status">{status}</p>}
    </main>
  );
}

export function RecordEmbed() {
  const route = parseEmbedRoute(window.location.pathname);
  const color = embedColour(window.location.search);
  const appearance = (color ? { "--text": color, "--muted": color } : {}) as CSSProperties;
  return route ? <LiveEmbed key={`${route.kind}:${route.eventId}`} {...route} appearance={appearance} />
    : <main className="embed-widget" style={appearance}><h1>Ugyldig visning</h1></main>;
}