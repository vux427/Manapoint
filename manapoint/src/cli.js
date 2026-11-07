// Manapoint headless: one polling round, printed as JSON on stdout, then exit.
//
// For companions that cannot host the panel, chiefly the Herdr desktop mod
// (herdr-mod/): it runs this when no Manapoint app answers on the loopback feed.
//
//   tjs run src/cli.js [--deadline <ms>]
//   manapoint-cli.exe   [--deadline <ms>]      (tjs compile of the bundle)
//
// Shares everything with the app: the same settings (enabled providers, order,
// window visibility), the same last-good snapshot and trend history, written back
// the same way, so the app and this round never disagree about what was last seen.
// Output is credential-free like the snapshot: percentages, reset times, messages.
//
// stdout carries exactly one line of JSON (fullPayload of local_api.js plus
// `alerts`, `source: "cli"`); diagnostics go to stderr.

import { alertsFor } from "./lib/alerts.js";
import * as cache from "./lib/cache.js";
import * as cards from "./lib/cards.js";
import { transient } from "./lib/errors.js";
import { fullPayload } from "./lib/local_api.js";
import * as settingsFile from "./lib/settings.js";
import * as trend from "./lib/trend.js";
import * as usageHistory from "./lib/usage_history.js";
import * as registry from "./providers/registry.js";

/** Callers such as Herdr's exec stop waiting at 30 s; finish well before that. */
const DEFAULT_DEADLINE_MS = 25_000;

function deadlineFrom(argv) {
  const at = argv.indexOf("--deadline");
  const raw = at >= 0 ? Number(argv[at + 1]) : NaN;
  return Number.isInteger(raw) && raw >= 1000 && raw <= 120_000 ? raw : DEFAULT_DEADLINE_MS;
}

/** A provider still out at the deadline reads as a transient failure: its card keeps
 * the last good numbers with a note, exactly like a timed-out request in the app. */
function withDeadline(promise, ms) {
  let timer;
  const late = new Promise((_, reject) => {
    timer = setTimeout(() => reject(transient("連線逾時，顯示上次數字")), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

export async function round({ deadlineMs = DEFAULT_DEADLINE_MS, now = () => Date.now() } = {}) {
  const settings = await settingsFile.load();
  const lastGood = await cache.load();
  const history = await trend.load();
  const providers = registry.enabled(settings);

  const outcomes = await Promise.allSettled(providers.map((p) => withDeadline(Promise.resolve().then(() => p.collect()), deadlineMs)));

  const before = { ...lastGood };
  const stored = cards.fromOutcomes(providers, outcomes, lastGood);

  // Fresh readings only feed the trend and the alerts, as in main.js.
  const t = now();
  const alerts = [];
  providers.forEach((p, i) => {
    const o = outcomes[i];
    if (o.status !== "fulfilled" || o.value.windows.length === 0) return;
    for (const w of o.value.windows) trend.record(history, trend.windowKey(p.id, w), t, w.percent);
    alerts.push(...alertsFor(p.name, before[p.id]?.windows, o.value.windows));
  });
  trend.prune(history, t);
  const sample = usageHistory.snapshot(stored, t);
  const currentHistory = await usageHistory.load(t);
  const prunedHistory = usageHistory.prune([...currentHistory, sample], t);
  await Promise.all([cache.save(lastGood), trend.save(history), usageHistory.save(prunedHistory)]);

  const shown = cards.applyVisibility(stored, settings.visibleWindows);
  return {
    ...fullPayload(shown, t),
    source: "cli",
    alerts: settings.alerts ? alerts : [],
  };
}

async function main() {
  const argv = globalThis.tjs?.args ?? [];
  try {
    if (argv.includes("--history")) {
      const h = await usageHistory.load();
      console.log(JSON.stringify({ ok: true, history: h }));
      globalThis.tjs?.exit?.(0);
      return;
    }

    const at = argv.indexOf("--set-enabled-providers");
    if (at >= 0 && argv[at + 1]) {
      const ids = argv[at + 1].split(",").map((s) => s.trim()).filter(Boolean);
      const settings = await settingsFile.load();
      settings.enabledProviders = ids;
      await settingsFile.save(settings);
      console.log(JSON.stringify({ ok: true, enabledProviders: ids }));
      globalThis.tjs?.exit?.(0);
      return;
    }

    const out = await round({ deadlineMs: deadlineFrom(argv) });
    console.log(JSON.stringify(out));
  } catch (err) {
    console.error("[manapoint-cli]", err?.stack ?? err?.message ?? err);
    console.log(JSON.stringify({ app: "manapoint", version: 1, source: "cli", error: String(err?.message ?? err) }));
    globalThis.tjs?.exit?.(1);
  }
  // Pending keep-alive sockets or timers must not hold the caller hostage.
  globalThis.tjs?.exit?.(0);
}

if (globalThis.tjs) main();
