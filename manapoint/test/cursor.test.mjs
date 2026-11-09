// Reference-shaped responses and synthetic logins exercise subscription collection
// without contacting Cursor or opening a developer's credential stores.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collect, parse } from "../src/providers/cursor.js";
import { logins, sessionFromToken } from "../src/providers/cursor_token.js";
import { readAccessToken } from "../src/lib/cursor_db.js";
import { cursorAuthPaths, cursorStateDb } from "../src/lib/paths.js";
import * as registry from "../src/providers/registry.js";
import * as cards from "../src/lib/cards.js";
import { payload } from "../src/lib/local_api.js";
import { snapshot } from "../src/lib/usage_history.js";
import { ICONS } from "../src/frontend/icons.js";
import { compactWindows } from "../src/frontend/quota_groups.js";
import { providerIcon as statusIcon } from "../../herdr-mod/mods/manapoint-status/format.js";
import { providerIcon as popupIcon } from "../../herdr-mod/mods/manapoint-popup/format.js";

const at = Date.UTC(2026, 10, 10);
const reset = "2026-12-01T00:00:00.000Z";
const token = (sub = "auth0|user_synthetic", version = 1) =>
  "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ sub, exp: 1900000000, version })).toString("base64url") + ".synthetic";
const auth = (accessToken = token()) => JSON.stringify({ accessToken, refreshToken: "synthetic-secret" });
const reply = (plan = { enabled: true, used: 250, limit: 2000, totalPercentUsed: 12.5 }) => ({
  billingCycleStart: "2026-11-01T00:00:00Z", billingCycleEnd: reset, membershipType: "pro",
  individualUsage: { plan, onDemand: { used: 5000, limit: 10000 } },
  email: "synthetic@example.invalid", accessToken: "synthetic-response-secret",
});
const parseReply = (root) => parse(JSON.stringify(root), at);

async function withRuntime({ files = {}, env = {}, respond = () => ({ status: 200, body: reply() }) } = {}, run) {
  const originalTjs = globalThis.tjs;
  const originalFetch = globalThis.fetch;
  const reads = [], requests = [];
  globalThis.tjs = {
    env: { USERPROFILE: "C:/synthetic-home", APPDATA: "C:/synthetic-data", ...env },
    readFile: async (path) => {
      reads.push(path);
      const value = typeof files[path] === "function" ? files[path]() : files[path];
      if (value === undefined || value === null) throw new Error("missing");
      return new TextEncoder().encode(value);
    },
    stat: async () => { throw new Error("missing"); },
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, ...options });
    const res = respond(requests.at(-1), requests.length);
    return { status: res.status, text: async () => typeof res.body === "string" ? res.body : JSON.stringify(res.body) };
  };
  try { return await run({ reads, requests }); }
  finally { globalThis.tjs = originalTjs; globalThis.fetch = originalFetch; }
}

const cliPath = "C:/synthetic-home/.config/cursor/cli-config.json";
const legacyPath = "C:/synthetic-home/.cursor/auth.json";

