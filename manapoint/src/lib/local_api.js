// Local HTTP API for first-party companions (e.g. the iCUE LCD widget).
//
// One read-only endpoint on loopback only: GET /v1/usage returns the same cards
// the panel shows, as JSON, with permissive CORS so a browser-context widget
// (Chromium with a null origin) can poll it. The payload carries percentages
// and reset times only — never a credential — like the on-disk snapshot.
//
// payload()/route()/portFromEnv() are pure and run under Node tests; only
// start() touches the txiki runtime, and it never throws: a port clash (or an
// older runtime without tjs.serve) just leaves the endpoint off.

export const DEFAULT_PORT = 47901;
export const LOOPBACK = "127.0.0.1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const JSON_TYPE = "application/json";

/** Cards as the panel sees them → the widget payload. New objects only. */
export function payload(cards, now = Date.now()) {
  return {
    app: "manapoint",
    version: 1,
    updatedAt: new Date(now).toISOString(),
    cards: (cards ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      badge: c.badge ?? null,
      note: c.note ?? null,
      error: c.error ?? null,
      windows: (c.windows ?? []).map((w) => ({
        kind: w.kind,
        percent: w.percent,
        resetsAt: w.resetsAt ?? null,
        ...(typeof w.quotaGroup === "string" ? { quotaGroup: w.quotaGroup } : {}),
      })),
    })),
  };
}

/**
 * Cards as the panel itself shows them → the richer feed for panel-like companions
 * (the Herdr status bar): every window field the panel uses survives — account
 * and quotaGroup. Still only percentages, times and messages; never a credential.
 * New objects only.
 */
export function fullPayload(cards, now = Date.now()) {
  return {
    app: "manapoint",
    version: 1,
    updatedAt: new Date(now).toISOString(),
    cards: (cards ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      badge: c.badge ?? null,
      note: c.note ?? null,
      error: c.error ?? null,
      windows: (c.windows ?? []).map((w) => ({
        kind: w.kind,
        percent: w.percent,
        resetsAt: w.resetsAt ?? null,
        ...(typeof w.quotaGroup === "string" ? { quotaGroup: w.quotaGroup } : {}),
        ...(typeof w.account === "string" ? { account: w.account } : {}),
      })),
    })),
  };
}

/** Pure routing: { status, headers, body } for any method + path. `panelCards`
 * (default: `cards`) are the panel's narrowed cards, served on /v1/cards. */
export function route(method, path, cards, now = Date.now(), panelCards = cards, getHistory = () => []) {
  if (method === "OPTIONS") return { status: 204, headers: { ...CORS }, body: "" };
  if (method !== "GET") {
    return { status: 405, headers: { ...CORS, "Content-Type": JSON_TYPE }, body: '{"error":"method not allowed"}' };
  }
  if (path === "/v1/usage") {
    return {
      status: 200,
      headers: { ...CORS, "Content-Type": JSON_TYPE },
      body: JSON.stringify(payload(cards, now)),
    };
  }
  if (path === "/v1/cards") {
    return {
      status: 200,
      headers: { ...CORS, "Content-Type": JSON_TYPE },
      body: JSON.stringify({ ...fullPayload(panelCards, now), source: "app" }),
    };
  }
  if (path === "/v1/history") {
    const list = typeof getHistory === "function" ? getHistory() : (Array.isArray(getHistory) ? getHistory : []);
    return {
      status: 200,
      headers: { ...CORS, "Content-Type": JSON_TYPE },
      body: JSON.stringify({ ok: true, history: list }),
    };
  }
  if (path === "/" || path === "/v1") {
    return { status: 200, headers: { ...CORS, "Content-Type": "text/plain" }, body: "manapoint local api: GET /v1/usage, GET /v1/cards, GET /v1/history" };
  }
  return { status: 404, headers: { ...CORS, "Content-Type": JSON_TYPE }, body: '{"error":"not found"}' };
}

/** Null means disabled via MANAPOINT_LOCAL_API=0. */
export function portFromEnv(env) {
  if (env("MANAPOINT_LOCAL_API") === "0") return null;
  const raw = Number(env("MANAPOINT_LOCAL_API_PORT"));
  return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : DEFAULT_PORT;
}

/** Start the loopback server; returns the server or null when off. `getPanelCards`
 * (default: `getCards`) feeds /v1/cards; `getHistory` feeds /v1/history. */
export function start(getCards, env, log = () => {}, getPanelCards = getCards, getHistory = () => []) {
  const port = portFromEnv(env);
  const serve = globalThis.tjs?.serve;
  if (port === null || typeof serve !== "function") return null;
  try {
    const server = serve({
      listenIp: LOOPBACK,
      port,
      fetch: async (req) => {
        const path = new URL(req.url).pathname;
        const r = route(
          req.method,
          path,
          getCards(),
          Date.now(),
          path === "/v1/cards" ? getPanelCards() : undefined,
          getHistory
        );
        // 204 must carry a null body or the Response constructor throws.
        return new Response(r.status === 204 ? null : r.body, { status: r.status, headers: r.headers });
      },
    });
    log(`[manapoint] local api on http://${LOOPBACK}:${port}/v1/usage`);
    return server;
  } catch (err) {
    log(`[manapoint] local api not started: ${err?.message ?? err}`);
    return null;
  }
}
