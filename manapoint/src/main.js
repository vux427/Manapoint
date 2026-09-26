// Manapoint backend: providers, settings, the usage snapshot and the polling loop.
//
// The page calls these through tiny.api.call; the shapes are frozen in CONTRACT.md.
// Window geometry, the tray and menus live in the panel page itself (tiny.win,
// tiny.tray, tiny.menu), so this side never has to know where the panel is.

import * as cache from "./lib/cache.js";
import * as cards from "./lib/cards.js";
import { env, readText, setSpawner } from "./lib/io.js";
import * as settingsFile from "./lib/settings.js";
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
};

/** Settings and the snapshot load as soon as the module does; every handler waits
 * for them, because the page may ask before init() has run. */
const ready = (async () => {
  state.settings = await settingsFile.load();
  state.lastGood = await cache.load();
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

function pushCards() {
  state.app?.push("cards", state.cards);
}

async function collectAll() {
  if (state.fixture) return state.cards;
  const providers = registry.enabled(state.settings);
  // Fire all providers at once; each is independent, and sequential round trips
  // would make a cold start visibly slower.
  const outcomes = await Promise.allSettled(providers.map((p) => p.collect()));
  state.cards = cards.fromOutcomes(providers, outcomes, state.lastGood);
  await cache.save(state.lastGood);
  return state.cards;
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
    };
  },

  get_cards: () => state.cards,
  refresh: () => refresh(),

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

export async function init(app) {
  state.app = app;
  setSpawner((argv, opts) => app.spawnHidden(argv, opts));
  await ready;
  pushCards();

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
