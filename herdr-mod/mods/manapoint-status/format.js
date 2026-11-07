// Formatting helpers for Manapoint Herdr integration

export const WARNING_AT = 60;
export const CRITICAL_AT = 85;

export function percentText(percent) {
  if (percent === null || percent === undefined || isNaN(percent)) return "--%";
  if (percent === 0) return "0%";
  if (percent > 0 && percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

export function statusColor(percent, theme) {
  if (percent === null || percent === undefined || isNaN(percent)) return theme?.muted ?? "#94a3b8";
  if (percent >= CRITICAL_AT) return "#f87171"; // critical red
  if (percent >= WARNING_AT) return "#fbbf24";  // warning yellow
  return "#34d399";                             // healthy green
}

export function statusBg(percent, theme) {
  if (percent === null || percent === undefined || isNaN(percent)) return theme?.surface ?? "#1e293b";
  if (percent >= CRITICAL_AT) return "#f871712e";
  if (percent >= WARNING_AT) return "#fbbf242e";
  return "#34d39922";
}

export function label(kind) {
  switch (kind) {
    case "Rolling": return "5H";
    case "Weekly": return "WEEK";
    case "Monthly": return "MONTH";
    default: return String(kind || "");
  }
}

export function shortLabel(kind) {
  switch (kind) {
    case "Rolling": return "5h";
    case "Weekly": return "7d";
    case "Monthly": return "30d";
    default: return String(kind || "");
  }
}

export function resetsInText(resetsAt, now = new Date()) {
  if (!resetsAt) return "";
  const deltaMs = new Date(resetsAt).getTime() - now.getTime();
  if (deltaMs <= 0) return "now";
  const MINUTE_MS = 60 * 1000;
  const HOUR_MS = 60 * MINUTE_MS;
  const DAY_MS = 24 * HOUR_MS;
  if (deltaMs < HOUR_MS) return `${Math.floor(deltaMs / MINUTE_MS)}m`;
  if (deltaMs < DAY_MS) return `${Math.floor(deltaMs / HOUR_MS)}h`;
  return `${Math.floor(deltaMs / DAY_MS)}d`;
}

export function providerShortName(id, fullName) {
  switch (id) {
    case "claude-code": return "Claude";
    case "codex": return "Codex";
    case "grok": return "Grok";
    case "opencode-go": return "OpenCode";
    case "antigravity-gemini": return "Gemini";
    case "antigravity-3p": return "Agy 3P";
    case "muse-code": return "Muse";
    default: return fullName || id;
  }
}

export function providerIcon(id) {
  switch (id) {
    case "claude-code": return "mods/manapoint-status/icons/claude.svg";
    case "codex": return "mods/manapoint-status/icons/openai.svg";
    case "grok": return "mods/manapoint-status/icons/grok.svg";
    case "opencode-go": return "mods/manapoint-status/icons/opencode.svg";
    case "antigravity-gemini": return "mods/manapoint-status/icons/gemini.svg";
    case "antigravity-3p": return "mods/manapoint-status/icons/antigravity.svg";
    case "muse-code": return "mods/manapoint-status/icons/muse.svg";
    default: return null;
  }
}

export function providerBrandColor(id) {
  switch (id) {
    case "claude-code": return "#D97757";
    case "codex": return "#10A37F";
    case "grok": return "#E2E8F0";
    case "opencode-go": return "#38BDF8";
    case "antigravity-gemini": return "#60A5FA";
    case "antigravity-3p": return "#A78BFA";
    case "muse-code": return "#0866FF";
    default: return "#94A3B8";
  }
}

export function cardWorstPercent(card) {
  if (!card || !card.windows || card.windows.length === 0) return null;
  let max = -1;
  for (const w of card.windows) {
    if (typeof w.percent === "number") max = Math.max(max, w.percent);
  }
  return max >= 0 ? max : null;
}

export function remainingText(percent) {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return "—";
  const rem = Math.max(0, Math.min(100, 100 - percent));
  return `${Math.round(rem * 10) / 10}%`;
}

export function dateText(timestamp) {
  if (!timestamp) return "—";
  const d = new Date(timestamp);
  if (!Number.isFinite(d.getTime())) return "—";
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${m}/${day} ${h}:${min}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function historyRows(entries, provider = "", days = 7, now = Date.now()) {
  const rows = [];
  if (!Array.isArray(entries)) return rows;
  for (const entry of entries) {
    if (typeof entry?.timestamp !== "number") continue;
    if (entry.timestamp <= now - days * DAY_MS || entry.timestamp > now) continue;
    if (!Array.isArray(entry.cards)) continue;
    for (const card of entry.cards) {
      if (provider && card.id !== provider) continue;
      const wins = Array.isArray(card.windows) && card.windows.length > 0 ? card.windows : [null];
      for (const window of wins) {
        rows.push({ timestamp: entry.timestamp, card, window });
      }
    }
  }
  return rows.sort((a, b) => b.timestamp - a.timestamp);
}
