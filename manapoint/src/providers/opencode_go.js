// opencode Go's rolling, weekly and monthly windows, for every opencode account on
// this machine.
//
// Uses keys the opencode tooling already stores; this app never asks for one:
//   - auth.json "opencode-go"  — `opencode auth login` → OpenCode Go
//   - auth.json "opencode"     — `opencode auth login` → OpenCode (Zen / console key).
//     Same key table as Go on the server, so it answers /zen/go/v1/usage too; a
//     workspace without a Go subscription gets 403, shown as a note, not an error.
//   - opencode.db credential rows for integration 'opencode' — the console login
//     (OpenCode Console account, device-code OAuth) or a service-account key. Console
//     workspaces are served by the inference gateway, not /zen: GET {server}/api/config
//     names it (provider["opencode-go"].api, e.g. https://opencode.ai/inference/go/
//     openai/v1) and the headers to send (x-opencode-org-id); its apiKey is only the
//     template "{env:OPENCODE_CONSOLE_TOKEN}", i.e. the console access token itself.
//     Usage is then GET {inference}/go/v1/usage with that token (verified 2026-09-26).
//     A spent console token is refreshed at {server}/auth/device/token and written
//     back to its row.
//   - ~/.config/opencode/opencode-go-accounts.json — the opencode-go-multi-auth
//     plugin's own list ({ accounts: [{ apiKey, label, enabled }] }).
// The same key found in several places is one account.

import { failed, notReady, parseJson, statusError, transient } from "../lib/errors.js";
import { collectRoutes, labelled } from "../lib/accounts.js";
import { exists, readText, request } from "../lib/io.js";
import * as opencodeDb from "../lib/opencode_db.js";
import { home, opencodeAuth } from "../lib/paths.js";
import { isInteger, isObject, iso, number, parseDatetime, str } from "../lib/values.js";
import { MONTHLY, ROLLING, WEEKLY, usage, usageWindow } from "./model.js";

export const PROVIDER_NAME = "opencode Go";
const USAGE_URL = "https://opencode.ai/zen/go/v1/usage";
export const multiAuthFile = () => home() + "/.config/opencode/opencode-go-accounts.json";

const WINDOW_MAP = [
  ["rolling", ROLLING],
  ["weekly", WEEKLY],
  ["monthly", MONTHLY],
];

export async function collect() {
  const accounts = await readAccounts();
  const routes = accounts.map((a) => ({ label: a.label, run: () => collectOne(a) }));
  return collectRoutes(PROVIDER_NAME, routes, "尚未登入 opencode Go 或 opencode（Zen／console）");
}

async function collectOne({ key, headers, url }) {
  const res = await request(url ?? USAGE_URL, { headers: { ...headers, Authorization: `Bearer ${key}` } });
  // The key is valid but its workspace has no Go plan (typical for a Zen-only key).
  if (res.status === 403) return usage(PROVIDER_NAME, [], Date.now(), "此帳號沒有 Go 訂閱");
  if (res.status === 401) throw notReady("金鑰已失效，請在 opencode 重新登入");
  if (res.status < 200 || res.status >= 300) throw statusError(res.status, res.text);
  return parse(res.text, Date.now());
}

/** Parse `GET /zen/go/v1/usage`. A shape mismatch is an error, not something to paper over. */
export function parse(json, collectedAt) {
  const root = parseJson(json);
  const u = isObject(root) ? root.usage : null;
  if (!isObject(u)) throw failed("opencode Go usage 回應缺少 'usage' 欄位。");

  const windows = WINDOW_MAP.map(([key, kind]) => {
    const w = u[key];
    if (!isObject(w)) throw failed(`opencode Go usage 回應缺少 '${key}' 窗口。`);
    const resetsAt = parseDatetime(w.resetsAt);
    if (resetsAt === null) throw failed(`opencode Go usage 的 '${key}' 缺少 resetsAt。`);
    return usageWindow(kind, number(w, "percent", "opencode Go usage"), iso(resetsAt));
  });
  return usage(PROVIDER_NAME, windows, collectedAt);
}

const tryJson = (text) => {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined; // present but unreadable
  }
};

async function readAccounts() {
  const [authText, pluginText, rows] = await Promise.all([
    readText(opencodeAuth()),
    readText(multiAuthFile()),
    opencodeDb.credentials("opencode"),
  ]);
  const auth = tryJson(authText);
  const plugin = tryJson(pluginText);
  const consoleKeys = await Promise.all(rows.map(keyFromRow));
  const accounts = accountsFrom(auth, plugin, consoleKeys.filter(Boolean));
  if (accounts.length > 0) return accounts;

  // Nothing usable anywhere: say which step is missing.
  const failure = consoleKeys.find((k) => k && k.error);
  if (failure) throw failure.error;
  const haveDb = await exists(opencodeDb.dbPath());
  if (authText === null && pluginText === null && !haveDb) throw notReady("找不到 opencode，請先安裝並登入");
  if (auth === undefined) throw notReady("opencode 憑證檔讀不懂，請重新登入");
  if (isObject(auth?.["opencode-go"]) || isObject(auth?.opencode)) {
    throw notReady("opencode 的登入資料不完整，請重新登入");
  }
  throw notReady("尚未登入 opencode Go 或 opencode（Zen／console）");
}

