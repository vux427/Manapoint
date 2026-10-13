// Reference-shaped fixtures with synthetic credentials exercise the actual
// collector without contacting Meta or reading a developer's CLI login.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collect, parse } from "../src/providers/muse.js";
import { accessToken, parseEntry } from "../src/providers/muse_token.js";
import { museAuth } from "../src/lib/paths.js";
import * as registry from "../src/providers/registry.js";
import * as cards from "../src/lib/cards.js";
import { payload } from "../src/lib/local_api.js";

const at = Date.UTC(2026, 9, 14);
const reply = () => ({
  is_subs_active: true,
  require_payment: false,
  subs_tier_name: "Muse Code Power Usage",
  api_key: "LLM|synthetic-inference-secret",
  user_email: "synthetic@example.invalid",
  payment_method: { last_four: "1234" },
  subs_usage: {
    window: { window_duration_mins: 300, used_percent: 12.5, resets_at: 1791946800 },
    weekly: { used_percent: 63, resets_at: 1792454400 },
  },
});
const parseReply = (root) => parse(JSON.stringify(root), at);
const credentials = (token = "dca:synthetic-login-secret") => JSON.stringify({
  schema_version: 1, providers: { meta: { mechanism: "oauth", access_token: token } },
});

async function withRuntime({ auth = credentials(), env = {}, status = 200, body = reply() } = {}, run) {
  const originalTjs = globalThis.tjs;
  const originalFetch = globalThis.fetch;
  const reads = [];
  const requests = [];
  globalThis.tjs = {
    env: { USERPROFILE: "C:/synthetic-home", ...env },
    readFile: async (path) => {
      reads.push(path);
      if (auth === null) throw new Error("missing");
      return new TextEncoder().encode(typeof auth === "function" ? auth() : auth);
    },
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options });
    return { status, text: async () => typeof body === "string" ? body : JSON.stringify(body) };
  };
  try {
    return await run({ reads, requests });
  } finally {
    globalThis.tjs = originalTjs;
    globalThis.fetch = originalFetch;
  }
}

describe("Muse Code quota", () => {
  it("maps five-hour and weekly usage, discarding all credentials and account metadata", () => {
    const u = parseReply(reply());
    assert.deepEqual(u, {
      provider: "Muse Code", collectedAt: new Date(at).toISOString(), note: null,
      windows: [
        { kind: "Rolling", percent: 12.5, resetsAt: new Date(1791946800 * 1000).toISOString() },
        { kind: "Weekly", percent: 63, resetsAt: new Date(1792454400 * 1000).toISOString() },
      ],
    });
    assert.doesNotMatch(JSON.stringify(u), /secret|payment|example|Power Usage/);
  });

  it("keeps legitimate zero usage and clamps percentages to the wire range", () => {
    const root = reply();
    root.subs_usage.window.used_percent = 0;
    assert.equal(parseReply(root).windows[0].percent, 0);
    root.subs_usage.window.used_percent = -2;
    root.subs_usage.weekly.used_percent = 150;
    assert.deepEqual(parseReply(root).windows.map((w) => w.percent), [0, 100]);
  });

  it("keeps percentages when an optional reset is missing, malformed or out of range", () => {
    for (const reset of [undefined, null, "bad", 0, -1, 1e100]) {
      const root = reply();
      root.subs_usage.window.resets_at = reset;
      assert.equal(parseReply(root).windows[0].resetsAt, null);
      assert.equal(parseReply(root).windows[0].percent, 12.5);
    }
    const root = reply();
    root.subs_usage.window.resets_at = 1791946800.125;
    assert.equal(parseReply(root).windows[0].resetsAt, "2026-10-14T03:00:00.125Z");
  });

  it("explains missing quota for an active subscription without inventing bars", () => {
    for (const missing of [undefined, null]) {
      const root = reply();
      root.subs_usage = missing;
      const u = parseReply(root);
      assert.deepEqual(u.windows, []);
      assert.match(u.note, /已訂閱.*未提供用量/);
    }
  });

  it("explains inactive subscriptions and incomplete billing", () => {
    const inactive = parseReply({ is_subs_active: false });
    assert.deepEqual(inactive.windows, []);
    assert.match(inactive.note, /沒有有效/);
    const payment = parseReply({ require_payment: true, is_subs_active: false });
    assert.deepEqual(payment.windows, []);
    assert.match(payment.note, /付款設定/);
  });

  it("rejects changed response shapes and missing or nonnumeric window percentages", () => {
    for (const root of [null, [], {}, { is_subs_active: "true" },
      { is_subs_active: true, require_payment: 0 }, { is_subs_active: true, subs_usage: [] }]) {
      assert.throws(() => parseReply(root), (err) => err.kind === "Failed");
    }
    for (const field of ["window", "weekly"]) {
      for (const bad of [undefined, null, "12.5", {}]) {
        const root = reply();
        root.subs_usage[field].used_percent = bad;
        assert.throws(() => parseReply(root), (err) => err.kind === "Failed");
      }
      const root = reply();
      delete root.subs_usage[field];
      assert.throws(() => parseReply(root), (err) => err.kind === "Failed");
    }
  });

  it("does not label a changed duration as five hours", () => {
    for (const duration of [undefined, null, 60, "300", 0, -300]) {
      const root = reply();
      root.subs_usage.window.window_duration_mins = duration;
      assert.throws(() => parseReply(root), /window_duration_mins/);
    }
  });

  it("does not echo secrets from malformed JSON", () => {
    assert.throws(() => parse('LLM|synthetic-inference-secret', at), (err) =>
      err.kind === "Failed" && !err.message.includes("secret"));
  });
});

