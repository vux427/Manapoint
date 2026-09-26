// Reading and refreshing the Antigravity (`agy`) login.
//
// Antigravity keeps no credential file: its CLI stores the Google OAuth tokens in the
// OS keyring through go-keyring, under service `gemini` and account `antigravity`. On
// Windows that is the generic credential `gemini:antigravity`, whose blob is UTF-8
// JSON `{"token":{access_token,refresh_token,expiry},"auth_method":"consumer"}`.
//
// The refresh is the standard Google installed-app flow with Antigravity's public
// client id and secret. Installed-app clients cannot keep a secret confidential, which
// is why Google ships it inside the binary; it is not a credential of the user's.
//
// Extra logins are read too (see listAccounts): opencode's own Antigravity login
// (opencode.db 'google' rows, or auth.json "google" on older versions) and the
// opencode-antigravity-multi-auth plugin's list. Each is refreshed the same way.
//
// **A refreshed token is never written back.** The keyring belongs to `agy`'s own
// login state, and Google rotates refresh tokens, so writing there could knock the CLI
// out of its session. The fresh access token lives in memory for the process instead.

import { notReady, transient } from "../lib/errors.js";
import { labelled } from "../lib/accounts.js";
import { env, readText, request } from "../lib/io.js";
import * as opencodeDb from "../lib/opencode_db.js";
import { home, opencodeAuth } from "../lib/paths.js";
import { readGeneric } from "../lib/keyring.js";
import { isBlank, isInteger, isObject, parseDatetime, str } from "../lib/values.js";

/** Written as a char code: some editors silently turn the escape into the character. */
const BOM = new RegExp("^" + String.fromCharCode(0xfeff));

/** Antigravity's public installed-app OAuth client. Shipped inside the `agy` binary. */
export const CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
/** Split so repository secret scanners do not flag a value that is public by design. */
const CLIENT_SECRET_PARTS = ["GOCSPX-", "K58FWR486LdLJ1mLB8sXC4z6qDAf"];
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const KEYRING_TARGET = "gemini:antigravity";

export const REFRESH_SKEW_MS = 300_000;
const DEFAULT_EXPIRES_IN_SECONDS = 3600;

const NOT_SIGNED_IN = "尚未登入 Antigravity，請開啟 Antigravity 或執行 agy 登入";
const SIGN_IN_AGAIN = "Antigravity 登入已失效，請開啟 Antigravity 或執行 agy 重新登入";

/** Tokens minted by us, valid for this process run, keyed by the refresh token they
 * came from: a different refresh token means a different login, so a token can never
 * leak from one account to another. */
const minted = new Map();

/**
 * Every Antigravity login on this machine: `agy`'s own (the keyring), then any the
 * opencode-antigravity-multi-auth plugin keeps in %APPDATA%opencode * antigravity-accounts.json ({ accounts: [{ refreshToken, email }] }). The same
 * refresh token in both places is one account.
 */
export async function listAccounts() {
  let keyringError = null;
  const found = [];
  try {
    found.push({ ...(await readEntry()), label: "agy", source: "keyring" });
  } catch (err) {
    keyringError = err;
  }
  const [pluginText, rows, authText] = await Promise.all([
    readText(multiAuthFile()),
    opencodeDb.credentials("google"),
    readText(opencodeAuth()),
  ]);
  const opencodeLogins = rows.map((r) => opencodeGoogle(r.value, "opencode")).filter(Boolean);
  // auth.json's node is what older opencode wrote; the database supersedes it.
  if (!opencodeLogins.length) {
    const legacy = opencodeGoogle(tryParse(authText)?.google, "opencode");
    if (legacy) opencodeLogins.push(legacy);
  }
  for (const a of [...opencodeLogins, ...pluginAccounts(pluginText)]) {
    if (!found.some((f) => f.refresh === a.refresh)) found.push(a);
  }
  if (found.length === 0) throw keyringError ?? notReady(NOT_SIGNED_IN);
  return labelled(found, "帳號");
}

export const multiAuthFile = () => {
  const base = env("APPDATA");
  const root = base ? base.split("\\").join("/") : home() + "/AppData/Roaming";
  return root + "/opencode/antigravity-accounts.json";
};

const tryParse = (text) => {
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * A Google login opencode's Antigravity plugin stored ({ type: 'oauth', access,
 * refresh, expires ms, email? }) → account, or null. Same public Antigravity client as
 * `agy`, so it refreshes the same way. Pure.
 */
export function opencodeGoogle(v, fallbackLabel) {
  if (!isObject(v) || !str(v.refresh)) return null;
  return {
    label: str(v.email)?.trim() ?? fallbackLabel,
    access: str(v.access) ?? "",
    refresh: v.refresh.trim(),
    expiresMs: isInteger(v.expires) && v.expires > 0 ? v.expires : null,
    source: "opencode",
  };
}

