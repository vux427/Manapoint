import { it } from "node:test";
import assert from "node:assert/strict";
import { RETENTION_MS, load } from "../src/lib/usage_history.js";

it("records on launch, reschedules intervals, prunes persisted history and recovers from failed writes", async () => {
  const root = "/test/Manapoint";
  let now = Date.UTC(2026, 9, 11);
  const fixture = [{ id: "codex", name: "Codex", badge: {}, note: null, error: null,
    windows: [{ kind: "Rolling", percent: 25, resetsAt: null }, { kind: "Weekly", percent: 40, resetsAt: null }] }];
  const files = new Map([
    ["/fixture.json", JSON.stringify(fixture)],
    [root + "/settings.json", JSON.stringify({ visibleWindows: { codex: ["Weekly"] } })],
    [root + "/usage-history.json", JSON.stringify([
      { timestamp: now - RETENTION_MS - 1, cards: fixture },
      { timestamp: now - 1000, cards: fixture },
    ])],
  ]);
  const timers = new Set();
  const events = [];
  const errors = [];
  let failWrite = false;
  const original = { tjs: globalThis.tjs, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, now: Date.now, error: console.error };
  try {
    globalThis.tjs = {
      env: { APPDATA: "/test", MANAPOINT_FIXTURE: "/fixture.json", MANAPOINT_LOCAL_API: "0" },
      async readFile(path) {
        if (!files.has(path)) throw new Error("missing");
        return new TextEncoder().encode(files.get(path));
      },
      async makeDir() {},
      async writeFile(path, bytes) {
        if (failWrite && path.endsWith("usage-history.json.tmp")) throw new Error("disk full");
        files.set(path, new TextDecoder().decode(bytes));
      },
      async rename(from, to) { files.set(to, files.get(from)); files.delete(from); },
    };
    globalThis.setTimeout = (fn, ms) => { const timer = { fn, ms }; timers.add(timer); return timer; };
    globalThis.clearTimeout = (timer) => timers.delete(timer);
    Date.now = () => now;
    console.error = (...args) => errors.push(args.join(" "));
    const { init, api } = await import("../src/main.js");
    await init({ push: (name, payload) => events.push({ name, payload }), spawnHidden() {},
      launchAtLogin: { get: async () => "unsupported" } });
    let entries = await api.get_usage_history();
    assert.equal(entries.length, 2);
    assert.equal(entries[1].cards[0].windows.length, 2);
    assert.equal((await api.get_cards())[0].windows.length, 1);
    assert.equal(JSON.parse(files.get(root + "/usage-history.json")).length, 2);
    assert.deepEqual(await load(now), entries);
    await api.set_history_interval({ minutes: 2 });
    assert.equal(JSON.parse(files.get(root + "/settings.json")).historyIntervalMinutes, 2);
    assert.equal([...timers].filter((t) => t.ms === 120000).length, 1);
    assert.equal([...timers].filter((t) => t.ms === 300000).length, 1);
    await assert.rejects(api.set_history_interval({ minutes: 0 }), /1 至 1440/);
    const tick = async () => {
      const timer = [...timers].find((t) => t.ms === 120000);
      timers.delete(timer);
      now += 120000;
      await timer.fn();
    };
    failWrite = true;
    const cardEventsBefore = events.filter((e) => e.name === "cards").length;
    await tick();
    assert.equal((await api.get_usage_history()).length, 2);
    assert.ok(errors.some((e) => e.includes("disk full")));
    assert.ok(events.filter((e) => e.name === "cards").length > cardEventsBefore);
    failWrite = false;
    await tick();
    entries = await api.get_usage_history();
    assert.equal(entries.length, 3);
    assert.deepEqual(await load(now), entries);
    now += RETENTION_MS;
    assert.deepEqual(await api.get_usage_history(), []);
    assert.deepEqual(JSON.parse(files.get(root + "/usage-history.json")), []);
  } finally {
    globalThis.tjs = original.tjs;
    globalThis.setTimeout = original.setTimeout;
    globalThis.clearTimeout = original.clearTimeout;
    Date.now = original.now;
    console.error = original.error;
  }
});
