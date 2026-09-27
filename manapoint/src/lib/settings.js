// Persisted user preferences (CONTRACT.md §1.5), in %APPDATA%\Manapoint\settings.json.

import { readText, writeText } from "./io.js";
import { appDataDir } from "./paths.js";
import { clamp, isNumber } from "./values.js";

/** Slider floor. Between this and the 0.80 safe floor the user is on their own. */
export const MIN_OPACITY = 0.3;
export const MAX_OPACITY = 1.0;

export const LAYOUTS = ["Vertical", "Horizontal"];

/** UsageWindow kinds the keyboard widget may show, per provider. */
export const WIDGET_KINDS = ["Rolling", "Weekly", "Monthly"];

export function defaults() {
  return {
    themeName: "石墨",
    cardsLayout: "Vertical",
    panelOpacity: 0.85,
    enabledProviders: null, // null = never configured, so everything shows
    providerOrder: null, // null = registry order
    alerts: true, // notify when a window crosses 80% / 95%, or resets after being high
    widgetWindows: null, // null = never configured; per-provider visible kinds for the keyboard widget
  };
}

const idList = (v) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? v : null);

/** Anything but an array means "never narrowed": every kind stays visible. */
const widgetKinds = (v) => (Array.isArray(v) ? v.filter((x) => WIDGET_KINDS.includes(x)) : [...WIDGET_KINDS]);

const widgetWindows = (v) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return Object.fromEntries(Object.entries(v).map(([id, kinds]) => [id, widgetKinds(kinds)]));
};

/**
 * Pull any stored shape back into range. Older files may hold values outside the
 * current range, and a hand-edited one may hold anything at all; losing a single bad
 * field is better than refusing to start.
 */
export function normalize(raw) {
  const d = defaults();
  if (!raw || typeof raw !== "object") return d;
  return {
    themeName: typeof raw.themeName === "string" ? raw.themeName : d.themeName,
    cardsLayout: LAYOUTS.includes(raw.cardsLayout) ? raw.cardsLayout : d.cardsLayout,
    panelOpacity: isNumber(raw.panelOpacity)
      ? clamp(raw.panelOpacity, MIN_OPACITY, MAX_OPACITY)
      : d.panelOpacity,
    enabledProviders: idList(raw.enabledProviders),
    providerOrder: idList(raw.providerOrder),
    alerts: typeof raw.alerts === "boolean" ? raw.alerts : d.alerts,
    widgetWindows: widgetWindows(raw.widgetWindows),
  };
}

const file = () => appDataDir() + "/settings.json";

export async function load() {
  const text = await readText(file());
  if (text === null) return defaults();
  try {
    return normalize(JSON.parse(text));
  } catch {
    return defaults();
  }
}

/** Write failures are logged, not fatal; the next change tries again. */
export async function save(settings) {
  try {
    await writeText(file(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error("[manapoint] settings not saved:", err?.message ?? err);
  }
}