describe("Cursor subscription usage", () => {
  it("uses the measured total percentage and actual billing reset, discarding account and spend data", () => {
    const reading = parseReply(reply());
    assert.deepEqual(reading, {
      provider: "Cursor", collectedAt: new Date(at).toISOString(), note: null,
      windows: [{ kind: "Monthly", percent: 12.5, resetsAt: reset }],
    });
    assert.doesNotMatch(JSON.stringify(reading), /secret|email|onDemand|membershipType|example/);
  });

  it("keeps fractional percentages in percent units, accepts zero and clamps overflow", () => {
    for (const [value, expected] of [[0, 0], [0.36, 0.36], [-2, 0], [123, 100]]) {
      assert.equal(parseReply(reply({ totalPercentUsed: value })).windows[0].percent, expected);
    }
  });

  it("derives a total from used/limit in cents and never treats breakdown.total as the cap", () => {
    const reading = parseReply(reply({ used: 1000, limit: 2000, breakdown: { total: 1000 } }));
    assert.equal(reading.windows[0].percent, 50);
    assert.equal(parseReply(reply({ used: 0, limit: 2000 })).windows[0].percent, 0);
  });

  it("preserves independent Auto/API pools when a total is absent, without averaging", () => {
    const reading = parseReply(reply({ autoPercentUsed: 0.36, apiPercentUsed: 83 }));
    assert.deepEqual(reading.windows.map((w) => [w.quotaGroup, w.percent]), [["Auto", 0.36], ["API", 83]]);
    assert.equal(compactWindows(reading.windows, ["Rolling", "Weekly", "Monthly"]).filter(Boolean).length, 2);
    assert.equal(parseReply(reply({ totalPercentUsed: 9, autoPercentUsed: 2, apiPercentUsed: 83 })).windows.length, 1);
  });

  it("supports enterprise personal caps and explicitly labels a shared team pool", () => {
    const root = reply(null);
    root.individualUsage.overall = { used: 3000, limit: 10000 };
    root.teamUsage = { pooled: { used: 500, limit: 1000 } };
    assert.deepEqual(parseReply(root).windows, [{ kind: "Monthly", percent: 30, resetsAt: reset }]);
    delete root.individualUsage.overall;
    assert.deepEqual(parseReply(root).windows, [{ kind: "Monthly", percent: 50, resetsAt: reset, quotaGroup: "團隊共用" }]);
  });

  it("explains uncapped or disabled plans without fabricating a zero bar", () => {
    for (const plan of [{ enabled: false }, { used: 100, limit: null }, { used: 0, limit: 0 }]) {
      const reading = parseReply(reply(plan));
      assert.deepEqual(reading.windows, []);
      assert.ok(reading.note);
    }
    assert.deepEqual(parseReply({ isUnlimited: true }).windows, []);
    assert.throws(() => parseReply(reply({ breakdown: { total: 1000 } })), /訂閱用量/);
  });

  it("retains valid usage without an optional reset and accepts long timestamp fractions", () => {
    for (const end of [undefined, null, "bad", 0]) {
      assert.equal(parseReply({ ...reply(), billingCycleEnd: end }).windows[0].resetsAt, null);
    }
    assert.equal(parseReply({ ...reply(), billingCycleEnd: "2026-12-01T08:00:00.123456+08:00" }).windows[0].resetsAt,
      "2026-12-01T00:00:00.123Z");
  });

  it("rejects changed shapes and missing or nonnumeric amounts instead of inventing usage", () => {
    for (const root of [null, [], {}, { individualUsage: [] }, reply([]), reply({}),
      reply({ totalPercentUsed: "12" }), reply({ used: null, limit: 100 }),
      reply({ used: "12", limit: 100 }), reply({ used: -1, limit: 100 }),
      reply({ used: 1, limit: -2 }), reply({ apiPercentUsed: "5" }), reply({ enabled: "false" })]) {
      assert.throws(() => parseReply(root), (err) => err.kind === "Failed");
    }
    assert.throws(() => parse("synthetic-secret", at), (err) => err.kind === "Failed" && !err.message.includes("secret"));
  });
});

describe("Cursor local login discovery", () => {
  it("builds a dashboard session from the CLI or desktop JWT subject", () => {
    const session = sessionFromToken("  " + token() + "  ");
    assert.equal(session.identity, "user_synthetic");
    assert.equal(session.cookie, "WorkosCursorSessionToken=user_synthetic%3A%3A" + token());
    for (const raw of [null, {}, "cursor-agent", "key_123", "cursor-safe-storage:v1:encrypted", token("bad;injection"),
      token("bad\r\nheader"), token() + "\nheader", "a.e30.c"]) assert.equal(sessionFromToken(raw), null);
  });

  it("honors XDG and opencode-cursor's home override while keeping desktop auth under APPDATA", async () => {
    await withRuntime({ env: { XDG_CONFIG_HOME: "D:\\config\\", CURSOR_ACP_HOME_DIR: "D:\\agent-home\\" } }, async () => {
      assert.equal(cursorAuthPaths()[0], "D:/config/cursor/cli-config.json");
      assert.ok(cursorAuthPaths().includes("D:/agent-home/.cursor/auth.json"));
      assert.equal(cursorStateDb(), "C:/synthetic-data/Cursor/User/globalStorage/state.vscdb");
    });
    await withRuntime({ env: { APPDATA: null, XDG_CONFIG_HOME: "/tmp/config" } }, async () =>
      assert.equal(cursorStateDb(), "/tmp/config/Cursor/User/globalStorage/state.vscdb"));
    await withRuntime({}, async () => assert.equal(new Set(cursorAuthPaths()).size, cursorAuthPaths().length));
  });

  it("discovers BOM-prefixed current and legacy files, deduplicating the same token", async () => {
    await withRuntime({ files: { [cliPath]: "\uFEFF" + auth(), [legacyPath]: auth() } }, async () => {
      const found = await logins(async () => token());
      assert.equal(found.length, 1);
      assert.equal(found[0].session.identity, "user_synthetic");
    });
  });

  it("ignores inference keys and missing logins without making a request", async () => {
    await withRuntime({ env: { CURSOR_API_KEY: "synthetic-key" }, files: { [cliPath]: '{"apiKey":"synthetic-key"}' } },
      async ({ requests }) => {
        await assert.rejects(collect(), (err) => err.kind === "NotReady" && /cursor-agent login/.test(err.message));
        assert.equal(requests.length, 0);
      });
  });

  it("reads only the desktop access-token entry and always closes its read-only database", async () => {
    await withRuntime({}, async () => {
      globalThis.tjs.stat = async () => ({});
      const calls = [];
      const db = {
        exec: (sql) => calls.push(sql),
        prepare: (sql) => { calls.push(sql); return { all: () => [{ value: token() }], finalize: () => calls.push("finalize") }; },
        close: () => calls.push("close"),
      };
      assert.equal(await readAccessToken(async (path) => {
        assert.equal(path, cursorStateDb()); return db;
      }), token());
      assert.match(calls[1], /^SELECT value FROM ItemTable WHERE key = 'cursorAuth\/accessToken'/);
      assert.deepEqual(calls.slice(-2), ["finalize", "close"]);
      db.prepare = () => { throw new Error("synthetic-secret"); };
      await assert.rejects(readAccessToken(async () => db), (err) => err.kind === "Transient" && !err.message.includes("secret"));
      assert.equal(calls.at(-1), "close");
    });
  });
});

