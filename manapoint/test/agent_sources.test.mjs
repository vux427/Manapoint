import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setSpawner } from "../src/lib/io.js";
import { PI_GROK_PROBE } from "../src/sources/pi.js";
import * as grok from "../src/providers/grok.js";
import * as go from "../src/providers/opencode_go.js";

const exp = () => Date.now() + 3_600_000;
const token = (sub) => `eyJ0eXAiOiJKV1QifQ.${Buffer.from(JSON.stringify({ iss: "issuer", sub })).toString("base64url")}.sig`;
const billing = (percent) => ({ config: { creditUsagePercent: percent, currentPeriod: { end: "2026-11-01T12:00:00Z" } } });
const piResult = (sub, percent) => ({ version: 1, status: "ok", identity: JSON.stringify(["issuer", sub]), ...billing(percent) });

function runtime(t, { credentials, pi, lookup = {}, fetch } = {}) {
  const old = { tjs: globalThis.tjs, fetch: globalThis.fetch };
  const reads = [];
  const files = new Map(Object.entries({
    ...(pi && { "C:/profile/.pi/agent/auth.json": "{}", "C:/p/sdk.js": "", "C:/node.exe": "" }),
    ...(credentials && { "C:/profile/.local/share/opencode/auth.json": JSON.stringify(credentials) }),
  }));
  const lookupFile = (path) => {
    reads.push(path);
    if (!files.has(path)) throw new Error("not found");
    return files.get(path);
  };
  globalThis.tjs = {
    env: { USERPROFILE: "C:/profile", MANAPOINT_PI_SDK_ENTRY: "C:/p/sdk.js", MANAPOINT_NODE_EXE: "C:/node.exe", ...lookup },
    stat: async (path) => lookupFile(path),
    readFile: async (path) => new TextEncoder().encode(lookupFile(path)),
  };
  globalThis.fetch = fetch ?? (() => { throw new Error("no network in this test"); });
  setSpawner((argv) => {
    assert.deepEqual(argv.slice(0, 5), ["C:/node.exe", "--input-type=module", "-", "C:/p/sdk.js", "C:/profile/.pi/agent/auth.json"]);
    const stdout = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify(pi)));
      controller.close();
    } });
    return { stdin: new WritableStream(), stdout, wait: async () => ({ exit_status: 0 }) };
  });
  t.after(() => { Object.assign(globalThis, old); setSpawner(null); });
  return reads;
}

test("Grok auto falls back to Pi with no OpenCode files; sensitive identity never leaves the collector", async (t) => {
  runtime(t, { pi: piResult("account", 19) });
  const u = await grok.collect();
  assert.deepEqual(u.windows.map((w) => w.percent), [19]);
  assert.equal(u.identity, undefined);
});

test("Grok uses login identity rather than equal windows to merge different sources", async (t) => {
  const legacy = { type: "oauth", access: token("same"), expires: exp() };
  const fetch = async () => Response.json(billing(19));
  await t.test("same issuer and subject; keep existing account", async (t) => {
    runtime(t, { credentials: { xai: legacy }, pi: piResult("same", 20), fetch });
    assert.deepEqual((await grok.collect()).windows.map((w) => w.percent), [19]);
  });
  await t.test("different subjects sharing the same percentage are two accounts", async (t) => {
    runtime(t, { credentials: { xai: legacy }, pi: piResult("other", 19), fetch });
    assert.deepEqual((await grok.collect()).windows.map((w) => w.account), ["xAI", "Pi"]);
  });
  await t.test("unidentified account is not merged on matching quota alone", async (t) => {
    runtime(t, { credentials: { xai: legacy }, pi: { ...piResult("other", 19), identity: undefined }, fetch });
    assert.equal((await grok.collect()).windows.length, 2);
  });
  await t.test("Pi-only never reads OpenCode data", async (t) => {
    const reads = runtime(t, { credentials: { xai: legacy }, pi: piResult("same", 20), lookup: { MANAPOINT_GROK_SOURCE: "pi" }, fetch });
    assert.equal((await grok.collect()).windows[0].percent, 20);
    assert.ok(reads.every((p) => !p.includes("opencode")));
  });
  await t.test("rejected Pi login does not hide a working OpenCode route", async (t) => {
    runtime(t, { credentials: { xai: legacy }, pi: { version: 1, status: "denied" }, fetch });
    assert.equal((await grok.collect()).windows[0].percent, 19);
  });
});

