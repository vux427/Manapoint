// Compatibility fixtures use synthetic bucket IDs and credentials. The displayed
// balances mirror the user's agy screenshot; no real account data is required.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collect, parse, POOLS } from "../src/providers/antigravity.js";

const at = Date.UTC(2026, 9, 15);
const summary = () => ({ groups: [
  { displayName: "GEMINI MODELS", buckets: [
    { bucketId: "new-gemini-week", window: "weekly", remaining: { remainingFraction: 0.9822 } },
    { bucketId: "new-gemini-session", window: "5h", remaining: { case: "remainingFraction", value: 1 } },
  ] },
  { displayName: "CLAUDE AND GPT MODELS", buckets: [
    { bucketId: "new-third-party-week", displayName: "Weekly Limit", remainingFraction: 0.7952 },
    { bucketId: "new-third-party-session", displayName: "Five Hour Limit", remainingFraction: 1 },
  ] },
  { displayName: "GEMINI 4 ARGON", buckets: [
    { bucketId: "gemini-argon-weekly", window: "weekly", remainingFraction: 0.9939 },
  ] },
] });
const read = (pool, root) => parse(pool, JSON.stringify(root), at);

describe("Antigravity summary compatibility", () => {
  it("reads renamed buckets and nested oneof balances, keeping Argon out of Gemini", () => {
    for (const root of [summary(), { response: summary() }, { summary: summary() }]) {
      const gemini = read(POOLS.gemini, root);
      const thirdParty = read(POOLS.thirdParty, root);
      assert.deepEqual(gemini.windows.map((w) => w.kind), ["Rolling", "Weekly", "Weekly"]);
      assert.deepEqual(gemini.windows.map((w) => Math.round(w.percent * 100) / 100), [0, 1.78, 0.61]);
      assert.deepEqual(gemini.windows.map((w) => w.quotaGroup), [undefined, undefined, "Argon"]);
      assert.deepEqual(thirdParty.windows.map((w) => Math.round(w.percent * 100) / 100), [0, 20.48]);
    }
  });

  it("accepts id/name aliases and root buckets when groups are empty", () => {
    const root = { groups: [], buckets: [
      { id: "gemini_session", name: "Session", remainingFraction: 0.75 },
      { id: "gemini-weekly", remainingFraction: 0.5 },
    ] };
    assert.deepEqual(read(POOLS.gemini, root).windows.map((w) => w.percent), [25, 50]);
    assert.deepEqual(read(POOLS.gemini, { buckets: root.buckets }).windows.map((w) => w.percent), [25, 50]);
    const grouped = summary();
    grouped.buckets = root.buckets;
    assert.equal(read(POOLS.gemini, grouped).windows[0].percent, 0);
  });

  it("omits disabled windows and supports weekly-only plans without inventing 5h", () => {
    const root = summary();
    root.groups[0].buckets[1].disabled = true;
    const gemini = read(POOLS.gemini, root);
    assert.deepEqual(gemini.windows.map((w) => w.kind), ["Weekly", "Weekly"]);
    root.groups[0].buckets[0].disabled = true;
    root.groups.pop();
    assert.match(read(POOLS.gemini, root).note, /未啟用/);
  });

  it("does not call empty or unknown groups an account without quota", () => {
    for (const root of [{ groups: [] }, { groups: [{ displayName: "All Models", buckets: [
      { bucketId: "unknown-model", remainingFraction: 1 },
    ] }] }]) {
      assert.throws(() => read(POOLS.gemini, root), (err) => err.kind === "Transient" && err.keepsLastGood);
    }
  });

  it("rejects unknown cadences, missing balances and ambiguous duplicate windows", () => {
    const root = summary();
    root.groups[0].buckets[0].window = "daily";
    assert.throws(() => read(POOLS.gemini, root), /窗口無法辨識/);
    // An explicit unsupported cadence wins even over an old canonical ID.
    root.groups[0].buckets[0].bucketId = "gemini-weekly";
    assert.throws(() => read(POOLS.gemini, root), /窗口無法辨識/);
    delete root.groups[0].buckets[0].window;
    root.groups[0].buckets[0].remaining = { case: "remainingAmount", value: 10 };
    assert.throws(() => read(POOLS.gemini, root), /remainingFraction/);
    root.groups[0].buckets[0].remainingFraction = 0;
    assert.equal(read(POOLS.gemini, root).windows[1].percent, 100);
    root.groups[0].buckets.push({ bucketId: "gemini-weekly", remainingFraction: 0.5 });
    assert.throws(() => read(POOLS.gemini, root), /窗口重複/);
  });
});

