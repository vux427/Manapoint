// Multi-account: discovery, labelling, merging, and keeping a failed account's bars.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { collectRoutes, labelled } from "../src/lib/accounts.js";
import { failed, notReady, transient } from "../src/lib/errors.js";
import { accountsFrom } from "../src/providers/opencode_go.js";
import { pluginAccounts } from "../src/providers/antigravity_token.js";

const reading = (percent, note = null) => ({
  provider: "P",
  windows: [{ kind: "Weekly", percent, resetsAt: null }],
  collectedAt: "2026-09-26T00:00:00.000Z",
  note,
});

describe("labelled", () => {
  it("fills missing labels and disambiguates duplicates", () => {
    const out = labelled([{ label: "Go" }, { label: null }, { label: "Go" }, {}], "帳號");
    assert.deepEqual(out.map((a) => a.label), ["Go", "帳號 2", "Go #2", "帳號 4"]);
  });
});

describe("collectRoutes", () => {
  const route = (label, run, identity) => ({ label, run, identity });
  const bars = (percent, reset = "2026-09-28T00:00:00.000Z") => ({
    provider: "P", collectedAt: "x", note: null,
    windows: [{ kind: "Weekly", percent, resetsAt: reset }],
  });

  it("no route at all is NotReady with the given message", async () => {
    await assert.rejects(collectRoutes("P", [], "請登入"), (e) => e.kind === "NotReady" && e.message === "請登入");
  });

  it("a failing route is ignored when another answers", async () => {
    const u = await collectRoutes("P", [
      route("CLI", async () => { throw notReady("過期"); }),
      route("opencode", async () => bars(40)),
    ]);
    assert.equal(u.windows[0].percent, 40);
    assert.equal(u.windows[0].account, undefined);
  });

  it("every route failing fails with the first route's reason", async () => {
    await assert.rejects(collectRoutes("P", [
      route("CLI", async () => { throw transient("逾時"); }),
      route("opencode", async () => { throw failed("壞了"); }),
    ]), (e) => e.message === "逾時" && e.keepsLastGood);
  });

  it("two routes into one account (same numbers) are one account", async () => {
    const u = await collectRoutes("P", [route("A", async () => bars(40)), route("B", async () => bars(40))]);
    assert.equal(u.windows.length, 1);
    assert.equal(u.windows[0].account, undefined);
  });

  it("identities decide when both routes know one; they never reach the reading", async () => {
    const same = await collectRoutes("P", [
      route("A", async () => ({ ...bars(40), identity: "acc-1" })),
      route("B", async () => bars(41), "acc-1"),
    ]);
    assert.equal(same.windows.length, 1);
    assert.equal(same.identity, undefined);
    const two = await collectRoutes("P", [
      route("A", async () => bars(40), "acc-1"),
      route("B", async () => bars(40), "acc-2"),
    ]);
    assert.deepEqual(two.windows.map((w) => w.account), ["A", "B"]);
  });

  it("different accounts get tagged groups; a note-only route yields to real numbers", async () => {
    const u = await collectRoutes("P", [
      route("Go", async () => bars(12)),
      route("Zen", async () => ({ ...bars(0), windows: [], note: "此帳號沒有 Go 訂閱" })),
      route("work", async () => bars(88, "2026-09-29T00:00:00.000Z")),
    ]);
    assert.deepEqual(u.windows.map((w) => `${w.account}:${w.percent}`), ["Go:12", "work:88"]);
    assert.equal(u.note, null);
  });

  it("only notes: the first route's note stands", async () => {
    const u = await collectRoutes("P", [route("Zen", async () => ({ ...bars(0), windows: [], note: "無訂閱" }))]);
    assert.equal(u.note, "無訂閱");
  });
});

describe("opencode accounts", () => {
  it("reads the Go key, the console/Zen key and the multi-auth plugin, deduplicated", () => {
    const auth = { "opencode-go": { type: "api", key: "k1" }, opencode: { type: "api", key: "k2" }, xai: {} };
    const plugin = { version: 1, accounts: [
      { apiKey: "k1", label: "dup", enabled: true },
      { apiKey: "k3", label: "work", enabled: true },
      { apiKey: "k4", label: "off", enabled: false },
      { apiKey: "k5" },
    ] };
    const out = accountsFrom(auth, plugin, [{ key: "k6", label: "Acme", headers: { "x-opencode-org-id": "org" } }]);
    assert.deepEqual(out.map((a) => [a.key, a.label]), [["k1", "Go"], ["k2", "Zen"], ["k6", "Acme"], ["k3", "work"], ["k5", "帳號 5"]]);
    assert.deepEqual(out[2].headers, { "x-opencode-org-id": "org" });
  });

  it("a console/Zen login alone is enough", () => {
    assert.deepEqual(accountsFrom({ opencode: { type: "api", key: "z" } }, null).map((a) => a.label), ["Zen"]);
    assert.deepEqual(accountsFrom({ "opencode-go": { key: "  " } }, undefined), []);
  });
});

describe("Antigravity plugin accounts", () => {
  it("reads refresh tokens with emails as labels; tolerates junk", () => {
    const text = JSON.stringify({ version: 1, activeIndex: 0, accounts: [
      { email: "a@x.com", refreshToken: "1//a", addedAt: 1, lastUsed: 1 },
      { refreshToken: "" },
      { email: "b@x.com", refreshToken: " 1//b " },
    ] });
    const out = pluginAccounts(text);
    assert.deepEqual(out.map((a) => [a.label, a.refresh, a.source]), [["a@x.com", "1//a", "plugin"], ["b@x.com", "1//b", "plugin"]]);
    assert.deepEqual(pluginAccounts(null), []);
    assert.deepEqual(pluginAccounts("{ nope"), []);
  });
});

describe("console usage route", () => {
  it("derives the gateway usage URL and headers from /api/config", async () => {
    const { consoleUsageRoute, consoleLabel } = await import("../src/providers/opencode_go.js");
    const cfg = { config: { provider: { "opencode-go": {
      api: "https://opencode.ai/inference/go/openai/v1",
      options: { apiKey: "{env:OPENCODE_CONSOLE_TOKEN}", headers: { "x-opencode-org-id": "o1" } },
    } } } };
    assert.deepEqual(consoleUsageRoute(cfg), {
      url: "https://opencode.ai/inference/go/v1/usage",
      headers: { "x-opencode-org-id": "o1" },
    });
    assert.equal(consoleUsageRoute({ config: { provider: {} } }), null);
    assert.equal(consoleLabel({ metadata: { orgName: "Acme" } }, "Default"), "Acme");
    assert.equal(consoleLabel({ metadata: {} }, "Default"), "Console");
  });
});

describe("opencode logins", () => {
  it("parses oauth values and merges tokens into one auth.json node only", async () => {
    const { parseLogin, mergeNode } = await import("../src/lib/opencode_logins.js");
    assert.equal(parseLogin({ type: "api", key: "k" }), null);
    const l = parseLogin({ type: "oauth", access: "a", refresh: "r", expires: 5, accountId: "acc" });
    assert.equal(l.expiresMs, 5);
    assert.equal(l.extra.accountId, "acc");
    const merged = JSON.parse(mergeNode(`{"openai":{"type":"oauth","access":"old","accountId":"acc"},"xai":{"access":"x"}}`,
      "openai", { access: "new", refresh: "r2", expiresMs: 9 }));
    assert.deepEqual(merged.openai, { type: "oauth", access: "new", accountId: "acc", refresh: "r2", expires: 9 });
    assert.equal(merged.xai.access, "x");
  });
});
