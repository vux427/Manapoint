// Reading and refreshing the Codex CLI login (`tokens` in auth.json).
//
// The refresh follows Codex's own OAuth flow: POST https://auth.openai.com/oauth/token
// with a JSON body of client_id / grant_type / refresh_token, where client_id is
// Codex's public value. The reply carries access_token and the rotated refresh_token
// (plus id_token when present). Both the endpoint and the client id honour Codex's
// own override env vars so test rigs keep working.
//
// Only `tokens` and `last_refresh` are touched — siblings such as OPENAI_API_KEY
// survive. The access token is a JWT: its `exp` drives proactive refresh (five
// minutes early), with `last_refresh` older than eight days as a fallback, mirroring
// the CLI. A failed proactive refresh falls back to the stored token and lets the
// usage endpoint decide; rotation races are handled by re-reading the file.

import { failed, notReady, transient } from "../lib/errors.js";
import { env, exists, readText, replaceText, request } from "../lib/io.js";
import { codexAuth } from "../lib/paths.js";
import { isBlank, isObject, jwtClaims, jwtExp, parseDatetime, str } from "../lib/values.js";

/** Codex's public OAuth client. Embedded in the open-source CLI; not a secret. */
export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CLIENT_ID_OVERRIDE = "CODEX_APP_SERVER_LOGIN_CLIENT_ID";
const TOKEN_URL_OVERRIDE = "CODEX_REFRESH_TOKEN_URL_OVERRIDE";

export const REFRESH_SKEW_MS = 300_000;
/** The CLI treats a session untouched for this long as stale even if the JWT parses. */
const STALE_AFTER_MS = 8 * 86_400_000;

const EXPIRED = "登入已過期，請重新執行 codex 登入";

const override = (name, fallback) => str(env(name))?.trim() ?? fallback;
export const oauthClientId = () => override(CLIENT_ID_OVERRIDE, CLIENT_ID);

const pair = (e) => ({ access: e.access, accountId: e.accountId });

/** Usable credentials, refreshing and persisting first when the token is spent or stale. */
export async function credentials() {
  const path = codexAuth();
  if (!(await exists(path))) throw notReady("找不到 Codex CLI，請先安裝並登入");

  const entry = await readEntry(path);
  if (!entry) throw notReady("尚未登入，請執行 codex 登入");
  if (isBlank(entry.accountId)) throw notReady("登入資料不完整，請重新執行 codex 登入");
  if (!needsRefresh(entry, Date.now()) || isBlank(entry.refresh)) return pair(entry);

  try {
    const refreshed = await refreshOnce(entry);
    await persist(path, refreshed);
    return pair(refreshed);
  } catch {
    return (await raceWinner(path, entry)) ?? pair(entry);
  }
}

/** Force a refresh after the usage endpoint answered 401/403 for `failedAccess`. */
export async function refreshForRetry(failedAccess) {
  const path = codexAuth();
  const entry = await readEntry(path);
  if (!entry) throw notReady("尚未登入，請執行 codex 登入");

  // Codex itself may already have rotated the file after we read it.
  if (entry.access !== failedAccess && !needsRefresh(entry, Date.now())) return pair(entry);
  if (isBlank(entry.refresh)) throw notReady(EXPIRED);

  try {
    const refreshed = await refreshOnce(entry);
    await persist(path, refreshed);
    return pair(refreshed);
  } catch (err) {
    if (err.kind === "Transient") throw err;
    const winner = await raceWinner(path, entry);
    if (winner) return winner;
    throw notReady(EXPIRED);
  }
}

async function raceWinner(path, entry) {
  const latest = await readEntry(path);
  if (latest && latest.access !== entry.access && !needsRefresh(latest, Date.now())) {
    return pair(latest);
  }
  return null;
}

/** A spent JWT, or a session untouched for over a week, means refresh. With neither
 * signal the token is used as-is and the endpoint decides. */
export function needsRefresh(entry, now) {
  if (isBlank(entry.access)) return true;
  const exp = jwtExp(entry.access);
  if (exp !== null) return exp * 1000 <= now + REFRESH_SKEW_MS;
  if (entry.lastRefreshMs !== null) return entry.lastRefreshMs < now - STALE_AFTER_MS;
  return false;
}

