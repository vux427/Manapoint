// Backend wiring: importing the entry must stay side-effect free under node
// (no windows, no polling), and the visibility handler must persist settings
// and hand back cards without crashing (state.app is null here, so the card
// push after a visibility change is a no-op by design).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { api } from "../src/main.js";

describe("visibility handler", () => {
  it("persists per-provider windows and still serves cards", async () => {
    const updated = await api.set_visible_windows({ id: "codex", kinds: ["Weekly"] });
    assert.deepEqual(updated.visibleWindows, { codex: ["Weekly"] });
    const state = await api.get_state();
    assert.deepEqual(state.settings.visibleWindows, { codex: ["Weekly"] });
    assert.ok(Array.isArray(await api.get_cards()));
  });
});
