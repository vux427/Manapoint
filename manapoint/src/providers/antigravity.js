// Antigravity's quota pools, grouped into Gemini and Claude/GPT cards.
//
// One request answers for both cards: `retrieveUserQuotaSummary` returns four buckets
// in model groups — Gemini and Claude/GPT each have shared limits, while Argon
// has a separate balance. Gemini and Argon share a card. The response is fetched once
// and shared between them (see SUMMARY_TTL_MS). Every login on the machine is read —
// `agy`'s own plus any from the opencode-antigravity-multi-auth plugin — and each
// shows as its own group of bars on both cards. The response carries no account
// identifiers, only quota groups and buckets.
//
// Endpoint and OAuth client verified against the MIT-licensed lamchun1110/UsageDeck
// (src-tauri/src/providers/antigravity) and confirmed live on 2026-09-09.
// Additional summary shapes are documented by steipete/CodexBar's
// AntigravityQuotaSummaryParser and its quota-summary tests.

import { failed, parseJson, statusError, transient } from "../lib/errors.js";
import { request } from "../lib/io.js";
import { clamp, isNumber, isObject, optionalIso } from "../lib/values.js";
import { collectRoutes } from "../lib/accounts.js";
import { accessToken, listAccounts, refreshForRetry } from "./antigravity_token.js";
import { ROLLING, WEEKLY, usage, usageWindow } from "./model.js";

export const GEMINI_NAME = "Antigravity Gemini";
export const THIRD_PARTY_NAME = "Antigravity Claude/GPT";

export const POOLS = {
  gemini: { name: GEMINI_NAME, families: ["gemini", "argon"] },
  thirdParty: { name: THIRD_PARTY_NAME, families: ["thirdParty"] },
};

/**
 * Which host and client string answers with what (measured 2026-10-16 against the
 * `/usage` screen of agy 1.3.6, which is the ground truth for the numbers):
 *   - the plain host carries the real Gemini and Claude/GPT figures but never an
 *     Argon group; the `daily-` host reports Gemini as a flat 1.0 here;
 *   - the `daily-` host adds the `Gemini 4 Argon` group only for the CLI's own client
 *     string, and drops the Gemini group for a bare `antigravity` agent.
 * So the base reading comes from the plain host and Argon is grafted on from the
 * `daily-` host (see `withArgon`). The weaker pairings stay as fallbacks for the day
 * a client string stops being accepted.
 */
const PLAIN_HOST = "https://cloudcode-pa.googleapis.com";
const DAILY_HOST = "https://daily-cloudcode-pa.googleapis.com";
const CLI_AGENT = "antigravity/cli/1.3.6 windows/amd64";
const HUB_AGENT = "antigravity/hub/2.9.1 windows/amd64";
const ARGON_ATTEMPT = { host: DAILY_HOST, agent: CLI_AGENT };
const ATTEMPTS = [
  { host: PLAIN_HOST, agent: CLI_AGENT },
  ARGON_ATTEMPT,
  { host: DAILY_HOST, agent: HUB_AGENT },
];
const SUMMARY_PATH = "/v1internal:retrieveUserQuotaSummary";

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

const post = ({ host, agent }, token) =>
  request(host + SUMMARY_PATH, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "User-Agent": agent, accept: "application/json" },
    json: {},
  });

