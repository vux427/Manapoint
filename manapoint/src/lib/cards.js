// Turning collector outcomes into panel cards (CONTRACT.md §1.4). Pure: the caller
// owns the snapshot map and persists it.

import { asCollectError } from "./errors.js";

export const STALE_NOTE = "上次數字，更新中";

export const blank = (p) => ({
  id: p.id,
  name: p.name,
  badge: p.badge,
  windows: [],
  note: null,
  error: null,
});

/** A card showing the last good numbers while fresh ones are on the way. */
function fromSnapshot(p, lastGood) {
  const card = blank(p);
  const previous = lastGood[p.id];
  if (previous) {
    card.windows = previous.windows;
    card.note = STALE_NOTE;
  }
  return card;
}

/** Fill the panel from the snapshot so a cold start shows numbers immediately instead
 * of a column of errors while the first requests are in flight. */
export const seed = (providers, lastGood) => providers.map((p) => fromSnapshot(p, lastGood));

/**
 * Fold one round of outcomes ({ status: 'fulfilled', value } | { status: 'rejected',
 * reason }, as from Promise.allSettled) into cards, updating `lastGood` in place.
 */
export function fromOutcomes(providers, outcomes, lastGood) {
  return providers.map((p, i) => {
    const card = blank(p);
    const outcome = outcomes[i];
    if (outcome.status === "fulfilled") {
      const u = outcome.value;
      card.windows = u.windows;
      card.note = u.note;
      // A note-only reading carries no numbers: showing it is honest, but it must not
      // wipe the last real numbers from the cache.
      if (u.windows.length > 0) lastGood[p.id] = u;
      return card;
    }

    const err = asCollectError(outcome.reason);
    const previous = lastGood[p.id];
    // A stale reading with an explanation beats an empty card: the CLI usually
    // re-authenticates itself and the next poll recovers.
    if (err.keepsLastGood && previous) {
      card.windows = previous.windows;
      card.note = err.message;
    } else {
      card.error = err.message;
    }
    return card;
  });
}

/**
 * Rebuild the list for a new selection or order, reusing readings already in hand.
 * `incomplete` says some card has no data yet and a fetch is worth doing.
 */
export function restack(providers, current, lastGood) {
  const known = new Map(current.map((c) => [c.id, c]));
  let incomplete = false;
  const cards = providers.map((p) => {
    const existing = known.get(p.id);
    if (existing) return existing;
    if (!lastGood[p.id]) incomplete = true;
    return fromSnapshot(p, lastGood);
  });
  return { cards, incomplete };
}
