// Codex's five-hour and weekly usage.
//
// Routes, in priority order (the first that answers wins — lib/accounts.js):
//   1. the Codex CLI's own login (~/.codex/auth.json); see codex_token.js;
//   2. ChatGPT logins opencode holds (integration 'openai', opencode.db or auth.json),
//      refreshed with the same public client and written back.
// The ChatGPT account id doubles as the identity that tells two routes apart. The
// response carries account details such as an email address — only the usage fields
// are read, nothing else is retained. Premium plans have no five-hour window, so a
// missing or unreadable window is omitted rather than failing the card.

import { notReady, parseJson, statusError } from "../lib/errors.js";
import { collectRoutes, labelled } from "../lib/accounts.js";
import { exists, request } from "../lib/io.js";
import { freshToken, opencodeLogins } from "../lib/opencode_logins.js";
import { codexAuth } from "../lib/paths.js";
import { isInteger, isNumber, isObject, iso, object } from "../lib/values.js";
import { accountIdOf, credentials, refreshForRetry, refreshToken } from "./codex_token.js";
import { MONTHLY, ROLLING, WEEKLY, usage, usageWindow } from "./model.js";

export const PROVIDER_NAME = "Codex";
const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

const ONE_DAY = 86_400;
const TEN_DAYS = 864_000;

const fetchUsage = ({ access, accountId }) =>
  request(USAGE_URL, {
    headers: { Authorization: `Bearer ${access}`, "chatgpt-account-id": accountId },
  });

export async function collect() {
  const routes = [];
  if (await exists(codexAuth())) routes.push({ label: "Codex CLI", run: collectCli });
  for (const login of labelled(await opencodeLogins("openai"), "opencode")) {
    routes.push({
      label: login.label,
      identity: accountIdOf(login.access, login.extra.accountId) || undefined,
      run: () => collectOpencode(login),
    });
  }
  return collectRoutes(PROVIDER_NAME, routes, "找不到 Codex CLI，請先安裝並登入");
}

async function collectOpencode(login) {
  const access = await freshToken(login, refreshToken);
  const accountId = accountIdOf(access, login.extra.accountId);
  if (!accountId) throw notReady("opencode 的 ChatGPT 登入缺少帳號資訊，請在 opencode 重新登入");
  const res = await fetchUsage({ access, accountId });
  if (res.status === 401 || res.status === 403) throw notReady("opencode 的 ChatGPT 登入已失效，請在 opencode 重新登入");
  if (res.status < 200 || res.status >= 300) throw statusError(res.status, res.text);
  return parse(res.text, Date.now());
}

async function collectCli() {
  // Refreshes and persists a stale access token on the way through.
  const creds = await credentials();
  let res = await fetchUsage(creds);
  // Lapsed between the proactive check and the request, or lost a rotation race.
  if (res.status === 401 || res.status === 403) {
    res = await fetchUsage(await refreshForRetry(creds.access));
  }
  if (res.status < 200 || res.status >= 300) throw statusError(res.status, res.text);
  return { ...parse(res.text, Date.now()), identity: creds.accountId };
}

/** Parse `GET /backend-api/wham/usage`. Pure, no IO. */
export function parse(json, collectedAt) {
  const root = parseJson(json);
  const rateLimit = object(root, "rate_limit", "Codex usage");
  const windows = ["primary_window", "secondary_window"]
    .map((key) => readWindow(rateLimit, key))
    .filter(Boolean);

  if (windows.length === 0) return usage(PROVIDER_NAME, [], collectedAt, "此帳號沒有訂閱額度");
  return usage(PROVIDER_NAME, windows, collectedAt);
}

/** Absent, null, or missing fields: skip the window. Premium has no five-hour cap. */
function readWindow(rateLimit, key) {
  const w = rateLimit[key];
  if (!isObject(w) || !isInteger(w.limit_window_seconds) || !isNumber(w.used_percent)) return null;
  const reset = isInteger(w.reset_at) ? iso(w.reset_at * 1000) : null;
  return usageWindow(kindFor(w.limit_window_seconds), w.used_percent, reset);
}

/** Classify by window length, not by field order — the two can be swapped. */
export function kindFor(seconds) {
  if (seconds <= ONE_DAY) return ROLLING;
  if (seconds <= TEN_DAYS) return WEEKLY;
  return MONTHLY;
}
