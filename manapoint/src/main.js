// Manapoint backend: providers, settings, the usage snapshot and the polling loop.
//
// The page calls these through tiny.api.call; the shapes are frozen in CONTRACT.md.
// Window geometry, the tray and menus live in the panel page itself (tiny.win,
// tiny.tray, tiny.menu), so this side never has to know where the panel is.

import { alertsFor, notification } from "./lib/alerts.js";
import * as cache from "./lib/cache.js";
import * as cards from "./lib/cards.js";
import { env, readText, setSpawner } from "./lib/io.js";
import * as localApi from "./lib/local_api.js";
import * as relaunch from "./lib/relaunch.js";
import * as settingsFile from "./lib/settings.js";
import * as trend from "./lib/trend.js";
import * as registry from "./providers/registry.js";

/** Matches the token refresh skew, so a token that expires between polls is renewed
 * before the next request goes out. */
const REFRESH_INTERVAL_MS = 300_000;

const state = {
  settings: settingsFile.defaults(),
  cards: [],
  /** Last successful reading per card: a transient failure keeps showing these. */
  lastGood: {},
  app: null,
  /** One round at a time: a manual refresh during a poll joins it, not doubles it. */
  round: null,
  /** Cards from MANAPOINT_FIXTURE, if set; see loadFixture. */
  fixture: null,
  /** Recent percent samples per window, for the burn-rate projection. */
  history: {},
  /** { current, latest, notes } once a newer release is known, else null. */
  update: null,
};

/** Settings and the snapshot load as soon as the module does; every handler waits
 * for them, because the page may ask before init() has run. */
const ready = (async () => {
  state.settings = await settingsFile.load();
  state.lastGood = await cache.load();
  state.history = await trend.load();
  state.cards = cards.seed(registry.enabled(state.settings), state.lastGood);
  state.fixture = await loadFixture();
  if (state.fixture) state.cards = state.fixture;
})();

/**
 * MANAPOINT_FIXTURE=<path to a CardState[] json> serves those cards and never polls —
 * for screenshots and layout work without touching any real account.
 */
async function loadFixture() {
  const path = env("MANAPOINT_FIXTURE");
  if (!path) return null;
  const text = await readText(path);
  if (text === null) throw new Error(`MANAPOINT_FIXTURE not readable: ${path}`);
  return JSON.parse(text);
}

/** Cards as the page sees them: the stored ones plus the burn-rate projection. */
const view = () => trend.annotate(state.cards, state.history, Date.now());

function pushCards() {
  state.app?.push("cards", view());
}

async function collectAll() {
  if (state.fixture) return state.cards;
  const providers = registry.enabled(state.settings);
  // Fire all providers at once; each is independent, and sequential round trips
  // would make a cold start visibly slower.
  const outcomes = await Promise.allSettled(providers.map((p) => p.collect()));
  // fromOutcomes replaces snapshot entries rather than editing them, so a shallow copy
  // keeps the previous readings to compare against.
  const before = { ...state.lastGood };
  state.cards = cards.fromOutcomes(providers, outcomes, state.lastGood);
  noteFreshReadings(providers, outcomes, before);
  await Promise.all([cache.save(state.lastGood), trend.save(state.history)]);
  return state.cards;
}

/** Feed fresh numbers (not cached ones) to the trend history and the alerts. */
function noteFreshReadings(providers, outcomes, before) {
  const now = Date.now();
  const lines = [];
  providers.forEach((p, i) => {
    const o = outcomes[i];
    if (o.status !== "fulfilled" || o.value.windows.length === 0) return;
    for (const w of o.value.windows) trend.record(state.history, trend.windowKey(p.id, w), now, w.percent);
    lines.push(...alertsFor(p.name, before[p.id]?.windows, o.value.windows));
  });
  trend.prune(state.history, now);
  const note = state.settings.alerts ? notification(lines) : null;
  if (note) state.app?.notify(note);
}

function refresh() {
  state.round ??= collectAll().finally(() => {
    state.round = null;
  });
  return state.round;
}

async function kickRefresh() {
  await refresh();
  pushCards();
}

/** Mutate, persist, and hand the result to every window in one step — the settings
 * window and the panel must never disagree about what is stored. */
async function updateSettings(edit) {
  const next = { ...state.settings };
  edit(next);
  state.settings = settingsFile.normalize(next);
  await settingsFile.save(state.settings);
  state.app?.push("settings", state.settings);
  return state.settings;
}

