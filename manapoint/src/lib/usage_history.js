import { readText, writeAtomicText } from "./io.js";
import { appDataDir } from "./paths.js";

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const file = () => appDataDir() + "/usage-history.json";

export function prune(entries, now = Date.now()) {
  return entries.filter((e) => Number.isFinite(e?.timestamp) && e.timestamp > now - RETENTION_MS && e.timestamp <= now && Array.isArray(e.cards));
}

/** Copy only usage fields, so credentials and projections never enter the archive. */
export function snapshot(cards, now = Date.now()) {
  return {
    timestamp: now,
    cards: cards.map((c) => ({
      id: c.id, name: c.name, note: c.note ?? null, error: c.error ?? null,
      windows: c.windows.map((w) => ({
        kind: w.kind, percent: w.percent, resetsAt: w.resetsAt ?? null,
        ...(typeof w.account === "string" ? { account: w.account } : {}),
        ...(typeof w.quotaGroup === "string" ? { quotaGroup: w.quotaGroup } : {}),
      })),
    })),
  };
}

export async function load(now = Date.now()) {
  const text = await readText(file());
  if (text === null) return [];
  try {
    const parsed = JSON.parse(text);
    return prune(Array.isArray(parsed) ? parsed : [], now);
  } catch (err) {
    console.error("[manapoint] usage history not loaded:", err?.message ?? err);
    return [];
  }
}

export async function save(entries) {
  await writeAtomicText(file(), JSON.stringify(entries));
}
