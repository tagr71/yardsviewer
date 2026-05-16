import { useEffect, useMemo, useState } from "react";

type ResultRow = {
  place: number | null;
  bib: string;
  name: string;
  club: string;
  country: string;
  sex: string;
};
type ResultsResponse = { eventName?: string; rows: ResultRow[] };

const REFRESH_MS = 30_000;

type SortKey = keyof ResultRow;
type SortDir = "asc" | "desc";

const columns: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "place", label: "Place", numeric: true },
  { key: "bib", label: "Number", numeric: true },
  { key: "name", label: "Full Name" },
  { key: "club", label: "Club" },
  { key: "country", label: "Country" },
  { key: "sex", label: "Sex" },
];

function compare(a: ResultRow, b: ResultRow, key: SortKey, dir: SortDir): number {
  const av = a[key];
  const bv = b[key];

  // null/empty always sort last regardless of direction
  const aEmpty = av === null || av === "";
  const bEmpty = bv === null || bv === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  let cmp: number;
  if (typeof av === "number" && typeof bv === "number") {
    cmp = av - bv;
  } else if (key === "bib") {
    cmp = Number(av) - Number(bv);
  } else {
    cmp = String(av).localeCompare(String(bv), undefined, { sensitivity: "base" });
  }
  return dir === "asc" ? cmp : -cmp;
}

export function LeaderboardDashboard({ eventId }: { eventId: string }) {
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [eventName, setEventName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("place");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(
          `/api/results?event_id=${encodeURIComponent(eventId)}`,
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        }
        const data: ResultsResponse = await res.json();
        if (cancelled) return;
        setRows(data.rows ?? []);
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
    setRows([]);
    setError(null);
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [eventId]);

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => compare(a, b, sortKey, sortDir)),
    [rows, sortKey, sortDir],
  );

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <section
      style={{
        width: "100%",
        maxWidth: "60rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
      }}
    >
      {eventName && (
        <h2 style={{ margin: 0, fontWeight: 500, color: "#555" }}>{eventName}</h2>
      )}
      <h1 style={{ margin: 0 }}>Leaderboard</h1>

      {loading && rows.length === 0 && <p>Loading…</p>}
      {error && <p style={{ color: "crimson" }}>Error: {error}</p>}

      {sortedRows.length > 0 && (
        <table
          style={{
            borderCollapse: "collapse",
            width: "100%",
            fontSize: "1rem",
          }}
        >
          <thead>
            <tr style={{ background: "#f3f3f3" }}>
              {columns.map((col) => {
                const active = col.key === sortKey;
                const arrow = active ? (sortDir === "asc" ? " ▲" : " ▼") : "";
                return (
                  <th
                    key={col.key}
                    onClick={() => toggleSort(col.key)}
                    style={{
                      ...th,
                      cursor: "pointer",
                      textAlign: col.numeric ? "right" : "left",
                      userSelect: "none",
                      whiteSpace: "nowrap",
                    }}
                    title="Click to sort"
                  >
                    {col.label}
                    <span style={{ color: "#888" }}>{arrow}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((r, i) => (
              <tr
                key={`${r.bib}-${i}`}
                style={i % 2 ? { background: "#fafafa" } : undefined}
              >
                <td style={tdNum}>{r.place ?? "—"}</td>
                <td style={tdNum}>{r.bib}</td>
                <td style={td}>{r.name}</td>
                <td style={td}>{r.club}</td>
                <td style={td}>{r.country}</td>
                <td style={td}>{r.sex}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {lastUpdated && (
        <p style={{ margin: 0, color: "#888", fontSize: "0.85rem" }}>
          Updated {lastUpdated.toLocaleTimeString()} · auto-refresh every{" "}
          {REFRESH_MS / 1000}s · {sortedRows.length} entries
        </p>
      )}
    </section>
  );
}

const th: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  borderBottom: "2px solid #ddd",
};
const td: React.CSSProperties = {
  padding: "0.4rem 0.75rem",
  borderBottom: "1px solid #eee",
};
const tdNum: React.CSSProperties = {
  ...td,
  fontVariantNumeric: "tabular-nums",
  textAlign: "right",
  width: "4rem",
};
