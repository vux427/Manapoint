// Alerts, burn-rate projection and the tray summary.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { alertsFor, notification } from "../src/lib/alerts.js";
import * as trend from "../src/lib/trend.js";
import { runOutText, trayLevel, trayTooltip } from "../src/frontend/format.js";

const MIN = 60_000;
const w = (percent, kind = "Weekly", extra = {}) => ({ kind, percent, resetsAt: null, ...extra });

describe("alerts", () => {
  it("fires once per level crossed on the way up", () => {
    assert.deepEqual(alertsFor("Codex", [w(70)], [w(82)]), ["Codex每週額度已用 82%"]);
    assert.deepEqual(alertsFor("Codex", [w(82)], [w(90)]), []);
    assert.deepEqual(alertsFor("Codex", [w(90)], [w(96)]), ["Codex每週額度已用 96%"]);
    // Jumping both levels in one poll is still one line.
    assert.equal(alertsFor("Codex", [w(10)], [w(99)]).length, 1);
  });

  it("announces a reset only after being high, and only for a real drop", () => {
    assert.deepEqual(alertsFor("Claude", [w(92, "Rolling")], [w(0, "Rolling")]), ["Claude5 小時額度已重置（0%）"]);
    assert.deepEqual(alertsFor("Claude", [w(40)], [w(0)]), []);
    // A rolling window easing from 81% to 78% is not a reset.
    assert.deepEqual(alertsFor("Claude", [w(81)], [w(78)]), []);
  });

  it("stays quiet without a previous reading, and keeps accounts apart", () => {
    assert.deepEqual(alertsFor("Grok", undefined, [w(99)]), []);
    const before = [w(10, "Weekly", { account: "a" }), w(90, "Weekly", { account: "b" })];
    const after = [w(85, "Weekly", { account: "a" }), w(91, "Weekly", { account: "b" })];
    assert.deepEqual(alertsFor("Grok", before, after), ["Grok（a）每週額度已用 85%"]);
  });

  it("folds a round into one notification", () => {
    assert.equal(notification([]), null);
    assert.deepEqual(notification(["x"]), { title: "Manapoint", body: "x" });
    assert.equal(notification(["x", "y"]).body, "x\ny");
  });
});

describe("trend", () => {
  const t0 = Date.UTC(2026, 8, 20, 0, 0);

  it("keeps the anchor, thins close samples, restarts on a drop", () => {
    const h = {};
    trend.record(h, "k", t0, 10);
    trend.record(h, "k", t0 + 5 * MIN, 11);
    assert.equal(h.k.length, 2);
    trend.record(h, "k", t0 + 8 * MIN, 12); // under 10 min past the anchor: replaces the newest
    assert.deepEqual(h.k.map((s) => s.p), [10, 12]);
    trend.record(h, "k", t0 + 20 * MIN, 15);
    assert.deepEqual(h.k.map((s) => s.p), [10, 12, 15]);
    trend.record(h, "k", t0 + 25 * MIN, 2);
    assert.deepEqual(h.k.map((s) => s.p), [2]);
  });

  it("drops samples older than a day, and prunes silent windows", () => {
    const h = { k: [{ t: t0, p: 5 }], gone: [{ t: t0, p: 1 }] };
    trend.record(h, "k", t0 + 25 * 60 * MIN, 9);
    assert.deepEqual(h.k.map((s) => s.p), [9]);
    trend.prune(h, t0 + 25 * 60 * MIN);
    assert.deepEqual(Object.keys(h), ["k"]);
  });

  it("projects the line to the reset and finds when it hits 100%", () => {
    const samples = [{ t: t0, p: 20 }, { t: t0 + 60 * MIN, p: 30 }]; // 10 points an hour
    const now = t0 + 60 * MIN;
    const resetsAt = new Date(now + 10 * 60 * MIN).toISOString();
    const p = trend.project(samples, w(30, "Weekly", { resetsAt }), now);
    assert.equal(p.projected, 130);
    assert.equal(p.runsOutAt, new Date(now + 7 * 60 * MIN).toISOString());
    const slow = trend.project(samples, w(30, "Weekly", { resetsAt: new Date(now + 3 * 60 * MIN).toISOString() }), now);
    assert.deepEqual(slow, { projected: 60, runsOutAt: null });
  });

  it("says nothing on thin, flat or reset-less history", () => {
    const now = t0 + 60 * MIN;
    const resetsAt = new Date(now + 60 * MIN).toISOString();
    assert.equal(trend.project([{ t: t0, p: 1 }], w(1, "Weekly", { resetsAt }), now), null);
    assert.equal(trend.project([{ t: now - 10 * MIN, p: 1 }, { t: now, p: 5 }], w(5, "Weekly", { resetsAt }), now), null);
    assert.equal(trend.project([{ t: t0, p: 5 }, { t: now, p: 5 }], w(5, "Weekly", { resetsAt }), now), null);
    assert.equal(trend.project([{ t: t0, p: 1 }, { t: now, p: 5 }], w(5), now), null);
  });

  it("annotates copies, never the stored cards", () => {
    const now = t0 + 60 * MIN;
    const resetsAt = new Date(now + 60 * MIN).toISOString();
    const card = { id: "codex", name: "Codex", windows: [w(30, "Weekly", { resetsAt })], error: null };
    const history = { [trend.windowKey("codex", card.windows[0])]: [{ t: t0, p: 20 }, { t: now, p: 30 }] };
    const [out] = trend.annotate([card], history, now);
    assert.equal(out.windows[0].projected, 40);
    assert.equal(card.windows[0].projected, undefined);
    assert.equal(trend.annotate([card], {}, now)[0], card);
  });
});

