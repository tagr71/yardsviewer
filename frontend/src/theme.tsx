import { useEffect, useState } from "react";

export type Theme = "day" | "night";
export const THEME_KEY = "raceresult.theme";
export const AUTOMATIC_THEME_KEY = "raceresult.themeAutomatic";
const CHANGE_EVENT = "raceresult.preferenceChanged";
const isTheme = (value: unknown): value is Theme => value === "day" || value === "night";
const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const norwegianHourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Oslo",
  hour: "2-digit",
  hourCycle: "h23",
});

export function readPreference<Value>(key: string, fallback: Value, valid: (value: unknown) => value is Value): Value {
  try {
    const raw = window.localStorage.getItem(key);
    const value: unknown = raw === null ? null : JSON.parse(raw);
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function usePreference<Value>(key: string, fallback: Value, valid: (value: unknown) => value is Value) {
  const [value, setValue] = useState(() => readPreference(key, fallback, valid));
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setValue(readPreference(key, fallback, valid));
    };
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key: string; value: unknown }>).detail;
      if (detail.key === key && valid(detail.value)) setValue(detail.value);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGE_EVENT, onChange);
    };
  }, [key, fallback, valid]);
  const update = (next: Value) => {
    setValue(next);
    try { window.localStorage.setItem(key, JSON.stringify(next)); } catch {}
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { key, value: next } }));
  };
  return [value, update] as const;
}

export function norwegianThemeAt(instant: Date): Theme {
  const hour = Number(norwegianHourFormatter.format(instant));
  return hour >= 17 || hour < 8 ? "night" : "day";
}

export function initialTheme(instant = new Date()): Theme {
  return readPreference(AUTOMATIC_THEME_KEY, true, isBoolean)
    ? norwegianThemeAt(instant) : readPreference(THEME_KEY, "day", isTheme);
}

export function useThemeSettings() {
  const [manualTheme, setManualTheme] = usePreference(THEME_KEY, "day", isTheme);
  const [automatic, setAutomatic] = usePreference(AUTOMATIC_THEME_KEY, true, isBoolean);
  const [automaticTheme, setAutomaticTheme] = useState(() => norwegianThemeAt(new Date()));
  useEffect(() => {
    if (!automatic) return;
    const refresh = () => setAutomaticTheme(norwegianThemeAt(new Date()));
    refresh();
    const timer = window.setInterval(refresh, 1000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [automatic]);
  return { theme: automatic ? automaticTheme : manualTheme, manualTheme, setManualTheme, automatic, setAutomatic };
}

export function useTheme() {
  const settings = useThemeSettings();
  return [settings.theme, settings.setManualTheme] as const;
}

export function useDisplayPreference(name: string, fallback = true) {
  return usePreference(`raceresult.${name}`, fallback, isBoolean);
}

export function DisplayToggle({ label, checked, onChange, disabled = false, title }: {
  label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; title?: string;
}) {
  return (
    <label className="display-toggle" title={title}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}