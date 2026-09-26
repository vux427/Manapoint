// Antigravity's two shared quota pools.
//
// One request answers for both cards: `retrieveUserQuotaSummary` returns four buckets
// in two groups — Gemini models share a 5-hour and a weekly limit, Claude/GPT models
// share another pair. Each pool gets its own card, and the response is fetched once
// and shared between them (see SUMMARY_TTL_MS). Every login on the machine is read —
// `agy`'s own plus any from the opencode-antigravity-multi-auth plugin — and each
// shows as its own group of bars on both cards. The response carries no account
// identifiers, only the buckets below.
//
// Endpoint and OAuth client verified against the MIT-licensed lamchun1110/UsageDeck
// (src-tauri/src/providers/antigravity) and confirmed live on 2026-09-09.

import { failed, parseJson, statusError, transient } from "../lib/errors.js";
import { request } from "../lib/io.js";
import { clamp, isNumber, isObject, optionalIso } from "../lib/values.js";
import { collectRoutes } from "../lib/accounts.js";
import { accessToken, listAccounts, refreshForRetry } from "./antigravity_token.js";
import { ROLLING, WEEKLY, usage, usageWindow } from "./model.js";

export const GEMINI_NAME = "Antigravity Gemini";
export const THIRD_PARTY_NAME = "Antigravity Claude/GPT";

export const POOLS = {
  gemini: { name: GEMINI_NAME, buckets: [["gemini-5h", ROLLING], ["gemini-weekly", WEEKLY]] },
  thirdParty: { name: THIRD_PARTY_NAME, buckets: [["3p-5h", ROLLING], ["3p-weekly", WEEKLY]] },
};

/**
 * Tried in order, and the order matters. `agy` itself talks to the `daily-` host, and
 * only that one meters the Gemini pool: the plain host answers with a placeholder
 * (`remainingFraction: 1`, a reset recomputed as "now + window") and reports the
 * Claude/GPT pool a little stale too (measured 2026-09-09). The plain host stays as a
 * fallback for the day the `daily-` one goes away.
 */
const SUMMARY_HOSTS = ["https://daily-cloudcode-pa.googleapis.com", "https://cloudcode-pa.googleapis.com"];
const SUMMARY_PATH = "/v1internal:retrieveUserQuotaSummary";
/** The `agy` CLI identifies itself with this; the endpoint is picky about a client name. */
const USER_AGENT = "antigravity";

/** Long enough that both cards of one round share a request, short enough that a
 * manual refresh still goes to the network. */
const SUMMARY_TTL_MS = 30_000;

/** Per account (keyed by refresh token): { at, body } and the request in flight. */
const cached = new Map();
const inflight = new Map();

export async function collect(pool) {
  const accounts = await listAccounts();
  const routes = accounts.map((account) => ({
    label: account.label,
    run: async () => parse(pool, await summary(account), Date.now()),
  }));
  return collectRoutes(pool.name, routes, "尚未登入 Antigravity，請開啟 Antigravity 或執行 agy 登入");
}

/** One account's quota summary, from cache when the sibling card just fetched it.
 * Concurrent callers share one in-flight request, so a round costs one round trip
 * per account rather than one per card. */
function summary(account) {
  const key = account.refresh;
  const hit = cached.get(key);
  if (hit && Date.now() - hit.at < SUMMARY_TTL_MS) return Promise.resolve(hit.body);
  if (!inflight.has(key)) {
    inflight.set(key, fetchSummary(account).finally(() => inflight.delete(key)));
  }
  return inflight.get(key);
}

const post = (host, token) =>
  request(host + SUMMARY_PATH, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT, accept: "application/json" },
    json: {},
  });

async function fetchSummary(account) {
  // Refreshes a stale access token on the way through.
  let token = await accessToken(account);
  let refreshed = false;
  let last = null;

  for (const host of SUMMARY_HOSTS) {
    try {
      let res = await post(host, token);
      if ((res.status === 401 || res.status === 403) && !refreshed) {
        // Lapsed since the proactive check, or `agy` signed in again: refresh once and
        // retry this host.
        refreshed = true;
        token = await refreshForRetry(account, token);
        res = await post(host, token);
      }
      if (res.status >= 200 && res.status < 300) {
        cached.set(account.refresh, { at: Date.now(), body: res.text });
        return res.text;
      }
      // A host that is gone or refuses this client is worth stepping past; only the
      // last one's reason reaches the card.
      last = statusError(res.status, res.text);
    } catch (err) {
      if (err.kind === "NotReady") throw err;
      last = err;
    }
  }
  throw last ?? transient("Antigravity 額度查詢失敗，稍後自動重試");
}

/**
 * Pull one pool's windows out of the response. Pure, no IO. Buckets are matched by
 * `bucketId`, never by position: groups arrive in no fixed order, and an account
 * without a given limit omits its bucket. A bucket reports what is *left*, so the
 * panel's "used" is `1 - remainingFraction`.
 */
export function parse(pool, json, collectedAt) {
  const root = parseJson(json);
  const groups = root?.response?.groups ?? root?.groups;
  if (!Array.isArray(groups)) throw failed("Antigravity 額度回應缺少 'groups'。");
  const buckets = groups.flatMap((g) => (isObject(g) && Array.isArray(g.buckets) ? g.buckets : []));

  const windows = [];
  for (const [id, kind] of pool.buckets) {
    const bucket = buckets.find((b) => isObject(b) && b.bucketId === id);
    if (!bucket) continue;
    // A bucket without a fraction is a shape change, not an empty quota.
    if (!isNumber(bucket.remainingFraction)) {
      throw failed(`Antigravity 的 '${id}' 缺少 remainingFraction。`);
    }
    const used = (1 - clamp(bucket.remainingFraction, 0, 1)) * 100;
    windows.push(usageWindow(kind, used, optionalIso(bucket, "resetTime")));
  }

  // No bucket at all is an account without this pool — a fact to state, not an error.
  if (windows.length === 0) return usage(pool.name, [], collectedAt, "此帳號沒有這組模型的額度");
  return usage(pool.name, windows, collectedAt);
}