async function withRuntime(responses, run) {
  const originalTjs = globalThis.tjs;
  const originalFetch = globalThis.fetch;
  const calls = [];
  const refresh = `synthetic-${Math.random()}`;
  globalThis.tjs = {
    env: { USERPROFILE: "C:/synthetic-home", APPDATA: "C:/synthetic-appdata" },
    readFile: async (path) => {
      if (!path.endsWith("antigravity-accounts.json")) throw new Error("missing");
      return new TextEncoder().encode(JSON.stringify({ accounts: [{ refreshToken: refresh }] }));
    },
  };
  globalThis.fetch = async (url, options) => {
    if (url === "https://oauth2.googleapis.com/token") {
      return { status: 200, text: async () => JSON.stringify({ access_token: "synthetic-access", expires_in: 3600 }) };
    }
    calls.push({ url, ...options });
    const next = responses.shift();
    assert.ok(next, "unexpected quota request");
    return { status: next.status ?? 200, text: async () => JSON.stringify(next.body) };
  };
  try {
    await run(calls);
  } finally {
    globalThis.tjs = originalTjs;
    globalThis.fetch = originalFetch;
  }
}

describe("Antigravity host fallback and shared cache", () => {
  it("tries the fallback for an unusable HTTP 200 and shares validated data between cards", async () => {
    await withRuntime([{ body: { groups: [] } }, { body: summary() }], async (calls) => {
      const [gemini, thirdParty] = await Promise.all([collect(POOLS.gemini), collect(POOLS.thirdParty)]);
      assert.equal(gemini.windows.length, 3);
      assert.equal(thirdParty.windows.length, 2);
      assert.deepEqual(calls.map((c) => new URL(c.url).host), [
        "daily-cloudcode-pa.googleapis.com", "daily-cloudcode-pa.googleapis.com",
      ]);
      assert.deepEqual(calls.map((c) => c.headers["User-Agent"]), [
        "antigravity/hub/2.9.1 windows/amd64", "antigravity",
      ]);
      await collect(POOLS.gemini);
      assert.equal(calls.length, 2);
    });
  });

  it("never caches empty summaries; a later refresh can recover", async () => {
    await withRuntime([{ body: { groups: [] } }, { body: { groups: [] } }, { body: { groups: [] } }, { body: summary() }], async (calls) => {
      await assert.rejects(collect(POOLS.gemini), (err) => err.kind === "Transient");
      const recovered = await collect(POOLS.gemini);
      assert.equal(recovered.windows.length, 3);
      assert.equal(calls.length, 4);
    });
  });

  it("retries with a weaker client when a pool is missing, and keeps the partial if none is complete", async () => {
    const full = summary();
    const noGemini = { groups: full.groups.filter((g) => !/gemini/i.test(g.displayName ?? g.name ?? "")) };
    assert.ok(noGemini.groups.length < full.groups.length, "fixture must contain a Gemini group");
    await withRuntime([{ body: noGemini }, { body: full }], async (calls) => {
      const gemini = await collect(POOLS.gemini);
      assert.equal(gemini.windows.length, 3);
      assert.equal(calls.length, 2);
    });
    await withRuntime([{ body: noGemini }, { body: noGemini }, { body: noGemini }], async (calls) => {
      const gemini = await collect(POOLS.gemini);
      assert.equal(gemini.windows.length, 0);
      assert.equal(calls.length, 3);
    });
  });

  it("keeps a valid pool available when the sibling pool changes shape", async () => {
    const root = summary();
    delete root.groups[1].buckets[0].remainingFraction;
    await withRuntime([{ body: root }], async (calls) => {
      const gemini = await collect(POOLS.gemini);
      assert.equal(gemini.windows.length, 3);
      await assert.rejects(collect(POOLS.thirdParty), /remainingFraction/);
      assert.equal(calls.length, 1);
    });
  });
});
