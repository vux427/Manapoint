// Burn rate: a short history of each window's percent, and from it where the window
// will be when it resets. Kept in %APPDATA%\Manapoint\trend.json — percentages and
// times only, like the usage snapshot.
//
// The rate is the straight line from the oldest kept sample to the newest. A drop
// means the window reset (or a rolling window eased off), so the line restarts there.

import { readText, writeText } from "./io.js";
import { appDataDir } from "./paths.js";

const MINUTE = 60_000;
/** Less history than this is too noisy to extrapolate from. */
export const MIN_SPAN_MS = 30 * MINUTE;
/** Older samples describe a different pace (yesterday, last night). */
export const MAX_AGE_MS = 24 * 60 * MINUTE;
/** Polls closer than this overwrite the newest sample instead of adding one. */
const SPACING_MS = 10 * MINUTE;

export const windowKey = (cardId, w) => `${cardId}|${w.account ?? ""}|${w.kind}`;

/** Add one reading to `history` (mutated in place). */
export function record(history, key, t, percent) {
  let samples = (history[key] ?? []).filter((s) => t - s.t <= MAX_AGE_MS && s.t <= t);
  const last = samples[samples.length - 1];
  if (last && percent < last.p - 0.5) samples = [];
  const prev = samples[samples.length - 2];
  // The oldest sample is the anchor of the line, so it is never the one overwritten.
  if (prev && t - prev.t < SPACING_MS) samples[samples.length - 1] = { t, p: percent };
  else samples.push({ t, p: percent });
  history[key] = samples;
}

/** Forget windows that have not reported for a day (a removed provider or account). */
export function prune(history, now) {
  for (const key of Object.keys(history)) {
    const s = history[key];
    if (!Array.isArray(s) || s.length === 0 || now - s[s.length - 1].t > MAX_AGE_MS) delete history[key];
  }
}

/** { projected, runsOutAt } for one window, or null when there is nothing to say. */
export function project(samples, w, now) {
  if (!Array.isArray(samples) || samples.length < 2 || !w.resetsAt) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const span = last.t - first.t;
  if (span < MIN_SPAN_MS) return null;
  const rate = (last.p - first.p) / span;
  const resetMs = Date.parse(w.resetsAt);
  if (!(rate > 0) || !(resetMs > now)) return null;
  const projected = w.percent + rate * (resetMs - now);
  const runsOut = w.percent < 100 && projected >= 100 ? now + (100 - w.percent) / rate : null;
  return {
    projected: Math.round(projected),
    runsOutAt: runsOut === null ? null : new Date(runsOut).toISOString(),
  };
}

/**
 * Cards as the page gets them: windows that are visibly heading somewhere carry
 * `projected` (percent at reset) and `runsOutAt` (when 100% is reached, if before the
 * reset). New objects — the stored cards and snapshot stay as the providers said.
 */
export function annotate(cards, history, now) {
  return cards.map((card) => {
    if (card.error || card.windows.length === 0) return card;
    let changed = false;
    const windows = card.windows.map((w) => {
      const p = project(history[windowKey(card.id, w)], w, now);
      // Under a point of movement is not worth a mark on the meter.
      if (!p || p.projected < w.percent + 1) return w;
      changed = true;
      return { ...w, ...p };
    });
    return changed ? { ...card, windows } : card;
  });
}

const file = () => appDataDir() + "/trend.json";

export async function load() {
  const text = await readText(file());
  if (text === null) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function save(history) {
  try {
    await writeText(file(), JSON.stringify(history));
  } catch (err) {
    console.error("[manapoint] trend not saved:", err?.message ?? err);
  }
}
