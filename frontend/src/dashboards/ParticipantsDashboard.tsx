import { useEffect, useRef, useState } from "react";

type CountResponse = { count: number; eventName?: string; eventId?: string };

const REFRESH_MS = 30_000;

export function ParticipantsDashboard({ eventId }: { eventId: string }) {
  const [count, setCount] = useState<number | null>(null);
  const [eventName, setEventName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const idRef = useRef(eventId);
  idRef.current = eventId;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const id = idRef.current;
      try {
        const res = await fetch(
          `/api/participants/count?event_id=${encodeURIComponent(id)}`,
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        }
        const data: CountResponse = await res.json();
        if (cancelled || idRef.current !== id) return;
        setCount(data.count);
        setEventName(data.eventName ?? "");
        setError(null);
        setLastUpdated(new Date());
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    setLoading(true);
    setCount(null);
    setEventName("");
    setError(null);
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [eventId]);

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.75rem",
        textAlign: "center",
      }}
    >
      {eventName && (
        <h2 style={{ margin: 0, fontWeight: 500, color: "#555" }}>{eventName}</h2>
      )}
      <h1 style={{ margin: 0 }}>Total participants</h1>
      {loading && count === null && <p>Loading…</p>}
      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
      {count !== null && (
        <p style={{ fontSize: "6rem", fontWeight: 700, margin: 0, lineHeight: 1 }}>
          {count}
        </p>
      )}
      {lastUpdated && (
        <p style={{ margin: 0, color: "#888", fontSize: "0.85rem" }}>
          Updated {lastUpdated.toLocaleTimeString()} · auto-refresh every{" "}
          {REFRESH_MS / 1000}s
        </p>
      )}
    </section>
  );
}