/** One refresh for any Codex/ChatGPT login (the CLI's, or one opencode holds — same
 * public client) → { access, refresh, expiresMs }. */
export async function refreshToken(refresh) {
  const e = await refreshOnce({ access: "", refresh, idToken: "", accountId: "", lastRefreshMs: null });
  const exp = jwtExp(e.access);
  return { access: e.access, refresh: e.refresh, expiresMs: exp ? exp * 1000 : Date.now() + 3_600_000 };
}

/** The ChatGPT account id the usage endpoint wants, from the login or the JWT. */
export function accountIdOf(access, stored) {
  if (typeof stored === "string" && stored.trim()) return stored;
  const id = jwtClaims(access)?.["https://api.openai.com/auth"]?.chatgpt_account_id;
  return typeof id === "string" ? id : "";
}

async function refreshOnce(old) {
  let res;
  try {
    res = await request(override(TOKEN_URL_OVERRIDE, TOKEN_URL), {
      method: "POST",
      json: { client_id: oauthClientId(), grant_type: "refresh_token", refresh_token: old.refresh },
    });
  } catch (err) {
    throw transient(`Codex 換發連線失敗，稍後自動重試（${err.message}）`);
  }
  if (res.status === 400 || res.status === 401) throw notReady(EXPIRED);
  if (res.status < 200 || res.status >= 300) throw transient("Codex 換發失敗，稍後自動重試");
  return applyRefresh(old, res.text, Date.now());
}

/** Tokens absent from the reply keep their old values (the CLI persists only what the
 * response contains); the account id is not part of the reply and always survives. */
export function applyRefresh(old, responseJson, now) {
  let root;
  try {
    root = JSON.parse(responseJson);
  } catch (err) {
    throw transient(`Codex 換發回應異常，稍後自動重試（${err.message}）`);
  }
  const access = str(root?.access_token) ?? str(old.access);
  if (!access) throw transient("Codex 換發回應缺少 access_token，稍後自動重試");
  return {
    access,
    refresh: str(root.refresh_token) ?? old.refresh,
    idToken: str(root.id_token) ?? old.idToken,
    accountId: old.accountId,
    lastRefreshMs: now,
  };
}

/** Merge refreshed tokens back, touching only `tokens` and `last_refresh`. */
export function mergeEntry(originalFileJson, updated) {
  const root = JSON.parse(originalFileJson);
  if (!isObject(root)) throw failed("Codex 憑證檔的最外層不是物件。");
  const tokens = isObject(root.tokens) ? { ...root.tokens } : {};
  if (!isBlank(updated.access)) tokens.access_token = updated.access;
  if (!isBlank(updated.refresh)) tokens.refresh_token = updated.refresh;
  if (!isBlank(updated.idToken)) tokens.id_token = updated.idToken;
  if (!isBlank(updated.accountId)) tokens.account_id = updated.accountId;
  root.tokens = tokens;
  root.last_refresh = new Date(updated.lastRefreshMs ?? Date.now()).toISOString();
  return JSON.stringify(root, null, 2);
}

export function parseEntry(root) {
  const t = isObject(root) ? root.tokens : null;
  if (!isObject(t)) return null;
  const access = str(t.access_token);
  if (!access) return null;
  const s = (v) => (typeof v === "string" ? v : "");
  return {
    access,
    refresh: s(t.refresh_token),
    idToken: s(t.id_token),
    accountId: s(t.account_id),
    lastRefreshMs: parseDatetime(root.last_refresh),
  };
}

async function readEntry(path) {
  const text = await readText(path);
  if (text === null) return null;
  try {
    return parseEntry(JSON.parse(text));
  } catch {
    return null;
  }
}

async function persist(path, updated) {
  // Re-read first: Codex may have written its own refresh while we did ours.
  const latest = await readText(path);
  if (latest === null) return;
  try {
    await replaceText(path, mergeEntry(latest, updated));
  } catch {
    // Unreadable file stays untouched; the fresh token is in memory for this round.
  }
}
