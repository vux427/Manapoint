// Settings, provider order, card folding and window geometry.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import * as cards from "../src/lib/cards.js";
import { notReady, failed, transient } from "../src/lib/errors.js";
import { normalize, MIN_OPACITY, MAX_OPACITY } from "../src/lib/settings.js";
import { parseDatetime } from "../src/lib/values.js";
import * as registry from "../src/providers/registry.js";
import { keepEdges, snap, thresholdFor, workAreaFor } from "../src/frontend/snap.js";

describe("settings", () => {
  it("clamps opacity from older files and defaults to vertical", () => {
    assert.equal(normalize({ panelOpacity: 0.05 }).panelOpacity, MIN_OPACITY);
    assert.equal(normalize({ panelOpacity: 2 }).panelOpacity, MAX_OPACITY);
    assert.equal(normalize({}).cardsLayout, "Vertical");
    assert.equal(normalize({ cardsLayout: "Diagonal" }).cardsLayout, "Vertical");
  });

  it("reads the Tauri build's file unchanged", () => {
    const s = normalize({ themeName: "魔力", cardsLayout: "Horizontal", panelOpacity: 0.7,
      enabledProviders: ["codex"], providerOrder: ["codex", "grok"] });
    assert.deepEqual(s, { themeName: "魔力", cardsLayout: "Horizontal", panelOpacity: 0.7,
      enabledProviders: ["codex"], providerOrder: ["codex", "grok"], alerts: true });
    assert.equal(normalize({ alerts: false }).alerts, false);
  });
});

describe("provider order", () => {
  const ids = (list) => list.map((p) => p.id);

  it("puts unlisted providers last and skips unknown ids", () => {
    assert.deepEqual(ids(registry.inOrder(["grok", "codex"])),
      ["grok", "codex", "opencode-go", "claude-code", "antigravity-gemini", "antigravity-3p"]);
    const order = registry.inOrder(["ghost", "codex"]);
    assert.equal(order[0].id, "codex");
    assert.equal(order.length, registry.all().length);
  });
});

describe("timestamps", () => {
  it("parses offsets, long fractions and offset-less values as UTC", () => {
    assert.equal(parseDatetime("2026-09-09T12:00:00Z"), Date.UTC(2026, 8, 9, 12));
    assert.equal(parseDatetime("2026-09-05T20:00:00.469547+08:00"), Date.UTC(2026, 8, 5, 12, 0, 0, 469));
    assert.equal(parseDatetime("2026-09-05T20:00:00.5"), Date.UTC(2026, 8, 5, 20, 0, 0, 500));
    assert.equal(parseDatetime("not a date"), null);
  });
});

describe("cards", () => {
  const providers = [{ id: "a", name: "A", badge: {} }, { id: "b", name: "B", badge: {} }];
  const reading = (percent) => ({ windows: [{ kind: "Weekly", percent, resetsAt: null }], note: null });

  it("keeps the last numbers with a note on NotReady/Transient, clears them on Failed", () => {
    const lastGood = { a: reading(10), b: reading(20) };
    const out = cards.fromOutcomes(providers, [
      { status: "rejected", reason: transient("稍後") },
      { status: "rejected", reason: failed("壞了") },
    ], lastGood);
    assert.equal(out[0].windows[0].percent, 10);
    assert.equal(out[0].note, "稍後");
    assert.equal(out[1].windows.length, 0);
    assert.equal(out[1].error, "壞了");
  });

  it("shows an error when there is nothing to fall back on", () => {
    const out = cards.fromOutcomes(providers.slice(0, 1), [{ status: "rejected", reason: notReady("請登入") }], {});
    assert.equal(out[0].error, "請登入");
    assert.equal(out[0].note, null);
  });

  it("a note-only reading never wipes cached numbers", () => {
    const lastGood = { a: reading(10) };
    cards.fromOutcomes(providers.slice(0, 1), [{ status: "fulfilled", value: { windows: [], note: "無額度" } }], lastGood);
    assert.equal(lastGood.a.windows[0].percent, 10);
  });

  it("restack reuses cards and reports when a fetch is needed", () => {
    const current = [{ ...cards.blank(providers[0]), windows: reading(5).windows }];
    const { cards: out, incomplete } = cards.restack([providers[1], providers[0]], current, {});
    assert.deepEqual(out.map((c) => c.id), ["b", "a"]);
    assert.equal(out[1].windows[0].percent, 5);
    assert.equal(incomplete, true);
  });
});

describe("snap", () => {
  const AREA = { left: 0, top: 0, right: 1920, bottom: 1040 };
  const SIZE = [252, 300];

  it("snaps corners and single edges, leaves open space alone", () => {
    assert.deepEqual(snap([10, 10], SIZE, AREA, 16), [0, 0]);
    assert.deepEqual(snap([1680, 750], SIZE, AREA, 16), [1920 - 252, 1040 - 300]);
    assert.deepEqual(snap([5, 500], SIZE, AREA, 16), [0, 500]);
    assert.deepEqual(snap([100, 100], SIZE, AREA, 16), [100, 100]);
  });

  it("snaps at the threshold, releases one pixel past it", () => {
    assert.deepEqual(snap([16, 100], SIZE, AREA, 16), [0, 100]);
    assert.deepEqual(snap([17, 100], SIZE, AREA, 16), [17, 100]);
  });

  it("picks the nearer edge when both are in range", () => {
    const area = { left: 0, top: 0, right: 300, bottom: 400 };
    assert.deepEqual(snap([30, 5], [260, 360], area, 40), [40, 0]);
  });

  it("scales the threshold with display scale", () => {
    assert.deepEqual([1, 1.25, 1.5, 2].map(thresholdFor), [16, 20, 24, 32]);
  });

  it("keeps a flush edge through a resize", () => {
    assert.deepEqual(keepEdges([1668, 740], SIZE, [252, 380], AREA), [1668, 660]);
    assert.deepEqual(keepEdges([0, 0], SIZE, [252, 380], AREA), [0, 0]);
    assert.deepEqual(keepEdges([500, 400], SIZE, [252, 380], AREA), [500, 400]);
  });

  it("finds the work area of the screen under the window", () => {
    const screens = [
      { x: 0, y: 0, width: 2560, height: 1440, visible: { x: 0, y: 0, width: 2560, height: 1392 } },
      { x: 2560, y: 0, width: 1920, height: 1080, visible: { x: 2560, y: 0, width: 1920, height: 1040 } },
    ];
    assert.deepEqual(workAreaFor(screens, [100, 100], SIZE), { left: 0, top: 0, right: 2560, bottom: 1392 });
    assert.deepEqual(workAreaFor(screens, [3000, 100], SIZE), { left: 2560, top: 0, right: 4480, bottom: 1040 });
    assert.equal(workAreaFor([], [0, 0], SIZE), null);
  });
});