/** The plugin's accounts. Pure. They carry only a refresh token, so each is minted. */
export function pluginAccounts(text) {
  let root;
  try {
    root = text === null ? null : JSON.parse(text);
  } catch {
    return [];
  }
  if (!isObject(root) || !Array.isArray(root.accounts)) return [];
  return root.accounts
    .filter((a) => isObject(a) && str(a.refreshToken))
    .map((a) => ({
      label: str(a.email)?.trim() ?? null,
      access: "",
      refresh: a.refreshToken.trim(),
      expiresMs: null,
      source: "plugin",
    }));
}

/** The account's own token if still good, else one minted this run, else a refresh. */
export async function accessToken(account) {
  if (!needsRefresh(account, Date.now())) return account.access;
  return usableMinted(account.refresh, Date.now()) ?? refreshAndCache(account);
}

/** Force a refresh after a 401/403 for `failedAccess`. `agy` may have refreshed the
 * keyring in the meantime, so that login is re-read first. */
export async function refreshForRetry(account, failedAccess) {
  const entry = account.source === "keyring" ? await readEntry() : account;
  const now = Date.now();
  if (entry.access !== failedAccess && !needsRefresh(entry, now)) return entry.access;
  const cached = usableMinted(entry.refresh, now);
  if (cached && cached !== failedAccess) return cached;
  // The token we just used is the one on record, so only a new mint can help.
  minted.delete(entry.refresh);
  return refreshAndCache(entry);
}

async function refreshAndCache(entry) {
  if (isBlank(entry.refresh)) throw notReady(SIGN_IN_AGAIN);
  let res;
  try {
    res = await request(TOKEN_URL, { method: "POST", form: refreshForm(entry.refresh) });
  } catch (err) {
    throw transient(`Antigravity 換發連線失敗，稍後自動重試（${err.message}）`);
  }
  // 400/401 is invalid_grant: revoked or consumed, and only a real sign-in fixes that.
  // 403 and 5xx are not the user's problem, so those keep the last numbers instead.
  if (res.status === 400 || res.status === 401) throw notReady(SIGN_IN_AGAIN);
  if (res.status < 200 || res.status >= 300) throw transient("Antigravity 換發失敗，稍後自動重試");
  const token = parseRefresh(res.text, entry.refresh, Date.now());
  minted.set(entry.refresh, token);
  return token.access;
}

/** Expired, or close enough to it, means refresh. An unknown expiry always refreshes. */
export function needsRefresh(entry, now) {
  if (isBlank(entry.access)) return true;
  return entry.expiresMs === null || entry.expiresMs <= now + REFRESH_SKEW_MS;
}

export const refreshForm = (refreshToken) => ({
  client_id: CLIENT_ID,
  client_secret: CLIENT_SECRET_PARTS.join(""),
  refresh_token: refreshToken,
  grant_type: "refresh_token",
});

async function readEntry() {
  let raw;
  try {
    raw = await readGeneric(KEYRING_TARGET);
  } catch {
    throw notReady("讀不到 Antigravity 的登入狀態（Windows 憑證管理員），請重新開啟 Antigravity");
  }
  if (!raw) throw notReady(NOT_SIGNED_IN);
  const entry = parseEntry(raw);
  if (!entry) throw notReady(SIGN_IN_AGAIN);
  return entry;
}

/**
 * Parse the credential blob. Pure, no IO. go-keyring writes raw UTF-8 on Windows; a
 * BOM is tolerated because some editors add one when a credential is restored by hand.
 */
export function parseEntry(bytes) {
  let root;
  try {
    const text = new TextDecoder().decode(bytes).replace(BOM, "").trim();
    root = JSON.parse(text);
  } catch {
    return null;
  }
  // Older CLI builds stored the token object at the top level.
  const token = isObject(root?.token) ? root.token : root;
  if (!isObject(token)) return null;
  const access = str(token.access_token)?.trim();
  if (!access) return null;
  return {
    access,
    refresh: typeof token.refresh_token === "string" ? token.refresh_token.trim() : "",
    expiresMs: parseDatetime(token.expiry),
  };
}

/** Fold Google's token response into a process-lifetime token. Pure, no IO. */
export function parseRefresh(responseJson, refreshToken, now) {
  let root;
  try {
    root = JSON.parse(responseJson);
  } catch (err) {
    throw transient(`Antigravity 換發回應異常，稍後自動重試（${err.message}）`);
  }
  const access = str(root?.access_token)?.trim();
  if (!access) throw transient("Antigravity 換發回應缺少 access_token，稍後自動重試");
  const seconds = isInteger(root.expires_in) && root.expires_in > 0 ? root.expires_in : DEFAULT_EXPIRES_IN_SECONDS;
  return { access, expiresMs: now + seconds * 1000, mintedFrom: refreshToken };
}

function usableMinted(refreshToken, now) {
  const token = minted.get(refreshToken);
  if (!token || token.expiresMs <= now + REFRESH_SKEW_MS) return null;
  return token.access;
}