describe("tray and run-out text", () => {
  const card = (name, ...percents) => ({ name, windows: percents.map((p) => w(p)) });

  it("colours by the most-used window", () => {
    assert.equal(trayLevel([]), null);
    assert.equal(trayLevel([card("A", 10), card("B", 30)]), "good");
    assert.equal(trayLevel([card("A", 10, 70)]), "warning");
    assert.equal(trayLevel([card("A", 100)]), "critical");
  });

  it("lists each provider's highest window, within the tooltip limit", () => {
    assert.equal(trayTooltip([card("Codex", 12, 100), card("Grok"), card("Claude", 0.4)]), "Codex 100%\nClaude <1%");
    assert.equal(trayTooltip([]), "Manapoint");
    const many = Array.from({ length: 20 }, (_, i) => card(`Provider number ${i}`, 50));
    assert.ok(trayTooltip(many).length <= 127);
  });

  it("counts down to running out, with the reset in the tooltip", () => {
    const now = new Date(Date.UTC(2026, 8, 20));
    const at = (h) => new Date(now.getTime() + h * 60 * MIN).toISOString();
    assert.equal(runOutText(w(50, "Weekly", { resetsAt: at(48) }), now), null);
    assert.deepEqual(runOutText(w(50, "Weekly", { resetsAt: at(48), runsOutAt: at(2.5) }), now), {
      short: "≈2h",
      title: "照目前速度約 2h 後用完（2d 後重置）",
    });
  });
});

describe("relaunch helper", () => {
  it("encodes scripts the way -EncodedCommand expects", async () => {
    const { encodeCommand } = await import("../src/lib/relaunch.js");
    const script = "Start-Process 'C:/中文 path/x.exe'";
    assert.equal(Buffer.from(encodeCommand(script), "base64").toString("utf16le"), script);
  });

  it("waits for the pid, and relaunches only while the flag exists", async () => {
    const { helperScripts } = await import("../src/lib/relaunch.js");
    const { helper, launcher } = helperScripts({ pid: 42, exe: "D:/It's/Manapoint.exe", flag: "C:/a/relaunch.flag" });
    assert.match(helper, /Wait-Process -Id 42 /);
    assert.match(helper, /Test-Path -LiteralPath 'C:\/a\/relaunch.flag'/);
    assert.match(helper, /Start-Process -FilePath 'D:\/It''s\/Manapoint.exe'/);
    assert.match(launcher, /Win32_Process -MethodName Create/);
    assert.match(launcher, /ShowWindow = \[uint16\]0/);
  });
});
