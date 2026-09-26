// Claude Code's five-hour and weekly usage.
//
// Routes, in priority order (see lib/accounts.js — the first that answers wins):
//   1. Claude Code's own login (~/.claude/.credentials.json); see claude_token.js.
//   2. Claude logins opencode holds (integration 'anthropic', opencode.db or auth.json).
// Expired access tokens are refreshed and written back before they can turn the card red.
//
// Every Anthropic call goes through requestNoOrigin (system curl): the backend's
// fetch always adds an Origin header, and Anthropic refuses such "browser" calls
// outright for organisations whose settings disallow CORS.

import { failed, notReady, parseJson, statusError } from "../lib/errors.js";
import { collectRoutes, labelled } from "../lib/accounts.js";
import { exists, requestNoOrigin as request } from "../lib/io.js";
import { freshToken, opencodeLogins } from "../lib/opencode_logins.js";
import { claudeCredentials } from "../lib/paths.js";
import { isObject, number, optionalIso } from "../lib/values.js";
import { accessToken, refreshForRetry, refreshToken } from "./claude_token.js";
import { ROLLING, WEEKLY, usage, usageWindow } from "./model.js";

export const PROVIDER_NAME = "Claude Code";
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

const WINDOW_MAP = [
  ["five_hour", ROLLING],
  ["seven_day", WEEKLY],
];

const fetchUsage = (token) =>
  request(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": "claude-code/2.0.32",
      accept: "application/json",
    },
  });

const ok = (s) => s >= 200 && s < 300;

export async function collect() {
  const routes = [];
  if (await exists(claudeCredentials())) routes.push({ label: "Claude Code", run: collectCli });
  for (const login of labelled(await opencodeLogins("anthropic"), "opencode")) {
    routes.push({ label: login.label, run: () => collectOpencode(login) });
  }
  return collectRoutes(PROVIDER_NAME, routes, "找不到 Claude Code，請先安裝並執行 /login");
}

async function collectOpencode(login) {
  const res = await fetchUsage(await freshToken(login, refreshToken));
  if (res.status === 401 || res.status === 403) throw notReady("opencode 的 Claude 登入已失效，請在 opencode 重新登入");
  if (!ok(res.status)) throw statusError(res.status, res.text);
  return parse(res.text, Date.now());
}

async function collectCli() {
  // Refreshes and persists a stale access token on the way through.
  const token = await accessToken();
  let res = await fetchUsage(token);

  // The token lapsed between the proactive check and the request, or lost a
  // rotation race. Refresh once and retry before telling the user to log in.
  if (res.status === 401 || res.status === 403) {
    res = await fetchUsage(await refreshForRetry(token));
  }
  if (!ok(res.status)) throw statusError(res.status, res.text);
  return parse(res.text, Date.now());
}

/** Parse `GET /api/oauth/usage`. Pure, no IO. */
export function parse(json, collectedAt) {
  const root = parseJson(json);
  const windows = WINDOW_MAP.map(([key, kind]) => {
    const w = isObject(root) ? root[key] : null;
    if (!isObject(w)) throw failed(`Claude usage 回應缺少 '${key}' 窗口。`);
    // Claude returns a null reset time for some windows.
    return usageWindow(kind, number(w, "utilization", "Claude usage"), optionalIso(w, "resets_at"));
  });
  return usage(PROVIDER_NAME, windows, collectedAt);
}
