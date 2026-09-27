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

/** Cards as the panel sees them → the widget payload. New objects only.
 * `settings.widgetWindows` narrows each window to a `visible` flag; the panel
 * ignores it, the widget hides flagged windows. Absent settings mean visible. */
export function payload(cards, settings = null, now = Date.now()) {
  const narrowed = settings?.widgetWindows ?? null;
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
        visible: !narrowed?.[c.id] || narrowed[c.id].includes(w.kind),
      })),
    })),
  };
}

/** Pure routing: { status, headers, body } for any method + path. */
export function route(method, path, cards, settings = null, now = Date.now()) {
  if (method === "OPTIONS") return { status: 204, headers: { ...CORS }, body: "" };
  if (method !== "GET") {
    return { status: 405, headers: { ...CORS, "Content-Type": JSON_TYPE }, body: '{"error":"method not allowed"}' };
  }
  if (path === "/v1/usage") {
    return {
      status: 200,
      headers: { ...CORS, "Content-Type": JSON_TYPE },
      body: JSON.stringify(payload(cards, settings, now)),
    };
  }
  if (path === "/" || path === "/v1") {
    return { status: 200, headers: { ...CORS, "Content-Type": "text/plain" }, body: "manapoint local api: GET /v1/usage" };
  }
  return { status: 404, headers: { ...CORS, "Content-Type": JSON_TYPE }, body: '{"error":"not found"}' };
}

/** Null means disabled via MANAPOINT_LOCAL_API=0. */
export function portFromEnv(env) {
  if (env("MANAPOINT_LOCAL_API") === "0") return null;
  const raw = Number(env("MANAPOINT_LOCAL_API_PORT"));
  return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : DEFAULT_PORT;
}

/** Start the loopback server; returns the server or null when off.
 * getSnapshot() returns { cards, settings } fresh per request. */
export function start(getSnapshot, env, log = () => {}) {
  const port = portFromEnv(env);
  const serve = globalThis.tjs?.serve;
  if (port === null || typeof serve !== "function") return null;
  try {
    const server = serve({
      listenIp: LOOPBACK,
      port,
      fetch: async (req) => {
        const snap = getSnapshot();
        const r = route(req.method, new URL(req.url).pathname, snap.cards, snap.settings);
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