test("Go direct key works without any login files and does not leak a rejected key", async (t) => {
  const window = { percent: 25, resetsAt: "2026-11-01T00:00:00Z" };
  let status = 200;
  const reads = runtime(t, {
    lookup: { OPENCODE_API_KEY: "key-old", MANAPOINT_OPENCODE_GO_API_KEY: "key-configured", MANAPOINT_GO_SOURCE: "direct" },
    async fetch(url, options) {
      assert.equal(url, "https://opencode.ai/zen/go/v1/usage");
      assert.equal(options.headers.Authorization, "Bearer key-configured");
      return Response.json({ usage: { rolling: window, weekly: window, monthly: window } }, { status });
    },
  });
  assert.equal((await go.collect()).windows.length, 3);
  status = 401;
  await assert.rejects(go.collect(), { kind: "NotReady", message: "Go 金鑰已失效，請更新環境變數中的金鑰" });
  assert.deepEqual(reads, []);
  assert.equal(go.accountsFrom({ "opencode-go": { key: "key-configured" } }, null, [], [{ key: "key-configured", label: "direct", direct: true }]).length, 1);
});

test("bundled Pi probe runs headless and emits only quota fields; API credentials are not used", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "manapoint-probe-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const sdk = join(folder, "sdk.mjs");
  const auth = join(folder, "auth.json");
  writeFileSync(sdk, `export const ModelRuntime = { create: async (opts) => {
    if (opts.modelsPath !== null || opts.refreshOnCreate !== false) throw Error('unexpected discovery');
    return { checkAuth: async () => ({ type: 'oauth' }), getAuth: async () => ({ source: 'OAuth', auth: { apiKey: 'fixture-secret' } }) };
  } };`);
  const preload = `globalThis.fetch = async (url, opts) => {
    if (url !== 'https://cli-chat-proxy.grok.com/v1/billing?format=credits' || opts.headers.Authorization !== 'Bearer fixture-secret' || opts.redirect !== 'error') throw Error('unexpected request');
    return Response.json({config:{ creditUsagePercent:33, productUsage:[{usagePercent:12, private:'fixture-secret'}], private:'fixture-secret' }});
  };\n`;
  const run = (data, mode = "read-only") => {
    writeFileSync(auth, JSON.stringify({ xai: data }));
    const child = spawnSync(process.execPath, ["--input-type=module", "-", sdk, auth, mode], {
      input: preload + PI_GROK_PROBE, encoding: "utf8", timeout: 5000,
    });
    assert.equal(child.status, 0);
    assert.ok(!child.stdout.includes("fixture-secret"));
    return JSON.parse(child.stdout);
  };
  const r = run({ type: "oauth", expires: exp() });
  assert.equal(r.status, "ok");
  assert.deepEqual(r.config.productUsage, [{ usagePercent: 12 }]);
  assert.equal(r.config.creditUsagePercent, 33);
  assert.equal(run({ type: "oauth", expires: 1 }).status, "login");
  assert.equal(run({ type: "api_key", key: "!arbitrary-command" }, "refresh").status, "login");
});

const installedSdk = process.env.MANAPOINT_TEST_PI_SDK_ENTRY;
test("installed Pi SDK rotates a synthetic xAI grant without touching other entries", { skip: !installedSdk }, (t) => {
  const folder = mkdtempSync(join(tmpdir(), "manapoint-sdk-test-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const auth = join(folder, "auth.json");
  const other = { type: "api_key", key: "unrelated-fixture-key" };
  writeFileSync(auth, JSON.stringify({ xai: { type: "oauth", access: "fixture-expired", refresh: "fixture-old", expires: 1 }, other }));
  const preload = `globalThis.fetch = async (url, opts) => {
    if (url === 'https://auth.x.ai/oauth2/token' && opts.body.get('refresh_token') === 'fixture-old') {
      return Response.json({access_token:'fixture-access', refresh_token:'fixture-new', expires_in:3600});
    }
    if (url === 'https://cli-chat-proxy.grok.com/v1/billing?format=credits' && opts.headers.Authorization === 'Bearer fixture-access') {
      return Response.json({config:{creditUsagePercent:7}});
    }
    throw Error('unexpected request');
  };\n`;
  const run = () => spawnSync(process.execPath, ["--input-type=module", "-", installedSdk, auth, "refresh"], {
    input: preload + PI_GROK_PROBE, encoding: "utf8", timeout: 10_000,
  });
  for (let i = 0; i < 2; i++) {
    const result = run(); // Restart the probe; the second run must use the persisted grant.
    assert.equal(result.status, 0);
    assert.ok(!result.stdout.includes("fixture-"));
    assert.equal(JSON.parse(result.stdout).config.creditUsagePercent, 7);
  }
  const persisted = JSON.parse(readFileSync(auth, "utf8"));
  assert.equal(persisted.xai.refresh, "fixture-new");
  assert.deepEqual(persisted.other, other);
});
