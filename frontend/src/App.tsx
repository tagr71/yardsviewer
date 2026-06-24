import { useEffect, useMemo, useState } from "react";
import { dashboards } from "./dashboards";
import { modeKey } from "./dashboards/timerCore";

const EVENT_ID_KEY = "raceresult.eventId";
const DASHBOARD_KEY = "raceresult.dashboard";
const CLUB_NAME = "HELL ULTRALØPERKLUBB";

function normalizeDashboardId(id: string | null | undefined): string | null {
  if (!id) return null;
  return dashboards.some((d) => d.id === id) ? id : null;
}

/** Predefined races shown in the Event dropdown. Add entries here to
 * extend the list — the value is the RaceResult event ID. */
const PREDEFINED_EVENTS: { id: string; label: string }[] = [
  { id: "337633", label: "Hell Backyard Ultra 2026" },
  { id: "374847", label: "Rotvollfjæra Frontyard Ultra" },
  { id: "352401", label: "Rondane Backyard Ultra" },
];
const OTHER_OPTION = "__other__";

/** Decide whether the given event is a "backyard" race. Resolution order:
 * 1. Stored race mode for this event (set in Settings or auto-detected
 *    from `/api/results` eventMode).
 * 2. Heuristic on the predefined-event label (contains "backyard" /
 *    "frontyard").
 * 3. Default: false — leaves the Jerseys dashboard visible until the
 *    user opens Settings (which auto-detects and stores the mode). */
function isBackyardEvent(id: string, label: string): boolean {
  const stored = id ? localStorage.getItem(modeKey(id)) : null;
  if (stored === "backyard") return true;
  if (stored === "frontyard") return false;
  const lc = label.toLowerCase();
  if (lc.includes("backyard")) return true;
  if (lc.includes("frontyard")) return false;
  return false;
}

type Selection = { eventId: string; dashboardId: string };

/** Parse `location.pathname` into an optional dashboard id (matching one
 * of `dashboards[].id`) and an optional numeric event id. Examples:
 *   "/"               -> { dashboardId: null, eventId: null }
 *   "/jerseys"        -> { dashboardId: "jerseys", eventId: null }
 *   "/jerseys/374847" -> { dashboardId: "jerseys", eventId: "374847" }
 */
function parsePath(): { dashboardId: string | null; eventId: string | null } {
  const segs = window.location.pathname.split("/").filter(Boolean);
  const dashId = normalizeDashboardId(segs[0]);
  const evId = segs[1] && /^\d+$/.test(segs[1]) ? segs[1] : null;
  return { dashboardId: dashId, eventId: evId };
}

function pathFor(sel: Selection | null): string {
  if (!sel) return "/";
  return `/${sel.dashboardId}/${sel.eventId}`;
}

/** Drop a replacement file at `frontend/public/logo.svg` (or `.png`) to
 * change the logo without touching this component. */
function Logo({ style }: { style?: React.CSSProperties }) {
  return (
    <img
      src="/logo.png"
      alt="Logo"
      style={{ height: "64px", width: "auto", display: "block", ...style }}
    />
  );
}