async function fetchSummary(account) {
  // Refreshes a stale access token on the way through.
  let token = await accessToken(account);
  let refreshed = false;
  let last = null;
  let partial = null;

  for (const attempt of ATTEMPTS) {
    try {
      let res = await post(attempt, token);
      if ((res.status === 401 || res.status === 403) && !refreshed) {
        // Lapsed since the proactive check, or `agy` signed in again: refresh once and
        // retry this attempt.
        refreshed = true;
        token = await refreshForRetry(account, token);
        res = await post(attempt, token);
      }
      if (res.status >= 200 && res.status < 300) {
        // HTTP 200 can still be an empty or incompatible summary. Validate before
        // caching so it cannot suppress the fallback host for both cards.
        const readings = Object.values(POOLS).map((pool) => {
          try {
            return parse(pool, res.text, Date.now());
          } catch (err) {
            return { error: err };
          }
        });
        // A malformed pool must not hide another pool's valid numbers. Each card
        // still parses its own pool after the shared request completes.
        if (!readings.some((reading) => reading.windows?.length)) {
          throw readings.find((reading) => reading.error)?.error ??
            transient("Antigravity 暫未提供可用額度，請在 agy 執行 /usage 確認後重試");
        }
        // A client the endpoint half-recognises answers 200 with a pool missing (the
        // bare `antigravity` agent drops Gemini), which reads as a note-only pool.
        // Keep it, but let the next attempt try for a complete answer before settling.
        // A pool that errors is a shape change the next attempt will not cure.
        if (readings.every((reading) => reading.windows?.length || reading.error)) {
          const body = await graftArgon(res.text, attempt, token);
          cached.set(account.refresh, { at: Date.now(), body });
          return body;
        }
        partial ??= res.text;
        continue;
      }
      // A host that is gone or refuses this client is worth stepping past; only the
      // last one's reason reaches the card.
      last = statusError(res.status, res.text);
    } catch (err) {
      if (err.kind === "NotReady") throw err;
      last = err;
    }
  }
  if (partial !== null) {
    cached.set(account.refresh, { at: Date.now(), body: partial });
    return partial;
  }
  throw last ?? transient("Antigravity 額度查詢失敗，稍後自動重試");
}

/** The base reading plus Argon from the `daily-` host. Argon is an extra: when that
 * request fails the card keeps what it has rather than going red. */
async function graftArgon(baseText, usedAttempt, token) {
  if (usedAttempt === ARGON_ATTEMPT || hasArgon(baseText)) return baseText;
  try {
    const res = await post(ARGON_ATTEMPT, token);
    if (res.status >= 200 && res.status < 300) return withArgon(baseText, res.text);
  } catch (err) {
    if (err.kind === "NotReady") throw err;
  }
  return baseText;
}

const payloadOf = (root) => root?.response ?? root?.summary ?? root;
const argonGroups = (root) => {
  const groups = payloadOf(root)?.groups;
  return Array.isArray(groups)
    ? groups.filter((group) => isObject(group) && Array.isArray(group.buckets) &&
        group.buckets.some((bucket) => isObject(bucket) && familyOf(bucket, group) === "argon"))
    : [];
};
const hasArgon = (text) => {
  try { return argonGroups(JSON.parse(text)).length > 0; } catch { return false; }
};

/**
 * Pure: `baseText` with the Argon group(s) of `extraText` added. Anything unreadable
 * on either side leaves the base untouched.
 */
export function withArgon(baseText, extraText) {
  let base;
  let extra;
  try {
    base = JSON.parse(baseText);
    extra = JSON.parse(extraText);
  } catch {
    return baseText;
  }
  const payload = payloadOf(base);
  const additions = argonGroups(extra);
  if (!Array.isArray(payload?.groups) || additions.length === 0 || argonGroups(base).length > 0) return baseText;
  payload.groups = [...payload.groups, ...additions];
  return JSON.stringify(base);
}

/**
 * Pull one pool's windows out of the response. Pure, no IO. Stable bucket IDs
 * remain supported; renamed IDs use the explicit group and cadence instead.
 * A bucket reports what is left, so the panel's used value is 1 - remaining.
 */
