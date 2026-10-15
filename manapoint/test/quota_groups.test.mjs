import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compactWindows, quotaGroups } from "../src/frontend/quota_groups.js";
import { snapshot } from "../src/lib/usage_history.js";
import { payload } from "../src/lib/local_api.js";
import { alertsFor } from "../src/lib/alerts.js";
import { windowKey } from "../src/lib/trend.js";
import { collectRoutes } from "../src/lib/accounts.js";

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
