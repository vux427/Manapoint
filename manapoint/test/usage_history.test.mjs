import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { prune, snapshot, RETENTION_MS } from "../src/lib/usage_history.js";
import { normalize } from "../src/lib/settings.js";
import { historyRows, remainingText } from "../src/frontend/history.js";

const now = Date.UTC(2026, 9, 11);
const card = { id: "codex", name: "Codex", note: "上次數字，更新中", error: null,
  token: "never-archive", windows: [
    { kind: "Rolling", percent: 23.45, resetsAt: "2026-10-11T03:00:00Z", account: "work", projected: 105 },
    { kind: "Weekly", percent: 0, resetsAt: null, account: "personal" },
  ] };

describe("usage history", () => {
  it("keeps only the rolling seven days, rejecting future and malformed timestamps", () => {
    const entries = [now - RETENTION_MS - 1, now - RETENTION_MS, now - RETENTION_MS + 1, now, now + 1]
      .map((timestamp) => snapshot([card], timestamp));
    assert.deepEqual(prune([...entries, {}, { timestamp: NaN, cards: [] }], now), entries.slice(2, 4));
  });
  it("archives every account/window with status but excludes secrets and projections", () => {
    const entry = snapshot([card], now);
    assert.equal(entry.cards[0].windows.length, 2);
    assert.equal(entry.cards[0].note, card.note);
    assert.equal(entry.cards[0].windows[0].account, "work");
    assert.equal(JSON.stringify(entry).includes("never-archive"), false);
    assert.equal("projected" in entry.cards[0].windows[0], false);
    entry.cards[0].windows[0].percent = 99;
    assert.equal(card.windows[0].percent, 23.45);
  });
  it("shows remaining percentages and handles zero, fractional and unavailable readings", () => {
    assert.equal(remainingText(23.45), "76.55%");
    assert.equal(remainingText(0), "100%");
    assert.equal(remainingText(100), "0%");
    assert.equal(remainingText(null), "—");
  });
  it("filters by service and date, keeps errors and orders newest first", () => {
    const entries = [snapshot([card], now - 2 * 86400000), snapshot([card,
      { id: "grok", name: "Grok", windows: [], error: "連線失敗" }], now)];
    const rows = historyRows(entries, "", 7, now);
    assert.equal(rows.length, 5);
    assert.equal(rows[0].timestamp, now);
    assert.equal(historyRows(entries, "codex", 1, now).length, 2);
    const errors = historyRows(entries, "grok", 7, now);
    assert.equal(errors[0].window, null);
    assert.equal(errors[0].card.error, "連線失敗");
  });
  it("defaults old settings and accepts only integer intervals from 1 to 1440 minutes", () => {
    assert.equal(normalize({}).historyIntervalMinutes, 5);
    for (const minutes of [1, 17, 1440]) assert.equal(normalize({ historyIntervalMinutes: minutes }).historyIntervalMinutes, minutes);
    for (const minutes of [0, -1, 1.5, 1441, "10", NaN]) assert.equal(normalize({ historyIntervalMinutes: minutes }).historyIntervalMinutes, 5);
  });
});