// ── console login ──────────────────────────────────────────────────────────

const CONSOLE_SERVER = "https://opencode.ai/console";
const CONSOLE_CLIENT_ID = "opencode-cli";
const REFRESH_SKEW_MS = 300_000;

/** Where each console login's usage lives ({ url, headers }), fetched once per run. */
const consoleRouteCache = new Map();

/** One 'opencode' credential row → { key, label } | { error } | null. */
async function keyFromRow(row) {
  const v = row.value;
  const label = consoleLabel(v, row.label);
  if (v.type === "key" || v.type === "api") return str(v.key) ? { key: v.key, label } : null;
  if (v.type !== "oauth" || !str(v.access)) return null;
  try {
    const access = await consoleAccess(row);
    let route = consoleRouteCache.get(row.id);
    if (!route) {
      route = await consoleRoute(row, access);
      consoleRouteCache.set(row.id, route);
    }
    return { key: access, url: route.url, headers: route.headers, label };
  } catch (err) {
    return { error: err };
  }
}

export function consoleLabel(v, rowLabel) {
  const m = isObject(v?.metadata) ? v.metadata : {};
  return str(m.orgName)?.trim() ?? str(m.email)?.trim() ?? (rowLabel && rowLabel !== "Default" ? rowLabel : "Console");
}

const serverOf = (v) => str(isObject(v.metadata) ? v.metadata.server : null) ?? CONSOLE_SERVER;

/** The console access token, refreshed (and written back) when spent. */
async function consoleAccess(row) {
  const v = row.value;
  const server = serverOf(v);
  let access = v.access;

  if (isInteger(v.expires) && v.expires <= Date.now() + REFRESH_SKEW_MS && str(v.refresh)) {
    const res = await request(`${server}/auth/device/token`, {
      method: "POST",
      headers: { accept: "application/json" },
      json: { grant_type: "refresh_token", refresh_token: v.refresh, client_id: CONSOLE_CLIENT_ID },
    });
    if (res.status === 400 || res.status === 401) throw notReady("opencode console 登入已失效，請重新執行 opencode console login");
    if (res.status < 200 || res.status >= 300) throw transient("opencode console 換發失敗，稍後自動重試");
    const t = parseJson(res.text);
    if (!str(t?.access_token)) throw transient("opencode console 換發回應缺少 access_token，稍後自動重試");
    access = t.access_token;
    // The console rotates refresh tokens: write back, or opencode is signed out.
    await opencodeDb.updateCredential(row.id, {
      access,
      refresh: str(t.refresh_token) ?? v.refresh,
      expires: Date.now() + (isInteger(t.expires_in) ? t.expires_in : 3600) * 1000,
    });
  }
  return access;
}

/** GET {server}/api/config → where this workspace's usage lives. */
async function consoleRoute(row, access) {
  const v = row.value;
  const m = isObject(v.metadata) ? v.metadata : {};
  const server = serverOf(v);

  const res = await request(`${server}/api/config`, {
    headers: {
      Authorization: `Bearer ${access}`,
      accept: "application/json",
      ...(str(m.orgID) ? { "x-org-id": m.orgID } : {}),
    },
  });
  if (res.status === 401) throw notReady("opencode console 登入已失效，請重新執行 opencode console login");
  if (res.status < 200 || res.status >= 300) throw statusError(res.status, res.text);
  const route = consoleUsageRoute(parseJson(res.text));
  if (!route) throw failed("opencode console 設定裡沒有 Go 的推論閘道。");
  return route;
}

/**
 * The usage endpoint and headers for a console workspace, from GET /api/config.
 * provider["opencode-go"].api is the gateway's OpenAI-compatible base
 * (…/inference/go/openai/v1); usage sits beside it at …/inference/go/v1/usage.
 * Pure.
 */
export function consoleUsageRoute(config) {
  const go = config?.config?.provider?.["opencode-go"];
  const api = str(go?.api);
  if (!api) return null;
  const cut = api.indexOf("/go/");
  const m = cut < 0 ? null : [null, api.slice(0, cut + 3)];
  if (!m) return null;
  const raw = isObject(go.options?.headers) ? go.options.headers : {};
  const headers = Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string"));
  return { url: `${m[1]}/v1/usage`, headers };
}

/** Every distinct key, labelled. Pure. */
export function accountsFrom(auth, plugin, consoleKeys = []) {
  const found = [];
  const add = (key, label, headers = {}, url = null) => {
    const k = str(key)?.trim();
    if (k && !found.some((a) => a.key === k)) found.push({ key: k, label, headers, url });
  };
  if (isObject(auth)) {
    add(auth["opencode-go"]?.key, "Go");
    add(auth.opencode?.key, "Zen");
  }
  for (const c of consoleKeys) if (c.key) add(c.key, c.label, c.headers, c.url);
  if (isObject(plugin) && Array.isArray(plugin.accounts)) {
    plugin.accounts
      .filter((a) => isObject(a) && a.enabled !== false)
      .forEach((a) => add(a.apiKey, str(a.label)?.trim() ?? null));
  }
  return labelled(found, "帳號");
}
