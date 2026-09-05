// Presentation rules: turn raw usage numbers into what the user sees.
//
// These used to be scattered across Avalonia ViewModels; they live here as pure
// functions so the panel and the settings page share one rule set and the rules
// can be unit-tested. No side effects, no DOM, no global state.
import { WARNING_AT, CRITICAL_AT } from "./themes.js";

// Unknown kinds throw instead of returning "" so a backend rename or typo
// surfaces loudly instead of rendering an empty meter label.
export function label(kind) {
  switch (kind) {
    case "Rolling":
      return "5H";
    case "Weekly":
      return "WEEK";
    case "Monthly":
      return "MONTH";
    default:
      throw new Error(`Unknown UsageWindowKind: ${kind}`);
  }
}

// Same fail-loud policy as label(): a wrong short label in the compact theme
// would be mistaken for real data.
export function shortLabel(kind) {
  switch (kind) {
    case "Rolling":
      return "5h";
    case "Weekly":
      return "7d";
    case "Monthly":
      return "30d";
    default:
      throw new Error(`Unknown UsageWindowKind: ${kind}`);
  }
}

// Below 1% but non-zero shows "<1%" because "0%" reads as "never used".
export function percentText(percent) {
  if (percent === 0) {
    return "0%";
  }
  if (percent > 0 && percent < 1) {
    return "<1%";
  }
  return `${Math.round(percent)}%`;
}

// The "!" glyph duplicates the critical-colour warning for colour-blind users,
// so it is only meaningful on status-coloured themes.
export function alertText(percent, coloring) {
  if (coloring === "status" && percent >= CRITICAL_AT) {
    return "!";
  }
  return "";
}

// Accent themes carry meaning through a single brand colour, so the meter
// never switches to status colours on them.
export function statusColor(theme, percent) {
  if (theme.coloring === "accent") {
    return theme.accent;
  }
  if (percent >= CRITICAL_AT) {
    return theme.status.critical;
  }
  if (percent >= WARNING_AT) {
    return theme.status.warning;
  }
  return theme.status.good;
}

// A segmented meter lights at least one cell once anything is used, for the
// same reason percentText never shows "0%" for non-zero usage.
export function litCells(percent, cells) {
  const raw = Math.round((percent / 100) * cells);
  const withMinimum = percent > 0 && raw < 1 ? 1 : raw;
  return Math.min(cells, Math.max(0, withMinimum));
}

// Units always floor so a partial unit never rounds up into the next bucket
// (59m59s must read "59m", never "60m" or "1h").
export function resetsInText(resetsAt, now = new Date()) {
  if (resetsAt === null || resetsAt === undefined) {
    return "";
  }
  const deltaMs = new Date(resetsAt).getTime() - now.getTime();
  if (deltaMs <= 0) {
    return "now";
  }
  const MINUTE_MS = 60 * 1000;
  const HOUR_MS = 60 * MINUTE_MS;
  const DAY_MS = 24 * HOUR_MS;
  if (deltaMs < HOUR_MS) {
    return `${Math.floor(deltaMs / MINUTE_MS)}m`;
  }
  if (deltaMs < DAY_MS) {
    return `${Math.floor(deltaMs / HOUR_MS)}h`;
  }
  return `${Math.floor(deltaMs / DAY_MS)}d`;
}