export function App() {
  const initialPath = useMemo(() => parsePath(), []);
  const [selection, setSelection] = useState<Selection | null>(() => {
    if (!initialPath.dashboardId) return null;
    const evId =
      initialPath.eventId ??
      localStorage.getItem(EVENT_ID_KEY) ??
      PREDEFINED_EVENTS[0]?.id ??
      "";
    if (!evId) return null;
    return { eventId: evId, dashboardId: initialPath.dashboardId };
  });
  const [eventId, setEventId] = useState<string>(
    () => initialPath.eventId ?? localStorage.getItem(EVENT_ID_KEY) ?? "",
  );
  // Which dropdown option is currently selected. `OTHER_OPTION` means
  // the user wants to type a custom event ID; `""` means nothing chosen
  // yet (first launch, no localStorage); any other value is a predefined
  // event ID.
  const [eventChoice, setEventChoice] = useState<string>("");
  const [dashboardId, setDashboardId] = useState<string>(
    () =>
      initialPath.dashboardId ??
      normalizeDashboardId(localStorage.getItem(DASHBOARD_KEY)) ??
      dashboards[0].id,
  );
  const [eventName, setEventName] = useState<string>("");
  const [eventLocation, setEventLocation] = useState<string>("");

  // Fetch the event name for the footer whenever a dashboard is active.
  useEffect(() => {
    if (!selection) {
      setEventName("");
      setEventLocation("");
      return;
    }
    let cancelled = false;
    fetch(`/api/participants/count?event_id=${encodeURIComponent(selection.eventId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { eventName?: string; eventLocation?: string }) => {
        if (cancelled) return;
        setEventName(data.eventName ?? "");
        setEventLocation(data.eventLocation ?? "");
      })
      .catch(() => {
        if (cancelled) return;
        setEventName("");
        setEventLocation("");
      });
    return () => {
      cancelled = true;
    };
  }, [selection]);

  function applySelection(nextEventId: string, nextDashboardId: string) {
    const trimmed = nextEventId.trim();
    if (!trimmed) return;
    localStorage.setItem(EVENT_ID_KEY, trimmed);
    localStorage.setItem(DASHBOARD_KEY, nextDashboardId);
    const next = { eventId: trimmed, dashboardId: nextDashboardId };
    window.history.pushState({}, "", pathFor(next));
    setSelection(next);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    applySelection(eventId, dashboardId);
  }

  // Browser back/forward: re-sync selection from the URL.
  useEffect(() => {
    function onPop() {
      const parsed = parsePath();
      if (!parsed.dashboardId) {
        setSelection(null);
        return;
      }
      const evId =
        parsed.eventId ??
        localStorage.getItem(EVENT_ID_KEY) ??
        PREDEFINED_EVENTS[0]?.id ??
        "";
      if (!evId) {
        setSelection(null);
        return;
      }
      setSelection({ eventId: evId, dashboardId: parsed.dashboardId });
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Filter the Dashboard dropdown: Jerseys is frontyard-only.
  const currentLabel =
    PREDEFINED_EVENTS.find((e) => e.id === eventId)?.label ?? "";
  const visibleDashboards = useMemo(
    () =>
      isBackyardEvent(eventId, currentLabel)
        ? dashboards.filter((d) => d.id !== "jerseys")
        : dashboards,
    [eventId, currentLabel],
  );
  // Reset to the first visible dashboard if the persisted selection is
  // no longer available (e.g. user switched a "jerseys" pick to a
  // backyard event).
  useEffect(() => {
    if (!visibleDashboards.some((d) => d.id === dashboardId)) {
      setDashboardId(visibleDashboards[0]?.id ?? dashboards[0].id);
    }
  }, [visibleDashboards, dashboardId]);

  const active = selection
    ? dashboards.find((d) => d.id === selection.dashboardId)
    : undefined;

  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          padding: "0.6rem 1rem",
          background: "#fafafa",
          borderBottom: "1px solid #ddd",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        <Logo />

        <label
          style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}
        >
          <span style={{ fontSize: "0.75rem", color: "#555" }}>Event</span>
          <select
            value={eventChoice}
            onChange={(e) => {
              const v = e.target.value;
              setEventChoice(v);
              if (v !== OTHER_OPTION && v !== "") {
                setEventId(v);
                applySelection(v, dashboardId);
              } else if (v === OTHER_OPTION) {
                setEventId("");
              }
            }}
            style={{ padding: "0.35rem 0.5rem", fontSize: "0.95rem" }}
          >
            {eventChoice === "" && (
              <option value="" disabled>Choose event…</option>
            )}
            {PREDEFINED_EVENTS.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.label} ({ev.id})
              </option>
            ))}
            <option value={OTHER_OPTION}>Other…</option>
          </select>
        </label>

        {eventChoice === OTHER_OPTION && (
          <label
            style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}
          >
            <span style={{ fontSize: "0.75rem", color: "#555" }}>Event ID</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={eventId}
              placeholder="e.g. 374847"
              onChange={(e) => setEventId(e.target.value)}
              style={{ padding: "0.35rem 0.5rem", fontSize: "0.95rem", width: "8rem" }}
            />
          </label>
        )}

        <label
          style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}
        >
          <span style={{ fontSize: "0.75rem", color: "#555" }}>Dashboard</span>
          <select
            value={dashboardId}
            onChange={(e) => {
              const v = e.target.value;
              setDashboardId(v);
              if (eventId.trim()) applySelection(eventId, v);
            }}
            style={{ padding: "0.35rem 0.5rem", fontSize: "0.95rem" }}
          >
            {visibleDashboards.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
          </select>
        </label>

        {eventChoice === OTHER_OPTION && (
          <button
            type="submit"
            disabled={!eventId.trim()}
            style={{
              padding: "0.4rem 0.9rem",
              fontSize: "0.95rem",
              cursor: eventId.trim() ? "pointer" : "not-allowed",
              alignSelf: "flex-end",
            }}
          >
            Open
          </button>
        )}

        {selection && active && (
          <span style={{ color: "#666", marginLeft: "auto", fontSize: "0.9rem" }}>
            {active.title} · event {selection.eventId}
          </span>
        )}
      </form>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: "1.5rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
          gap: "1.25rem",
          overflow: "auto",
        }}
      >
        {selection && active && (
          <active.component
            eventId={selection.eventId}
            eventName={eventName}
            eventLocation={eventLocation}
          />
        )}

        {selection && !active && (
          <p style={{ color: "crimson" }}>
            Unknown dashboard: {selection.dashboardId}
          </p>
        )}

        {!selection && (
          <p style={{ color: "#666" }}>
            Choose an event and a dashboard above.
          </p>
        )}
      </div>

      <footer
        style={{
          padding: "0.6rem 1rem",
          background: "#fafafa",
          borderTop: "1px solid #ddd",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.75rem",
          fontSize: "0.85rem",
          color: "#555",
          letterSpacing: "0.04em",
        }}
      >
        <span style={{ fontWeight: 600 }}>{CLUB_NAME}</span>
        <span style={{ textAlign: "right" }}>{eventName}</span>
      </footer>
    </main>
  );
}