export function parse(pool, json, collectedAt) {
  const root = parseJson(json);
  const payload = root?.response ?? root?.summary ?? root;
  if (!Array.isArray(payload?.groups) && !Array.isArray(payload?.buckets)) {
    throw failed("Antigravity 額度回應缺少 'groups' 或 'buckets'。");
  }
  const groups = Array.isArray(payload.groups) ? payload.groups : [];
  const grouped = groups.flatMap((group) =>
    isObject(group) && Array.isArray(group.buckets)
      ? group.buckets.filter(isObject).map((bucket) => ({ bucket, family: familyOf(bucket, group) }))
      : []);
  // The proto also permits top-level buckets. Prefer grouped data whenever it
  // contains a known family; mixing both representations could duplicate windows.
  const buckets = grouped.some(({ family }) => family !== null)
    ? grouped
    : (Array.isArray(payload.buckets) ? payload.buckets : []).filter(isObject)
      .map((bucket) => ({ bucket, family: familyOf(bucket) }));
  if (!buckets.some(({ family }) => family !== null)) {
    const err = transient("Antigravity 額度回應沒有可辨識的模型額度，請在 agy 執行 /usage 確認後重試");
    // Include quota vocabulary only, never the raw response or account fields.
    err.detail = JSON.stringify((groups ?? []).filter(isObject).map((group) => ({
      group: group.displayName ?? group.name,
      buckets: Array.isArray(group.buckets) ? group.buckets.filter(isObject).map((bucket) => ({
        id: bucket.bucketId ?? bucket.id, window: bucket.window,
      })) : [],
    }))).slice(0, 1200);
    throw err;
  }

  const windows = [];
  let disabled = false;
  for (const { bucket, family: bucketFamily } of buckets) {
    if (!pool.families.includes(bucketFamily)) continue;
    if (bucket.disabled === true) {
      disabled = true;
      continue;
    }
    const id = bucket.bucketId ?? bucket.id ?? "unknown";
    const kind = cadenceOf(bucket);
    if (kind === null) throw failed(`Antigravity 的 '${id}' 額度窗口無法辨識。`);
    // A bucket without a fraction is a shape change, not an empty quota.
    const remaining = bucket.remainingFraction ?? bucket.remaining?.remainingFraction ??
      (bucket.remaining?.case === "remainingFraction" ? bucket.remaining.value : undefined);
    if (!isNumber(remaining)) {
      throw failed(`Antigravity 的 '${id}' 缺少 remainingFraction。`);
    }
    const quotaGroup = bucketFamily === "argon" ? "Argon" : undefined;
    if (windows.some((window) => window.kind === kind && window.quotaGroup === quotaGroup)) {
      throw failed(`Antigravity 的 '${id}' 額度窗口重複，無法確認共用額度。`);
    }
    const used = (1 - clamp(remaining, 0, 1)) * 100;
    windows.push({ ...usageWindow(kind, used, optionalIso(bucket, "resetTime")),
      ...(quotaGroup ? { quotaGroup } : {}),
    });
  }

  if (windows.length === 0) {
    return usage(pool.name, [], collectedAt, disabled
      ? "此方案未啟用這組模型的額度窗口"
      : "此帳號沒有這組模型的額度");
  }
  windows.sort((a, b) => Number(Boolean(a.quotaGroup)) - Number(Boolean(b.quotaGroup)) ||
    [ROLLING, WEEKLY].indexOf(a.kind) - [ROLLING, WEEKLY].indexOf(b.kind));
  return usage(pool.name, windows, collectedAt);
}

const words = (value) => typeof value === "string" ? value.trim().toLowerCase().replace(/[_-]+/g, " ") : "";

function familyOf(bucket, group = {}) {
  const name = words(group.displayName ?? group.name);
  // Argon has its own weekly balance; its Gemini name does not make it part
  // of the original Gemini shared pool.
  if (/\bargon\b/.test(name) || /\bargon\b/.test(words(bucket.bucketId ?? bucket.id))) return "argon";
  if (/\bgemini\b/.test(name)) return "gemini";
  if (/\b(claude|gpt|third party)\b/.test(name)) return "thirdParty";
  const id = words(bucket.bucketId ?? bucket.id);
  if (/^gemini\b/.test(id)) return "gemini";
  if (/^(3p|claude|gpt)\b/.test(id)) return "thirdParty";
  return null;
}

function cadenceOf(bucket) {
  const classify = (value) => {
    const text = words(value).replace(/ limit$/, "");
    if (/^(5h|5 hour|5 hours|five hour|five hours|session)$/.test(text)) return ROLLING;
    if (/^(weekly|week|7d|7 day|7 days)$/.test(text)) return WEEKLY;
    return null;
  };
  // An explicit new cadence must not inherit an old cadence from a bucket ID.
  if (typeof bucket.window === "string" && bucket.window.trim()) return classify(bucket.window);
  const id = words(bucket.bucketId ?? bucket.id).replace(/^(gemini|3p|claude|gpt) /, "");
  const name = words(bucket.displayName ?? bucket.name);
  const suffix = (text) => text.match(/(?:^| )(weekly|7d|5h|5 hours?|five hours?|session)(?: limit)?$/)?.[1];
  return classify(id) ?? classify(name) ?? classify(suffix(id)) ?? classify(suffix(name));
}
