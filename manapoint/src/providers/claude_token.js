// Reading and refreshing the Claude Code login (`claudeAiOauth` in .credentials.json).
//
// The refresh follows Claude Code's own OAuth flow: POST
// https://platform.claude.com/v1/oauth/token with form fields grant_type /
// refresh_token / client_id, where client_id is Claude Code's public value. The reply
// carries access_token (required), refresh_token (rotated when present) and
// expires_in seconds.
//
// Only this machine's own .credentials.json is touched, and only the `claudeAiOauth`
// node — sibling metadata such as scopes or subscriptionType is preserved. A local
// `expiresAt` is a hint, never a verdict: an expired-looking token still gets one
// usage attempt, because the CLI itself may have refreshed concurrently. If a refresh
// loses a race, the file is re-read and the winner's tokens are used.

import { failed, notReady, transient } from "../lib/errors.js";
import { exists, readText, replaceText, requestNoOrigin as request } from "../lib/io.js";
import { claudeCredentials } from "../lib/paths.js";
import { isBlank, isInteger, isObject, str } from "../lib/values.js";

/** Claude Code's public OAuth client. Embedded in open-source tooling; not a secret. */
export const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
export const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";

/** Refresh this far ahead of expiry; polling runs on the same five-minute cadence. */
export const REFRESH_SKEW_MS = 300_000;

const NOT_SIGNED_IN = "尚未登入，請在 Claude Code 執行 /login";
const SIGN_IN_AGAIN = "登入已失效，請在 Claude Code 執行 /login";

/** Hand back a usable access token, refreshing and persisting first if the stored one
 * is spent. A failed proactive refresh falls back to the stored token and lets the
 * usage endpoint be the arbiter, so a stale clock never shows a false "expired". */
export async function accessToken() {
  const path = claudeCredentials();
  if (!(await exists(path))) throw notReady("找不到 Claude Code，請先安裝並執行 /login");

  const entry = await readEntry(path);
  if (!entry) throw notReady(NOT_SIGNED_IN);
  if (!needsRefresh(entry, Date.now()) || isBlank(entry.refresh)) return entry.access;

  try {
    const refreshed = await refreshOnce(entry);
    await persist(path, refreshed);
    return refreshed.access;
  } catch {
    return (await raceWinner(path, entry)) ?? entry.access;
  }
}

/** Force a refresh after the usage endpoint answered 401/403 for `failedAccess`. */
export async function refreshForRetry(failedAccess) {
  const path = claudeCredentials();
  const entry = await readEntry(path);
  if (!entry) throw notReady(NOT_SIGNED_IN);

  // Claude Code (or a previous poll) may already have rotated the file after we read it.
  if (entry.access !== failedAccess && !needsRefresh(entry, Date.now())) return entry.access;
  if (isBlank(entry.refresh)) throw notReady(SIGN_IN_AGAIN);

  try {
    const refreshed = await refreshOnce(entry);
    await persist(path, refreshed);
    return refreshed.access;
  } catch (err) {
    if (err.kind === "Transient") throw err;
    const winner = await raceWinner(path, entry);
    if (winner) return winner;
    throw notReady(SIGN_IN_AGAIN);
  }
}

async function raceWinner(path, entry) {
  const latest = await readEntry(path);
  if (latest && latest.access !== entry.access && !needsRefresh(latest, Date.now())) {
    return latest.access;
  }
  return null;
}

/** Expired, or close enough to it, means refresh. A missing expiry always refreshes. */
export function needsRefresh(entry, now) {
  if (isBlank(entry.access) || !(entry.expiresMs > 0)) return true;
  return entry.expiresMs <= now + REFRESH_SKEW_MS;
}

export const refreshForm = (refreshToken) => ({
  grant_type: "refresh_token",
  refresh_token: refreshToken,
  client_id: CLIENT_ID,
});

/** One refresh for any Claude login (the CLI's, or one opencode holds — same public
 * client) → { access, refresh, expiresMs }. */
export const refreshToken = (refresh) => refreshOnce({ access: "", refresh, expiresMs: 0 });

async function refreshOnce(old) {
  let res;
  try {
    res = await request(TOKEN_URL, {
      method: "POST",
      headers: { "User-Agent": "claude-code/2.0.32" },
      form: refreshForm(old.refresh),
    });
  } catch (err) {
    throw transient(`Claude 換發連線失敗，稍後自動重試（${err.message}）`);
  }
  if (res.status === 400 || res.status === 401) throw notReady(SIGN_IN_AGAIN);
  if (res.status < 200 || res.status >= 300) throw transient("Claude 換發失敗，稍後自動重試");
  return applyRefresh(old, res.text, Date.now());
}

/**
 * Fold the refresh response into the stored entry. access_token is required. A
 * missing refresh_token keeps the old one: under rotation it is already spent, but
 * keeping it means the next 4xx takes the re-read path instead of failing outright. A
 * missing expires_in keeps the old expiry rather than inventing one.
 */
export function applyRefresh(old, responseJson, now) {
  let root;
  try {
    root = JSON.parse(responseJson);
  } catch (err) {
    throw transient(`Claude 換發回應異常，稍後自動重試（${err.message}）`);
  }
  const access = str(root?.access_token);
  if (!access) throw transient("Claude 換發回應缺少 access_token，稍後自動重試");
  const seconds = root.expires_in;
  return {
    access,
    refresh: str(root.refresh_token) ?? old.refresh,
    expiresMs: isInteger(seconds) && seconds > 0 ? now + seconds * 1000 : old.expiresMs,
  };
}

/**
 * Merge refreshed tokens back into the file, touching only the token fields of the
 * `claudeAiOauth` node so sibling metadata and other top-level sections survive.
 */
export function mergeEntry(originalFileJson, updated) {
  const root = JSON.parse(originalFileJson);
  if (!isObject(root)) throw failed("Claude 憑證檔的最外層不是物件。");
  const node = isObject(root.claudeAiOauth) ? { ...root.claudeAiOauth } : {};
  node.accessToken = updated.access;
  node.refreshToken = updated.refresh;
  node.expiresAt = updated.expiresMs;
  // Drop snake_case aliases a third-party tool may have left, so the file keeps a
  // single canonical shape.
  for (const alias of ["access_token", "refresh_token", "expires_at"]) delete node[alias];
  root.claudeAiOauth = node;
  return JSON.stringify(root, null, 2);
}

/** Accepts both camelCase (what Claude Code writes) and snake_case keys. */
export function parseEntry(root) {
  const o = isObject(root) ? root.claudeAiOauth : null;
  if (!isObject(o)) return null;
  const access = str(o.accessToken ?? o.access_token);
  if (!access) return null;
  const refresh = o.refreshToken ?? o.refresh_token;
  const expires = o.expiresAt ?? o.expires_at;
  return {
    access,
    refresh: typeof refresh === "string" ? refresh : "",
    expiresMs: isInteger(expires) ? expires : 0,
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
  // Re-read first: Claude Code may have written its own refresh while we did ours.
  const latest = await readText(path);
  if (latest === null) return;
  try {
    await replaceText(path, mergeEntry(latest, updated));
  } catch {
    // An unreadable file stays untouched; the fresh token is in memory for this round.
  }
}
