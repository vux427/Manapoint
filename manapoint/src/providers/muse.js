// The CLI's login response includes subscription quota alongside an inference
// key and payment metadata. Keep only the quota; none of the other fields persist.

import { collectRoutes } from "../lib/accounts.js";
import { failed, notReady, statusError } from "../lib/errors.js";
import { request } from "../lib/io.js";
import { clamp, isNumber, isObject } from "../lib/values.js";
import { ROLLING, WEEKLY, usage, usageWindow } from "./model.js";
import { accessToken, LOGIN_MESSAGE } from "./muse_token.js";

export const PROVIDER_NAME = "Muse Code";
const USAGE_URL = "https://api.meta.ai/muse-code/key";

export async function collect() {
  return collectRoutes(PROVIDER_NAME, [{ label: "Muse CLI", run: collectOne }], LOGIN_MESSAGE);
}

async function collectOne() {
  const token = await accessToken();
  const res = await request(USAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "x-api-version": "1.0.0",
      "User-Agent": "Manapoint",
      accept: "application/json",
    },
    json: {},
  });
  if (res.status === 401 || res.status === 403) {
    throw notReady("Muse Code 登入已失效，請執行 muse login 重新登入");
  }
  // This endpoint can return credentials, including in an error body. Never
  // attach its raw response to diagnostics through statusError's detail field.
  if (res.status < 200 || res.status >= 300) throw statusError(res.status);
  return parse(res.text, Date.now());
}

const invalid = (field) => failed(`Muse Code 回應格式不符：${field}`);

/** Reset times are Unix seconds. Bad optional dates must not erase valid usage. */
function resetsAt(value) {
  if (!isNumber(value) || value <= 0 || value > 64_092_211_200) return null;
  return new Date(value * 1000).toISOString();
}

function readWindow(node, kind, field) {
  if (!isObject(node) || !isNumber(node.used_percent)) throw invalid(field);
  return usageWindow(kind, clamp(node.used_percent, 0, 100), resetsAt(node.resets_at));
}

/** Pure parser for POST /muse-code/key; never retain inference or payment data. */
export function parse(json, collectedAt) {
  let root;
  try {
    root = JSON.parse(json);
  } catch {
    throw invalid("JSON");
  }
  if (!isObject(root)) throw invalid("response");
  for (const field of ["require_payment", "is_subs_active"]) {
    if (root[field] !== undefined && root[field] !== null && typeof root[field] !== "boolean") {
      throw invalid(field);
    }
  }
  if (root.require_payment === true) {
    return usage(PROVIDER_NAME, [], collectedAt, "Muse Code 尚未完成付款設定，請至 dev.meta.ai 設定");
  }
  if (root.is_subs_active === false) {
    return usage(PROVIDER_NAME, [], collectedAt, "此帳號沒有有效的 Muse Code 訂閱");
  }
  if (root.is_subs_active !== true) throw invalid("is_subs_active");
  if (root.subs_usage === undefined || root.subs_usage === null) {
    // Meta omits this while the short window is idle, even with weekly usage.
    return usage(PROVIDER_NAME, [], collectedAt, "Muse Code 已訂閱，但此登入回應未提供用量");
  }
  if (!isObject(root.subs_usage)) throw invalid("subs_usage");
  const { window, weekly } = root.subs_usage;
  // The existing Rolling slot is labelled 5H; a changed duration must not be
  // displayed under that label or mistaken for a measured five-hour allowance.
  if (!isObject(window) || window.window_duration_mins !== 300) throw invalid("window.window_duration_mins");
  return usage(PROVIDER_NAME, [
    readWindow(window, ROLLING, "window.used_percent"),
    readWindow(weekly, WEEKLY, "weekly.used_percent"),
  ], collectedAt);
}
