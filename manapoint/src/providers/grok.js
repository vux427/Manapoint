// Grok's weekly credit pool, plus a monthly window for accounts that cap spend.
//
// Credentials come from the xAI OAuth login opencode already stores, so no Grok CLI
// is needed. On some accounts the opencode grant reports a monthly limit of zero while
// the credit pool has real numbers — hence `?format=credits`. SuperGrok (unified
// billing) accounts expose the weekly pool either as a top-level `creditUsagePercent`
// or per product in `productUsage[].usagePercent`; xAI omits zero-valued percentage
// fields, so a unified weekly bill with every amount at zero reads as 0% used (a fresh
// pool), not as "no quota". Expired tokens are refreshed; see xai_token.js.

import { notReady, parseJson, statusError } from "../lib/errors.js";
import { request } from "../lib/io.js";
import { clamp, isNumber, isObject, iso, object, parseDatetime } from "../lib/values.js";
import { MONTHLY, WEEKLY, usage, usageWindow } from "./model.js";
import { collectRoutes } from "../lib/accounts.js";
import { accessToken, listAccounts } from "./xai_token.js";

export const PROVIDER_NAME = "Grok";
const BILLING_URL = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";

export async function collect() {
  const routes = (await listAccounts()).map((a) => ({ label: a.label, run: () => collectOne(a) }));
  return collectRoutes(PROVIDER_NAME, routes, "尚未登入 xAI，請在 opencode 登入");
}

async function collectOne(account) {
  // Refreshes and persists a stale access token on the way through.
  const token = await accessToken(account);
  const res = await request(BILLING_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      "x-xai-token-auth": "xai-grok-cli",
      accept: "application/json",
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw notReady("登入已失效，請在 opencode 重新登入 xAI");
  }
  if (res.status < 200 || res.status >= 300) throw statusError(res.status, res.text);
  return parse(res.text, Date.now());
}

/**
 * Parse `GET /v1/billing?format=credits`. Pure, no IO.
 *
 * One endpoint, three signals: two for the weekly pool (top-level
 * `creditUsagePercent`, else the max of `productUsage[].usagePercent`), plus the
 * default shape's monthly cap (`monthlyLimit` / `used`). A weekly percentage yields
 * WEEK, a non-zero cap adds MONTH. The shape varies by account (prepaid, unified
 * billing and subscription expose different fields), so a missing field is skipped
 * rather than treated as a break.
 */
export function parse(json, collectedAt) {
  const config = object(parseJson(json), "config", "Grok billing");
  const windows = [];

  const weekly = readWeeklyPercent(config);
  if (weekly !== null) windows.push(usageWindow(WEEKLY, clamp(weekly, 0, 100), iso(readResetsAt(config))));

  // Without a cap there is no ratio to show, so MONTH only appears when one is set.
  const limit = readAmount(config, "monthlyLimit") ?? 0;
  if (limit > 0) {
    const used = readAmount(config, "used") ?? 0;
    windows.push(usageWindow(MONTHLY, clamp((used / limit) * 100, 0, 100), iso(readPeriodEnd(config))));
  }

  if (windows.length > 0) return usage(PROVIDER_NAME, windows, collectedAt);

  // A unified-billing weekly account with no percentage fields: all-zero amounts mean
  // an untouched pool, so 0% is honest. Any non-zero amount without a percentage means
  // the endpoint withheld a number; synthesising 0% there would be a fabrication.
  if (isUnifiedWeekly(config)) {
    if (amountsAllZero(config)) {
      return usage(
        PROVIDER_NAME,
        [usageWindow(WEEKLY, 0, iso(readResetsAt(config)))],
        collectedAt,
        "本週期尚無用量",
      );
    }
    return usage(PROVIDER_NAME, [], collectedAt, unifiedNote(config));
  }

  // Neither shape had a usable signal. Saying so beats a 0% bar.
  const spent = readAmount(config, "used") ?? 0;
  const note =
    spent > 0 ? `本月已用 $${trimAmount(spent)}，此帳號未設額度上限` : "此帳號沒有 Grok 訂閱額度";
  return usage(PROVIDER_NAME, [], collectedAt, note);
}

/** `creditUsagePercent` first, else the max numeric `productUsage[].usagePercent`. */
function readWeeklyPercent(config) {
  const top = readNumber(config, "creditUsagePercent");
  if (top !== null) return top;
  if (!Array.isArray(config.productUsage)) return null;
  const values = config.productUsage
    .map((p) => (isObject(p) && isNumber(p.usagePercent) && p.usagePercent >= 0 ? p.usagePercent : null))
    .filter((v) => v !== null);
  return values.length ? Math.max(...values) : null;
}

function isUnifiedWeekly(config) {
  const type = isObject(config.currentPeriod) ? config.currentPeriod.type : null;
  return config.isUnifiedBillingUser === true && typeof type === "string" && type.includes("WEEKLY");
}

function unifiedNote(config) {
  const base = "SuperGrok 統一帳單，帳務端未回傳用量百分比";
  const reset = readResetsAt(config);
  return reset === null ? base : `${base}（下次重置 ${new Date(reset).toISOString().slice(0, 10)}）`;
}

/** Absent counts as zero, matching the endpoint's zero-omission; a bare number is
 * accepted too in case the `{val}` wrapper ever changes. */
function amountsAllZero(config) {
  return ["monthlyLimit", "used", "onDemandCap", "onDemandUsed", "prepaidBalance"].every((key) => {
    const raw = isObject(config[key]) ? config[key].val : config[key];
    return !isNumber(raw) || raw === 0;
  });
}

const readNumber = (config, key) => (isNumber(config[key]) && config[key] >= 0 ? config[key] : null);

/** Money fields are wrapped as `{ "val": n }`. */
function readAmount(config, key) {
  const v = isObject(config[key]) ? config[key].val : undefined;
  return isNumber(v) && v >= 0 ? v : null;
}

/** `currentPeriod.end` first, `billingPeriodEnd` as a fallback. */
function readResetsAt(config) {
  const end = isObject(config.currentPeriod) ? parseDatetime(config.currentPeriod.end) : null;
  return end ?? readPeriodEnd(config);
}

const readPeriodEnd = (config) => parseDatetime(config.billingPeriodEnd);

/** At most two decimals, trailing zeros dropped. */
export const trimAmount = (value) => value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
