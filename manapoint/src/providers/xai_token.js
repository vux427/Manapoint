// Reading and refreshing the xAI logins opencode stores.
//
// Current opencode keeps them as `credential` rows (integration 'xai') in opencode.db;
// older versions wrote the "xai" node of auth.json. Every db row is an account; the
// auth.json node is read only when the database has none (newer opencode leaves the
// old file behind, and a months-old login there would only show as a dead account).
//
// The refresh follows opencode's plugin/xai.ts: POST https://auth.x.ai/oauth2/token
// with the public Grok-CLI client_id and form fields grant_type / refresh_token /
// client_id. The reply carries access_token (required), refresh_token (rotated, but
// not sent every time) and expires_in seconds (3600 when absent). Rotated tokens are
// written back to where they came from — only the token fields — because xAI
// invalidates the old refresh token and opencode would otherwise be signed out.

import { failed, notReady, transient } from "../lib/errors.js";
import { labelled } from "../lib/accounts.js";
import { exists, readText, replaceText, request } from "../lib/io.js";
import * as opencodeDb from "../lib/opencode_db.js";
import { opencodeAuth } from "../lib/paths.js";
import { isBlank, isInteger, isObject, str } from "../lib/values.js";

/** The public Grok-CLI OAuth client. Embedded in opencode's open source; not a secret. */
export const CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const TOKEN_URL = "https://auth.x.ai/oauth2/token";
export const REFRESH_SKEW_MS = 300_000;
const DEFAULT_EXPIRES_IN_SECONDS = 3600;

/** Every xAI login, labelled. Each carries where it lives, for re-reads and write-back. */
export async function listAccounts() {
  const rows = await opencodeDb.credentials("xai");
  const fromDb = rows
    .map((r) => {
      const e = parseValue(r.value);
      return e && { ...e, label: r.label, store: { kind: "db", id: r.id } };
    })
    .filter(Boolean);
  if (fromDb.length) return labelled(fromDb, "xAI");

  const path = opencodeAuth();
  const legacy = await readFileEntry(path);
  if (legacy) return [{ ...legacy, label: "xAI", store: { kind: "file", path } }];

  const haveOpencode = (await exists(opencodeDb.dbPath())) || (await exists(path));
  throw notReady(haveOpencode ? "尚未登入 xAI，請在 opencode 登入" : "找不到 opencode，請先安裝並登入 xAI");
}

/** A usable access token for `account`, refreshing and persisting first if spent. */
export async function accessToken(account) {
  if (!needsRefresh(account, Date.now())) return account.access;
  if (isBlank(account.refresh)) throw notReady("xAI 登入已過期，請在 opencode 重新登入");

  let res;
  try {
    res = await request(TOKEN_URL, { method: "POST", form: refreshForm(account.refresh) });
  } catch (err) {
    throw transient(`xAI 換發連線失敗，稍後自動重試（${err.message}）`);
  }

  if (res.status === 400 || res.status === 401) {
    // The refresh token was consumed or revoked — most likely opencode refreshed
    // first. If the winner's token works, use it rather than prompting a login.
    const latest = await reread(account);
    if (latest && latest.access !== account.access && !needsRefresh(latest, Date.now())) {
      return latest.access;
    }
    throw notReady("xAI 登入已失效，請在 opencode 重新登入");
  }
  if (res.status < 200 || res.status >= 300) throw transient("xAI 換發失敗，稍後自動重試");

  const refreshed = applyRefresh(account, res.text, Date.now());
  await persist(account, refreshed);
  Object.assign(account, refreshed); // later calls this round reuse it
  return refreshed.access;
}

/** Expired, or close enough to it, means refresh. A missing expiry always refreshes,
 * which is what opencode itself does. */
export function needsRefresh(entry, now) {
  if (isBlank(entry.access) || !(entry.expiresMs > 0)) return true;
  return entry.expiresMs <= now + REFRESH_SKEW_MS;
}

export const refreshForm = (refreshToken) => ({
  grant_type: "refresh_token",
  refresh_token: refreshToken,
  client_id: CLIENT_ID,
});

/** access_token is required; a missing refresh_token keeps the old one; a missing
 * expires_in counts as 3600 seconds, matching opencode. */
export function applyRefresh(old, responseJson, now) {
  let root;
  try {
    root = JSON.parse(responseJson);
  } catch (err) {
    throw transient(`xAI 換發回應異常，稍後自動重試（${err.message}）`);
  }
  const access = str(root?.access_token);
  if (!access) throw transient("xAI 換發回應缺少 access_token，稍後自動重試");
  const expiresIn = isInteger(root.expires_in) ? Math.max(0, root.expires_in) : DEFAULT_EXPIRES_IN_SECONDS;
  return {
    type: old.type,
    access,
    refresh: str(root.refresh_token) ?? old.refresh,
    expiresMs: now + expiresIn * 1000,
  };
}

/** Merge the entry back into auth.json, touching only the "xai" node. */
export function mergeEntry(originalFileJson, updated) {
  const root = JSON.parse(originalFileJson);
  if (!isObject(root)) throw failed("opencode auth.json 的最外層不是物件。");
  root.xai = {
    ...(isObject(root.xai) ? root.xai : {}),
    type: updated.type,
    access: updated.access,
    refresh: updated.refresh,
    expires: updated.expiresMs,
  };
  return JSON.stringify(root, null, 2);
}

/** One stored login ({ type, access, refresh, expires }) → entry, or null. Pure. */
export function parseValue(v) {
  if (!isObject(v)) return null;
  const access = str(v.access);
  if (!access) return null;
  return {
    type: typeof v.type === "string" ? v.type : "oauth",
    access,
    refresh: typeof v.refresh === "string" ? v.refresh : "",
    expiresMs: isInteger(v.expires) ? v.expires : 0,
  };
}

/** The legacy auth.json shape. Pure. */
export const parseEntry = (root) => parseValue(isObject(root) ? root.xai : null);

async function readFileEntry(path) {
  const text = await readText(path);
  if (text === null) return null;
  try {
    return parseEntry(JSON.parse(text));
  } catch {
    return null;
  }
}

async function reread(account) {
  if (account.store.kind === "file") return readFileEntry(account.store.path);
  const row = (await opencodeDb.credentials("xai")).find((r) => r.id === account.store.id);
  return row ? parseValue(row.value) : null;
}

async function persist(account, updated) {
  if (account.store.kind === "db") {
    await opencodeDb.updateCredential(account.store.id, {
      access: updated.access,
      refresh: updated.refresh,
      expires: updated.expiresMs,
    });
    return;
  }
  // Re-read first: opencode may have written its own refresh while we did ours.
  const latest = await readText(account.store.path);
  if (latest === null) return;
  try {
    await replaceText(account.store.path, mergeEntry(latest, updated));
  } catch {
    // Unreadable file stays untouched; the fresh token is in memory for this round.
  }
}
