// OAuth logins that opencode holds for other vendors (anthropic, openai, xai,
// google…), as extra routes to the same usage endpoints the vendors' own CLIs use.
//
// Sources, newest first: opencode.db `credential` rows for the integration, then the
// matching node of auth.json (older opencode). The same refresh token in both is one
// login. A refreshed token is written back to where it came from — only the token
// fields — because these vendors rotate refresh tokens and opencode would otherwise be
// signed out.

import { failed } from "./errors.js";
import { readText, replaceText } from "./io.js";
import * as opencodeDb from "./opencode_db.js";
import { opencodeAuth } from "./paths.js";
import { isBlank, isInteger, isObject, str } from "./values.js";

export const REFRESH_SKEW_MS = 300_000;

/** { type:'oauth', access, refresh, expires, accountId?, … } → login fields, or null. */
export function parseLogin(v) {
  if (!isObject(v) || (v.type && v.type !== "oauth")) return null;
  const access = str(v.access);
  if (!access && !str(v.refresh)) return null;
  return {
    access: access ?? "",
    refresh: typeof v.refresh === "string" ? v.refresh : "",
    expiresMs: isInteger(v.expires) ? v.expires : 0,
    extra: v,
  };
}

/** Every opencode login for `integration`, each with its store. */
export async function opencodeLogins(integration) {
  const found = [];
  for (const row of await opencodeDb.credentials(integration)) {
    const login = parseLogin(row.value);
    if (login) found.push({ ...login, label: row.label, store: { kind: "db", id: row.id } });
  }
  const path = opencodeAuth();
  const text = await readText(path);
  if (text !== null) {
    try {
      const login = parseLogin(JSON.parse(text)?.[integration]);
      if (login && !found.some((f) => f.refresh && f.refresh === login.refresh)) {
        found.push({ ...login, label: null, store: { kind: "file", path, node: integration } });
      }
    } catch {
      // an unreadable auth.json is simply not a source
    }
  }
  return found;
}

export const needsRefresh = (login, now) =>
  isBlank(login.access) || !(login.expiresMs > 0) || login.expiresMs <= now + REFRESH_SKEW_MS;

/**
 * A usable access token for `login`. `refresh(refreshToken)` performs the vendor's
 * refresh and returns { access, refresh?, expiresMs } (or throws a CollectError).
 */
export async function freshToken(login, refresh) {
  if (!needsRefresh(login, Date.now())) return login.access;
  if (isBlank(login.refresh)) return login.access; // nothing to refresh with; let the endpoint judge
  const next = await refresh(login.refresh);
  const updated = { access: next.access, refresh: next.refresh || login.refresh, expiresMs: next.expiresMs };
  await persist(login.store, updated);
  Object.assign(login, updated); // later calls this round reuse it
  return updated.access;
}

/** Merge tokens into one auth.json node, leaving everything else as it was. Pure. */
export function mergeNode(originalFileJson, node, updated) {
  const root = JSON.parse(originalFileJson);
  if (!isObject(root)) throw failed("opencode auth.json 的最外層不是物件。");
  root[node] = {
    ...(isObject(root[node]) ? root[node] : {}),
    access: updated.access,
    refresh: updated.refresh,
    expires: updated.expiresMs,
  };
  return JSON.stringify(root, null, 2);
}

async function persist(store, updated) {
  if (store.kind === "db") {
    await opencodeDb.updateCredential(store.id, {
      access: updated.access,
      refresh: updated.refresh,
      expires: updated.expiresMs,
    });
    return;
  }
  // Re-read first: opencode may have written its own refresh while we did ours.
  const latest = await readText(store.path);
  if (latest === null) return;
  try {
    await replaceText(store.path, mergeNode(latest, store.node, updated));
  } catch {
    // Unreadable file stays untouched; the fresh token is in memory for this round.
  }
}