describe("Muse Code CLI credentials", () => {
  it("only accepts a nonempty device-code token", () => {
    assert.deepEqual(parseEntry(JSON.parse(credentials("  dca:synthetic  "))), { access: "dca:synthetic" });
    for (const token of [undefined, null, {}, "", " ", "dca:", "dca:bad token", "dca:bad\nheader", "dca:bad\u0000header", "LLM_inference", "LLM|inference"]) {
      assert.equal(parseEntry({ providers: { meta: { access_token: token } } }), null);
    }
    for (const root of [null, [], {}, { providers: { meta: { api_key: "LLM|inference" } } },
      { providers: { meta: { mechanism: "oauth", storage: "keychain" } } }]) {
      assert.equal(parseEntry(root), null);
    }
  });

  it("uses MUSE_AUTH_PATH, then XDG_CONFIG_HOME, then the CLI's home path", async () => {
    await withRuntime({}, async () => assert.equal(museAuth(), "C:/synthetic-home/.config/muse/auth.json"));
    await withRuntime({ env: { XDG_CONFIG_HOME: "D:\\config\\" } }, async () =>
      assert.equal(museAuth(), "D:/config/muse/auth.json"));
    await withRuntime({ env: { MUSE_AUTH_PATH: " D:\\login\\auth.json ", XDG_CONFIG_HOME: "D:/ignored" } }, async () =>
      assert.equal(museAuth(), "D:/login/auth.json"));
    await withRuntime({ env: { MUSE_AUTH_PATH: "  ", XDG_CONFIG_HOME: "  " } }, async () =>
      assert.equal(museAuth(), "C:/synthetic-home/.config/muse/auth.json"));
  });

  it("accepts a BOM and rejects malformed credential files without exposing their contents", async () => {
    await withRuntime({ auth: "\uFEFF" + credentials() }, async () =>
      assert.equal(await accessToken(), "dca:synthetic-login-secret"));
    await withRuntime({ auth: "dca:synthetic-login-secret" }, async () =>
      assert.rejects(accessToken(), (err) => err.kind === "Failed" && !err.message.includes("secret")));
  });

  it("directs missing and inference-only logins to muse login without a network request", async () => {
    for (const auth of [null, credentials("LLM|inference"), JSON.stringify({ providers: { meta: { api_key: "LLM_inference" } } })]) {
      await withRuntime({ auth }, async ({ requests }) => {
        await assert.rejects(collect(), (err) => err.kind === "NotReady" && /muse login/.test(err.message));
        assert.equal(requests.length, 0);
      });
    }
  });
});

describe("Muse Code collector and integration", () => {
  it("sends the CLI's device token only to Meta's quota endpoint with the expected request", async () => {
    await withRuntime({}, async ({ reads, requests }) => {
      const reading = await collect();
      assert.equal(reading.windows.length, 2);
      assert.deepEqual(reads, ["C:/synthetic-home/.config/muse/auth.json"]);
      assert.equal(requests.length, 1);
      const req = requests[0];
      assert.equal(req.url, "https://api.meta.ai/muse-code/key");
      assert.equal(req.method, "POST");
      assert.deepEqual(JSON.parse(req.body), {});
      assert.equal(req.headers.Authorization, "Bearer dca:synthetic-login-secret");
      assert.equal(req.headers["x-api-version"], "1.0.0");
      assert.equal(req.headers["Content-Type"], "application/json");
      assert.equal(req.headers["User-Agent"], "Manapoint");
    });
  });

  it("re-reads the CLI file on each poll instead of caching or writing credentials", async () => {
    let token = "dca:first";
    await withRuntime({ auth: () => credentials(token) }, async ({ requests }) => {
      await collect();
      token = "dca:second";
      await collect();
      assert.deepEqual(requests.map((req) => req.headers.Authorization), ["Bearer dca:first", "Bearer dca:second"]);
    });
  });

  it("classifies login rejections and rate limits, keeping the last good reading", async () => {
    for (const [status, kind] of [[401, "NotReady"], [403, "NotReady"], [429, "Transient"]]) {
      await withRuntime({ status }, async () => {
        let reason;
        try { await collect(); } catch (err) { reason = err; }
        assert.equal(reason.kind, kind);
        const previous = parseReply(reply());
        const card = cards.fromOutcomes([registry.byId("muse-code")],
          [{ status: "rejected", reason }], { "muse-code": previous })[0];
        assert.deepEqual(card.windows, previous.windows);
        assert.equal(card.error, null);
        assert.ok(card.note);
      });
    }
  });

  it("keeps error responses out of diagnostics", async () => {
    await withRuntime({ status: 500, body: { api_key: "LLM|synthetic-secret" } }, async () => {
      await assert.rejects(collect(), (err) => err.kind === "Failed" && err.detail === null && !err.message.includes("secret"));
    });
  });

  it("exposes Muse to settings and the loopback feed while respecting saved enablement", () => {
    const p = registry.byId("muse-code");
    assert.equal(registry.descriptor(p).name, "Muse Code");
    assert.ok(p.badge.icon === null && p.badge.text);
    assert.ok(registry.defaultEnabled().includes(p.id));
    assert.deepEqual(registry.enabled({ enabledProviders: ["codex"] }).map((x) => x.id), ["codex"]);
    assert.deepEqual(registry.enabled({ enabledProviders: [p.id] }).map((x) => x.id), [p.id]);
    const list = cards.fromOutcomes([p], [{ status: "fulfilled", value: parseReply(reply()) }], {});
    const feed = payload(list);
    assert.equal(feed.cards[0].id, "muse-code");
    assert.equal(feed.cards[0].windows[1].percent, 63);
    assert.doesNotMatch(JSON.stringify(feed), /secret|payment|example/);
  });
});
