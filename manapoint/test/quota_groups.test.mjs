import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compactWindows, quotaGroups } from "../src/frontend/quota_groups.js";
import { snapshot } from "../src/lib/usage_history.js";
import { payload } from "../src/lib/local_api.js";
import { alertsFor } from "../src/lib/alerts.js";
import { windowKey } from "../src/lib/trend.js";
import { collectRoutes } from "../src/lib/accounts.js";
import { applyVisibility } from "../src/lib/cards.js";
import { parse as parseClaude } from "../src/providers/claude.js";

const windows = [
  { kind: "Rolling", percent: 0, resetsAt: null },
  { kind: "Weekly", percent: 1.78, resetsAt: null },
  { kind: "Weekly", percent: 0.61, resetsAt: null, quotaGroup: "Argon" },
];
const card = { id: "antigravity-gemini", name: "Antigravity Gemini", windows };

describe("independent quota groups in one card", () => {
  it("keeps both weekly windows, using one compact row and two grouped meter rows", () => {
    const groups = quotaGroups(windows);
    assert.deepEqual(groups.map((group) => group.name), [null, "Argon"]);
    assert.deepEqual(groups.map((group) => group.windows.length), [2, 1]);
    assert.deepEqual(compactWindows(windows, ["Rolling", "Weekly", "Monthly"]), windows);
    assert.deepEqual(compactWindows(windows.slice(0, 2), ["Rolling", "Weekly", "Monthly"]), [...windows.slice(0, 2), null]);
  });

  it("archives and exports the independent pool without merging it into the base weekly quota", () => {
    assert.deepEqual(snapshot([card]).cards[0].windows, windows);
    assert.deepEqual(payload([card]).cards[0].windows, windows);
  });

  it("preserves old trend keys while giving Argon a separate history", () => {
    assert.equal(windowKey(card.id, windows[1]), "antigravity-gemini||Weekly");
    assert.equal(windowKey(card.id, windows[2]), "antigravity-gemini||Weekly|Argon");
  });

  it("compares alert thresholds within each pool, regardless of window order", () => {
    const before = [{ ...windows[1], percent: 90 }, { ...windows[2], percent: 10 }];
    const after = [{ ...windows[2], percent: 82 }, { ...windows[1], percent: 91 }];
    assert.deepEqual(alertsFor(card.name, before, after), ["Antigravity Gemini Argon 每週額度已用 82%"]);
  });

  it("keeps same-valued accounts distinct when they report different quota pools", async () => {
    const reading = (quotaGroup) => ({ provider: card.name, windows: [{ ...windows[1], quotaGroup }], collectedAt: "x", note: null });
    const result = await collectRoutes(card.name, [
      { label: "A", run: async () => reading(undefined) },
      { label: "B", run: async () => reading("Argon") },
    ], "missing");
    assert.deepEqual(result.windows.map((window) => window.account), ["A", "B"]);
  });
});

describe("Claude Fable weekly usage", () => {
  it("preserves the scoped window through grouping, visibility, history, export, trends and alerts", () => {
    const reading = parseClaude(JSON.stringify({
      five_hour: { utilization: 66 }, seven_day: { utilization: 29 },
      limits: [{ kind: "weekly_scoped", group: "weekly", percent: 51,
        resets_at: "2026-11-20T00:59:59Z", scope: { model: { display_name: "Fable" } } }],
    }), 0);
    const claude = { id: "claude-code", name: reading.provider, windows: reading.windows };
    const fable = reading.windows[2];
    assert.deepEqual(quotaGroups(reading.windows).map((group) => group.name), [null, "Fable"]);
    assert.deepEqual(compactWindows(reading.windows, ["Rolling", "Weekly", "Monthly"]), reading.windows);
    assert.deepEqual(applyVisibility([claude], { "claude-code": ["Weekly"] })[0].windows, reading.windows.slice(1));
    assert.deepEqual(snapshot([claude], 0).cards[0].windows[2], fable);
    assert.deepEqual(payload([claude], 0).cards[0].windows[2], fable);
    assert.notEqual(windowKey(claude.id, reading.windows[1]), windowKey(claude.id, fable));
    assert.deepEqual(alertsFor(claude.name, reading.windows,
      [reading.windows[0], { ...fable, percent: 82 }, reading.windows[1]]),
    ["Claude Code Fable 每週額度已用 82%"]);
  });
});
