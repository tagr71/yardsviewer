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
  { id: "400116", label: "Frontyard Test" },
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
      style={{ height: "200px", width: "auto", display: "block", ...style }}
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
    () =>
      initialPath.eventId ??
      localStorage.getItem(EVENT_ID_KEY) ??
      PREDEFINED_EVENTS[0]?.id ??
      "",
  );
  // Which dropdown option is currently selected. `OTHER_OPTION` means
  // the user wants to type a custom event ID; any other value is one of
  // the `PREDEFINED_EVENTS` IDs.
  const [eventChoice, setEventChoice] = useState<string>(() => {
    const stored = localStorage.getItem(EVENT_ID_KEY) ?? "";
    return PREDEFINED_EVENTS.some((e) => e.id === stored)
      ? stored
      : stored
        ? OTHER_OPTION
        : PREDEFINED_EVENTS[0]?.id ?? OTHER_OPTION;
  });
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

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = eventId.trim();
    if (!trimmed) return;
    localStorage.setItem(EVENT_ID_KEY, trimmed);
    localStorage.setItem(DASHBOARD_KEY, dashboardId);
    const next = { eventId: trimmed, dashboardId };
    window.history.pushState({}, "", pathFor(next));
    setSelection(next);
  }

  function onBack() {
    window.history.pushState({}, "", "/");
    setSelection(null);
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
      {selection && active && (
        <div
          style={{
            padding: "0.75rem 1rem",
            background: "#fafafa",
            borderBottom: "1px solid #ddd",
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
          }}
        >
          <button
            onClick={onBack}
            style={{
              padding: "0.4rem 0.9rem",
              fontSize: "0.95rem",
              cursor: "pointer",
            }}
          >
            ← Back
          </button>
          <span style={{ color: "#666" }}>
            {active.title} · event {selection.eventId}
          </span>
          <Logo style={{ marginLeft: "auto" }} />
        </div>
      )}

      {!selection && (
        <div
          style={{
            padding: "0.75rem 1rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
          }}
        >
          <Logo />
        </div>
      )}

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
        {!selection && (
          <form
            onSubmit={onSubmit}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.75rem",
              minWidth: "20rem",
              padding: "1.5rem",
              border: "1px solid #ddd",
              borderRadius: "0.5rem",
              background: "#fafafa",
            }}
          >
            <h1 style={{ margin: 0, fontSize: "1.4rem" }}>RaceResult Simulation</h1>

            <label
              htmlFor="event-id"
              style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}
            >
              <span>Event</span>
              <select
                id="event-id"
                value={eventChoice}
                onChange={(e) => {
                  const v = e.target.value;
                  setEventChoice(v);
                  if (v !== OTHER_OPTION) setEventId(v);
                  else setEventId("");
                }}
                style={{ padding: "0.4rem 0.6rem", fontSize: "1rem" }}
              >
                {PREDEFINED_EVENTS.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.label} ({ev.id})
                  </option>
                ))}
                <option value={OTHER_OPTION}>Other…</option>
              </select>
              {eventChoice === OTHER_OPTION && (
                <input
                  id="event-id-custom"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={eventId}
                  placeholder="e.g. 374847"
                  onChange={(e) => setEventId(e.target.value)}
                  style={{ padding: "0.4rem 0.6rem", fontSize: "1rem" }}
                />
              )}
            </label>

            <label
              htmlFor="dashboard"
              style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}
            >
              <span>Dashboard</span>
              <select
                id="dashboard"
                value={dashboardId}
                onChange={(e) => setDashboardId(e.target.value)}
                style={{ padding: "0.4rem 0.6rem", fontSize: "1rem" }}
              >
                {visibleDashboards.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="submit"
              disabled={!eventId.trim()}
              style={{
                padding: "0.5rem 1rem",
                fontSize: "1rem",
                cursor: eventId.trim() ? "pointer" : "not-allowed",
              }}
            >
              {`Open ${visibleDashboards.find((d) => d.id === dashboardId)?.title ?? "dashboard"}`}
            </button>
          </form>
        )}

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
