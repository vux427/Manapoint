// Every supported provider (CONTRACT.md §1.3). Adding one means registering it here.

import * as antigravity from "./antigravity.js";
import * as claude from "./claude.js";
import * as codex from "./codex.js";
import * as grok from "./grok.js";
import * as opencodeGo from "./opencode_go.js";

/** Google blue, from the Antigravity mark. */
const GOOGLE_BLUE = "#4285F4";
const ON_DARK = "#FFFFFF";
const ON_LIGHT = "#16181C";

const badge = (icon, background, foreground) => ({ icon, text: null, background, foreground });

/**
 * Three brand colours are near-black and are told apart by glyph shape; opencode gets
 * a white ground so the row is not one solid black block, and Antigravity's two cards
 * share one mark because they are one subscription with two independent quota pools.
 */
const PROVIDERS = [
  {
    id: "opencode-go",
    name: "opencode Go",
    credentialHint: "opencode CLI 登入狀態",
    badge: badge("OpenCode", "#F2F2F2", ON_LIGHT),
    collect: opencodeGo.collect,
  },
  {
    id: "claude-code",
    name: "Claude Code",
    credentialHint: "Claude Code 登入狀態",
    badge: badge("Claude", "#D97757", ON_DARK),
    collect: claude.collect,
  },
  {
    id: "codex",
    name: "Codex",
    credentialHint: "Codex CLI 登入狀態",
    badge: badge("OpenAI", "#000000", ON_DARK),
    collect: codex.collect,
  },
  {
    id: "grok",
    name: "Grok",
    credentialHint: "opencode 的 xAI 登入",
    badge: badge("Grok", "#1A1A1A", ON_DARK),
    collect: grok.collect,
  },
  {
    id: "antigravity-gemini",
    name: antigravity.GEMINI_NAME,
    credentialHint: "Antigravity 登入狀態",
    badge: badge("Antigravity", GOOGLE_BLUE, ON_DARK),
    collect: () => antigravity.collect(antigravity.POOLS.gemini),
  },
  {
    id: "antigravity-3p",
    name: antigravity.THIRD_PARTY_NAME,
    credentialHint: "Antigravity 登入狀態",
    badge: badge("Antigravity", GOOGLE_BLUE, ON_DARK),
    collect: () => antigravity.collect(antigravity.POOLS.thirdParty),
  },
];

/** The wire shape: everything but the collector. */
export const descriptor = ({ id, name, credentialHint, badge }) => ({ id, name, credentialHint, badge });

export const all = () => PROVIDERS;
export const byId = (id) => PROVIDERS.find((p) => p.id === id) ?? null;

/** Everything is on until the user says otherwise. */
export const defaultEnabled = () => PROVIDERS.map((p) => p.id);

/** All providers in the user's order. Anything the stored order does not mention (a
 * newly added provider) goes last; ids that no longer exist are skipped. */
export function inOrder(order) {
  if (!order) return [...PROVIDERS];
  const listed = order.map(byId).filter(Boolean);
  return [...listed, ...PROVIDERS.filter((p) => !listed.includes(p))];
}

/** Providers the user has ticked, in the order they arranged them. */
export function enabled(settings) {
  const on = settings.enabledProviders ?? defaultEnabled();
  return inOrder(settings.providerOrder).filter((p) => on.includes(p.id));
}
