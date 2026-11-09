// Subscription quota comes from the dashboard summary, not per-generation token
// counts. Persist only measured percentages and the billing reset.

import { collectRoutes } from "../lib/accounts.js";
import { failed, notReady, statusError } from "../lib/errors.js";
import { request } from "../lib/io.js";
import { clamp, isNumber, isObject, optionalIso } from "../lib/values.js";
import { MONTHLY, usage, usageWindow } from "./model.js";
import { LOGIN_MESSAGE, logins, sessionFromToken } from "./cursor_token.js";

export const PROVIDER_NAME = "Cursor";
const USAGE_URL = "https://cursor.com/api/usage-summary";

export async function collect({ readDbToken } = {}) {
  const sources = await logins(readDbToken);
  return collectRoutes(PROVIDER_NAME, sources.map((source) => ({
    label: source.label,
    run: async () => {
      if (source.error) throw source.error;
      return collectOne(source);
    },
  })), LOGIN_MESSAGE);
}

const rejected = (status) => status === 401 || status === 403;
const fetchUsage = (session) => request(USAGE_URL, {
  headers: { Cookie: session.cookie, accept: "application/json", "User-Agent": "Manapoint" },
});

async function collectOne(source) {
  let session = source.session;
  let res = await fetchUsage(session);
  if (rejected(res.status)) {
    // Cursor may rotate its login while a poll is in flight. Re-read once, but
    // never refresh or write another application's session ourselves.
    const fresh = sessionFromToken(await source.read());
    if (fresh && fresh.access !== session.access) {
      session = fresh;
      res = await fetchUsage(session);
    }
  }
  if (rejected(res.status)) throw notReady("Cursor 登入已失效，請重新登入 Cursor 或執行 cursor-agent login");
  if (res.status < 200 || res.status >= 300) throw statusError(res.status);
  return { ...parse(res.text, Date.now()), identity: session.identity };
}

const invalid = (field) => failed(`Cursor 回應格式不符：${field}`);
const present = (value) => value !== undefined && value !== null;

/** A capped amount is useful only if the server also supplied its used amount. */
function ratio(node, field) {
  if (!isObject(node) || node.enabled === false) return null;
  if (present(node.limit) && (!isNumber(node.limit) || node.limit < 0)) throw invalid(field + ".limit");
  if (present(node.used) && (!isNumber(node.used) || node.used < 0)) throw invalid(field + ".used");
  if (!(node.limit > 0)) return null;
  if (!isNumber(node.used)) throw invalid(field + ".used");
  return clamp(node.used / node.limit * 100, 0, 100);
}

/** Pure parser for GET /api/usage-summary. Amounts are in cents, percentages in 0–100 units. */
export function parse(json, collectedAt) {
  let root;
  try { root = JSON.parse(json); } catch { throw invalid("JSON"); }
  if (!isObject(root)) throw invalid("response");
  for (const [field, node] of [["individualUsage", root.individualUsage], ["teamUsage", root.teamUsage]]) {
    if (present(node) && !isObject(node)) throw invalid(field);
  }
  const plan = root.individualUsage?.plan;
  const overall = root.individualUsage?.overall;
  const pooled = root.teamUsage?.pooled;
  for (const [field, node] of [["plan", plan], ["overall", overall], ["pooled", pooled]]) {
    if (present(node) && !isObject(node)) throw invalid(field);
    if (isObject(node) && present(node.enabled) && typeof node.enabled !== "boolean") throw invalid(field + ".enabled");
  }
  const reset = optionalIso(root, "billingCycleEnd");
  const windows = [];
  if (isObject(plan) && plan.enabled !== false) {
    if (present(plan.totalPercentUsed)) {
      if (!isNumber(plan.totalPercentUsed)) throw invalid("plan.totalPercentUsed");
      windows.push(usageWindow(MONTHLY, clamp(plan.totalPercentUsed, 0, 100), reset));
    } else {
      const percent = ratio(plan, "plan");
      if (percent !== null) windows.push(usageWindow(MONTHLY, percent, reset));
      else {
        // Auto and named models can be independent pools. Do not average them or
        // mistake 0.36% for a fraction that should be multiplied by 100.
        for (const [field, group] of [["autoPercentUsed", "Auto"], ["apiPercentUsed", "API"]]) {
          if (!present(plan[field])) continue;
          if (!isNumber(plan[field])) throw invalid("plan." + field);
          windows.push({ ...usageWindow(MONTHLY, clamp(plan[field], 0, 100), reset), quotaGroup: group });
        }
      }
    }
  }
  if (!windows.length) {
    const personal = ratio(overall, "overall");
    const team = personal === null ? ratio(pooled, "pooled") : null;
    if (personal !== null) windows.push(usageWindow(MONTHLY, personal, reset));
    else if (team !== null) windows.push({ ...usageWindow(MONTHLY, team, reset), quotaGroup: "團隊共用" });
  }
  if (windows.length) return usage(PROVIDER_NAME, windows, collectedAt);
  if (root.isUnlimited === true) return usage(PROVIDER_NAME, [], collectedAt, "此 Cursor 方案未提供有限訂閱額度");
  if ([plan, overall, pooled].some((node) => isObject(node) &&
    (node.enabled === false || node.limit === 0 || node.limit === null || isNumber(node.used)))) {
    return usage(PROVIDER_NAME, [], collectedAt, "Cursor 未提供可計算比例的訂閱額度");
  }
  throw invalid("訂閱用量");
}