describe("Cursor collection and integration", () => {
  it("uses the local login only on the dashboard summary request", async () => {
    await withRuntime({ files: { [cliPath]: auth() } }, async ({ requests }) => {
      const reading = await collect();
      assert.equal(reading.windows[0].percent, 12.5);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, "https://cursor.com/api/usage-summary");
      assert.equal(requests[0].method, "GET");
      assert.equal(requests[0].headers.Cookie, sessionFromToken(token()).cookie);
      assert.equal(requests[0].body, undefined);
      assert.doesNotMatch(JSON.stringify(reading), /synthetic|identity|cookie|access/);
    });
  });

  it("uses desktop auth even when one CLI source is corrupt", async () => {
    await withRuntime({ files: { [cliPath]: "synthetic-secret" } }, async ({ requests }) => {
      const reading = await collect({ readDbToken: async () => token() });
      assert.equal(reading.windows[0].percent, 12.5);
      assert.equal(requests.length, 1);
    });
  });

  it("keeps distinct accounts, merging CLI/desktop routes that identify the same account", async () => {
    await withRuntime({ files: { [cliPath]: auth(), [legacyPath]: auth(token("auth0|user_other")) } }, async () => {
      const reading = await collect({ readDbToken: async () => token("auth0|user_synthetic", 2) });
      assert.equal(reading.windows.length, 2);
      assert.deepEqual(reading.windows.map((w) => w.account), ["Cursor CLI", "Cursor CLI #2"]);
      assert.doesNotMatch(JSON.stringify(reading), /user_synthetic|user_other|identity/);
    });
  });

  it("re-reads each poll and retries once if Cursor rotates a rejected login", async () => {
    let current = token();
    await withRuntime({ files: { [cliPath]: () => auth(current) }, respond: (_, index) => {
      if (index === 1) { current = token("auth0|user_synthetic", 2); return { status: 401, body: {} }; }
      return { status: 200, body: reply() };
    } }, async ({ requests }) => {
      await collect();
      assert.equal(requests.length, 2);
      assert.notEqual(requests[0].headers.Cookie, requests[1].headers.Cookie);
      current = token("auth0|user_synthetic", 3);
      await collect();
      assert.equal(requests.length, 3);
      assert.equal(requests[2].headers.Cookie, sessionFromToken(current).cookie);
    });
  });

  it("retains the last reading for expired logins and rate limits, without exposing response bodies", async () => {
    for (const [status, kind] of [[401, "NotReady"], [403, "NotReady"], [429, "Transient"], [500, "Failed"]]) {
      await withRuntime({ files: { [cliPath]: auth() }, respond: () => ({ status, body: "synthetic-secret" }) }, async ({ requests }) => {
        let reason;
        try { await collect(); } catch (err) { reason = err; }
        assert.equal(reason.kind, kind);
        assert.doesNotMatch(JSON.stringify(reason), /secret/);
        assert.equal(requests.length, 1);
        const previous = parseReply(reply());
        const card = cards.fromOutcomes([registry.byId("cursor")], [{ status: "rejected", reason }], { cursor: previous })[0];
        assert.equal(card.windows.length, kind === "Failed" ? 0 : 1);
      });
    }
  });

  it("registers settings, icons, history and companion feeds without changing saved enablement", () => {
    const provider = registry.byId("cursor");
    assert.ok(ICONS[provider.badge.icon]);
    assert.ok(registry.defaultEnabled().includes("cursor"));
    assert.deepEqual(registry.enabled({ enabledProviders: ["codex"] }).map((p) => p.id), ["codex"]);
    const list = cards.fromOutcomes([provider], [{ status: "fulfilled", value: parseReply(reply()) }], {});
    assert.equal(payload(list).cards[0].windows[0].percent, 12.5);
    assert.equal(snapshot(list, at).cards[0].id, "cursor");
    assert.equal(statusIcon("cursor"), "mods/manapoint-status/icons/cursor.svg");
    assert.equal(popupIcon("cursor"), "mods/manapoint-popup/icons/cursor.svg");
    assert.doesNotMatch(JSON.stringify(payload(list)), /secret|example/);
  });
});
