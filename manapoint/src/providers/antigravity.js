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
 * Tried in order, and the order matters. `agy` itself talks to the `daily-` host as
 * its hub client, and only that pairing meters the Gemini pool: with a bare
 * `antigravity` User-Agent the `daily-` host answers 200 but leaves the Gemini group
 * out entirely (measured 2026-10-16), and the plain host answers with a stale
 * Gemini figure (0.98 where `daily-` says 1.0; measured 2026-09-09). The weaker
 * pairings stay as fallbacks for the day the hub client string stops being accepted.
 */
const HUB_AGENT = "antigravity/hub/2.9.1 windows/amd64";
const ATTEMPTS = [
  { host: "https://daily-cloudcode-pa.googleapis.com", agent: HUB_AGENT },
  { host: "https://daily-cloudcode-pa.googleapis.com", agent: "antigravity" },
  { host: "https://cloudcode-pa.googleapis.com", agent: HUB_AGENT },
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
          cached.set(account.refresh, { at: Date.now(), body: res.text });
          return res.text;
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