function restack() {
  const result = cards.restack(registry.enabled(state.settings), state.cards, state.lastGood);
  state.cards = result.cards;
  pushCards();
  return result.incomplete;
}

async function autoStart() {
  try {
    const status = await state.app.launchAtLogin.get();
    return { enabled: status === "enabled", supported: status !== "unsupported" };
  } catch {
    return { enabled: false, supported: false };
  }
}

const handlers = {
  async get_state() {
    const login = await autoStart();
    return {
      settings: state.settings,
      providers: registry.inOrder(state.settings.providerOrder).map(registry.descriptor),
      autoStart: login.enabled,
      autoStartSupported: login.supported,
      version: state.app?.info?.version ?? null,
      update: state.update,
    };
  },

  get_cards: () => view(),
  refresh: () => refresh().then(view),

  get_update: () => state.update,
  /** A manual check from the settings page; a hit is announced like the daily one. */
  async check_update() {
    const r = await state.app.update.check();
    if (!r.available) return { available: false, current: r.current, latest: r.latest };
    const info = { current: r.current, latest: r.latest, notes: r.notes ?? null };
    state.update = info;
    state.app.push("update", info);
    return { available: true, ...info };
  },
  /** Downloads, verifies the sha256, swaps the files in place and relaunches. */
  async install_update() {
    await relaunch.arm((argv, opts) => state.app.spawnHidden(argv, opts));
    try {
      await state.app.update.install();
    } catch (err) {
      await relaunch.disarm();
      throw err;
    }
    return true;
  },
  set_alerts: ({ enabled }) => updateSettings((s) => (s.alerts = Boolean(enabled))),

  set_theme: ({ name }) => updateSettings((s) => (s.themeName = String(name))),
  set_opacity: ({ value }) => updateSettings((s) => (s.panelOpacity = Number(value))),
  set_layout: ({ layout }) => updateSettings((s) => (s.cardsLayout = layout)),

  async set_provider_enabled({ id, enabled }) {
    const updated = await updateSettings((s) => {
      const ids = (s.enabledProviders ?? registry.defaultEnabled()).filter((x) => x !== id);
      if (enabled) ids.push(id);
      s.enabledProviders = ids;
    });
    // Redraw at once from what is already known, then fetch only if a provider was
    // switched on and has no numbers yet.
    if (restack() && enabled) kickRefresh();
    return updated;
  },

  async set_provider_order({ ids }) {
    const updated = await updateSettings((s) => (s.providerOrder = ids));
    // Presentation only. Re-fetching would cost a round trip per provider (and risk a
    // rate limit) to show the same numbers in a different order.
    restack();
    return updated;
  },

  async set_auto_start({ enabled }) {
    let error = null;
    try {
      await state.app.launchAtLogin.set(Boolean(enabled));
    } catch (err) {
      error = err?.message ?? String(err);
    }
    // Report what the system actually says, not what was asked for.
    return { enabled: (await autoStart()).enabled, error };
  },
};

export const api = Object.fromEntries(
  Object.entries(handlers).map(([name, fn]) => [
    name,
    async (params) => {
      await ready;
      return fn(params ?? {});
    },
  ]),
);

/**
 * tinyjs.json "update": { "auto": "daily" } checks the release manifest at launch and
 * every day after. The menus offer the install; a notification says so once per version.
 */
export async function onUpdateAvailable(info, app) {
  state.update = info;
  app.push("update", info);
  const KEY = "notifiedUpdate";
  try {
    if ((await app.store.get(KEY)) === info.latest) return;
    await app.store.set(KEY, info.latest);
  } catch {}
  app.notify({ title: `Manapoint ${info.latest} 可更新`, body: "在面板上按右鍵，選「更新到 " + info.latest + "」。" });
}

export async function init(app) {
  state.app = app;
  setSpawner((argv, opts) => app.spawnHidden(argv, opts));
  await ready;
  pushCards();
  // Read-only loopback feed for companions (the iCUE LCD widget). It serves
  // whatever the panel shows and never blocks startup when the port is taken.
  localApi.start(view, env, (m) => console.log(m));

  const poll = async () => {
    try {
      await kickRefresh();
    } catch (err) {
      console.error("[manapoint] poll failed:", err?.message ?? err);
    }
    setTimeout(poll, REFRESH_INTERVAL_MS);
  };
  poll();
}
