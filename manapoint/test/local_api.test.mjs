// Local HTTP API: payload shape, routing and env handling.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { payload, portFromEnv, route, DEFAULT_PORT } from "../src/lib/local_api.js";

const card = {
  id: "codex",
  name: "Codex",
  badge: { icon: "OpenAI", text: null, background: "#000000", foreground: "#FFFFFF" },
  windows: [{ kind: "Weekly", percent: 82.4, resetsAt: "2026-11-02T00:00:00Z", projected: 140 }],
  note: null,
  error: null,
};

describe("payload", () => {
  it("strips cards to what a widget needs, with a timestamp", () => {
    const p = payload([card], Date.UTC(2026, 8, 20));
    assert.equal(p.app, "manapoint");
    assert.equal(p.version, 1);
    assert.equal(p.updatedAt, "2026-09-20T00:00:00.000Z");
    assert.deepEqual(p.cards, [
      {
        id: "codex",
        name: "Codex",
        badge: { icon: "OpenAI", text: null, background: "#000000", foreground: "#FFFFFF" },
        note: null,
        error: null,
        windows: [{ kind: "Weekly", percent: 82.4, resetsAt: "2026-11-02T00:00:00Z" }],
      },
    ]);
  });

  it("keeps notes and errors, tolerates missing fields", () => {
    const p = payload([{ id: "grok", name: "Grok", error: "壞了" }]);
    assert.deepEqual(p.cards, [{ id: "grok", name: "Grok", badge: null, note: null, error: "壞了", windows: [] }]);
    assert.deepEqual(payload(null).cards, []);
  });
});

describe("route", () => {
  it("serves the payload as JSON with CORS headers", () => {
    const r = route("GET", "/v1/usage", [card]);
    assert.equal(r.status, 200);
    assert.equal(r.headers["Access-Control-Allow-Origin"], "*");
    assert.match(r.headers["Content-Type"], /application\/json/);
    assert.equal(JSON.parse(r.body).cards[0].id, "codex");
  });

  it("answers preflight, health and misses", () => {
    assert.equal(route("OPTIONS", "/v1/usage", []).status, 204);
    assert.equal(route("GET", "/", []).status, 200);
    const missing = route("GET", "/nope", []);
    assert.equal(missing.status, 404);
    assert.equal(JSON.parse(missing.body).error, "not found");
    assert.equal(route("POST", "/v1/usage", []).status, 405);
  });
});

describe("portFromEnv", () => {
  const env = (vars) => (name) => vars[name] ?? null;
  it("defaults, honours overrides, disables on 0", () => {
    assert.equal(portFromEnv(env({})), DEFAULT_PORT);
    assert.equal(portFromEnv(env({ MANAPOINT_LOCAL_API_PORT: "8080" })), 8080);
    assert.equal(portFromEnv(env({ MANAPOINT_LOCAL_API_PORT: "junk" })), DEFAULT_PORT);
    assert.equal(portFromEnv(env({ MANAPOINT_LOCAL_API: "0" })), null);
  });
});
