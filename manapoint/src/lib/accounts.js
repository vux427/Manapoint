// Every way to reach a provider's usage, tried together.
//
// A provider may be signed in through several routes — its own CLI, opencode, a
// multi-account plugin — and some routes may be the same account seen twice. The rule:
//   - try every route at once, in priority order;
//   - a route that fails is ignored as long as ANY route returned data;
//   - readings that describe the same account are one account (see sameAccount);
//   - one distinct account → a plain reading, exactly like a single collector;
//     several → each account's windows tagged with its label, one bar group each;
//   - only when every route failed does the card fail, with the first route's reason.

import { asCollectError, notReady } from "./errors.js";
import { usage } from "../providers/model.js";

/** Give every route a distinct, non-empty label, in order. */
export function labelled(routes, fallback) {
  const seen = new Map();
  return routes.map((a, i) => {
    const base = (typeof a.label === "string" && a.label.trim()) || `${fallback} ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...a, label: n === 1 ? base : `${base} #${n}` };
  });
}

/** Windows reduced to what two routes into one account necessarily agree on. */
const fingerprint = (u) =>
  u.windows
    .map((w) => `${w.kind}:${Math.round(w.percent * 10)}:${w.resetsAt ? w.resetsAt.slice(0, 16) : "-"}`)
    .join("|");

/**
 * Same account: the routes say so (an identity both know, such as an account id or
 * email), or — when either cannot tell — the numbers match. Two accounts showing the
 * same percentages AND the same reset minutes is not a coincidence worth designing for.
 */
function sameAccount(a, b) {
  if (a.identity && b.identity) return a.identity === b.identity;
  return fingerprint(a.usage) === fingerprint(b.usage);
}

/**
 * Run every route ({ label, identity?, run: () => usage }) and fold the results.
 * A reading may carry `identity` too, for routes that only learn it while running.
 * `missing` is the NotReady message when there is no route at all.
 */
export async function collectRoutes(provider, routes, missing) {
  if (routes.length === 0) throw notReady(missing);

  const outcomes = await Promise.allSettled(routes.map((r) => r.run()));
  let ok = outcomes
    .map((o, i) => {
      if (o.status !== "fulfilled") return null;
      // A route may learn its identity only while running (usage.identity); it is
      // used here and never travels further — the snapshot holds numbers only.
      const { identity, ...reading } = o.value;
      return { ...routes[i], identity: routes[i].identity ?? identity, usage: reading };
    })
    .filter(Boolean);

  if (ok.length === 0) throw asCollectError(outcomes[0].reason);

  // Numbers beat explanations: a route that only says "no plan here" is dropped
  // whenever another route found real windows.
  if (ok.some((r) => r.usage.windows.length > 0)) ok = ok.filter((r) => r.usage.windows.length > 0);

  const distinct = [];
  for (const r of ok) {
    const twin = distinct.find((d) => sameAccount(d, r));
    if (!twin) distinct.push(r);
    else if (!twin.identity && r.identity) twin.identity = r.identity;
  }

  if (distinct.length === 1) return distinct[0].usage;

  const windows = [];
  const notes = [];
  for (const d of labelled(distinct, "帳號")) {
    windows.push(...d.usage.windows.map((w) => ({ ...w, account: d.label })));
    if (d.usage.note) notes.push(`${d.label}：${d.usage.note}`);
  }
  return usage(provider, windows, Date.now(), notes.join(" / ") || null);
}
