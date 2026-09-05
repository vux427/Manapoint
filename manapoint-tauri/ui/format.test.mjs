import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  label,
  shortLabel,
  percentText,
  alertText,
  statusColor,
  litCells,
  resetsInText,
} from "./format.js";

// Threshold literals from CONTRACT.md section 3 (60 and 85). This file
// deliberately does not import themes.js so it stands alone.
describe("percentText", () => {
  const cases = [
    [0, "0%"],
    [0.4, "<1%"],
    [0.999, "<1%"],
    [1, "1%"],
    [12.4, "12%"],
    [12.5, "13%"],
    [100, "100%"],
  ];
  for (const [input, expected] of cases) {
    it(`${input} -> ${expected}`, () => {
      assert.equal(percentText(input), expected);
    });
  }
});

describe("litCells", () => {
  const cells = 10;
  const cases = [
    [98, 10],
    [50, 5],
    [3, 1],
    [0.1, 1],
    [0, 0],
    [150, 10],
    [-5, 0],
  ];
  for (const [input, expected] of cases) {
    it(`${input} -> ${expected}`, () => {
      assert.equal(litCells(input, cells), expected);
    });
  }
});

describe("label", () => {
  it('Rolling -> "5H"', () => {
    assert.equal(label("Rolling"), "5H");
  });
  it('Weekly -> "WEEK"', () => {
    assert.equal(label("Weekly"), "WEEK");
  });
  it('Monthly -> "MONTH"', () => {
    assert.equal(label("Monthly"), "MONTH");
  });
  it("unknown kind throws", () => {
    assert.throws(() => label("Daily"), Error);
  });
});

describe("shortLabel", () => {
  it('Rolling -> "5h"', () => {
    assert.equal(shortLabel("Rolling"), "5h");
  });
  it('Weekly -> "7d"', () => {
    assert.equal(shortLabel("Weekly"), "7d");
  });
  it('Monthly -> "30d"', () => {
    assert.equal(shortLabel("Monthly"), "30d");
  });
  it("unknown kind throws", () => {
    assert.throws(() => shortLabel("Daily"), Error);
  });
});

describe("alertText", () => {
  it('(90, "status") -> "!"', () => {
    assert.equal(alertText(90, "status"), "!");
  });
  it('(85, "status") -> "!"', () => {
    assert.equal(alertText(85, "status"), "!");
  });
  it('(84.9, "status") -> ""', () => {
    assert.equal(alertText(84.9, "status"), "");
  });
  it('(99, "accent") -> ""', () => {
    assert.equal(alertText(99, "accent"), "");
  });
});

describe("statusColor", () => {
  const statusTheme = {
    coloring: "status",
    accent: "#111111",
    status: { good: "#00FF00", warning: "#FFFF00", critical: "#FF0000" },
  };
  const accentTheme = {
    coloring: "accent",
    accent: "#123456",
    status: { good: "#00FF00", warning: "#FFFF00", critical: "#FF0000" },
  };
  it("status theme at 0 -> good", () => {
    assert.equal(statusColor(statusTheme, 0), "#00FF00");
  });
  it("status theme at 60 -> warning", () => {
    assert.equal(statusColor(statusTheme, 60), "#FFFF00");
  });
  it("status theme at 85 -> critical", () => {
    assert.equal(statusColor(statusTheme, 85), "#FF0000");
  });
  it("accent theme at 99 -> accent", () => {
    assert.equal(statusColor(accentTheme, 99), "#123456");
  });
});

describe("resetsInText", () => {
  // Fixed reference time so the suite never drifts with wall time.
  const NOW = new Date("2026-09-06T00:00:00Z");
  const atOffsetMs = (offsetMs) => new Date(NOW.getTime() + offsetMs).toISOString();
  const MINUTE_MS = 60 * 1000;
  const HOUR_MS = 60 * MINUTE_MS;
  const DAY_MS = 24 * HOUR_MS;

  it("null -> empty string", () => {
    assert.equal(resetsInText(null, NOW), "");
  });
  it("undefined -> empty string", () => {
    assert.equal(resetsInText(undefined, NOW), "");
  });
  it("past timestamp -> now", () => {
    assert.equal(resetsInText(atOffsetMs(-MINUTE_MS), NOW), "now");
  });
  it("exactly now -> now", () => {
    assert.equal(resetsInText(atOffsetMs(0), NOW), "now");
  });
  it("+45 min -> 45m", () => {
    assert.equal(resetsInText(atOffsetMs(45 * MINUTE_MS), NOW), "45m");
  });
  it("+59 min 59 s -> 59m", () => {
    assert.equal(resetsInText(atOffsetMs(59 * MINUTE_MS + 59 * 1000), NOW), "59m");
  });
  it("+1 h -> 1h", () => {
    assert.equal(resetsInText(atOffsetMs(HOUR_MS), NOW), "1h");
  });
  it("+23 h -> 23h", () => {
    assert.equal(resetsInText(atOffsetMs(23 * HOUR_MS), NOW), "23h");
  });
  it("+25 h -> 1d", () => {
    assert.equal(resetsInText(atOffsetMs(25 * HOUR_MS), NOW), "1d");
  });
  it("+3 d -> 3d", () => {
    assert.equal(resetsInText(atOffsetMs(3 * DAY_MS), NOW), "3d");
  });
});
