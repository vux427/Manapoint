// Regression tests for the ported theme palettes: structural shape guards
// catch missing/renamed fields, known-value checks catch transcription slips
// against AppTheme.cs, and WCAG checks prove every colour stays legible on a
// translucent panel over an arbitrary desktop (worst case of white/black).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WARNING_AT, CRITICAL_AT, THEMES, themeByName } from "./themes.js";

// Lowest panel opacity at which colours must still clear WCAG, per contract.
const SAFE_OPACITY = 0.80;

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

// Blend the translucent panel colour over an opaque desktop backdrop so the
// test measures what the user actually sees, not the raw panel swatch.
function compositeOver(panelHex, backdropHex) {
  const layer = hexToRgb(panelHex);
  const backdrop = hexToRgb(backdropHex);
  return layer.map((c, i) =>
    Math.round(SAFE_OPACITY * c + (1 - SAFE_OPACITY) * backdrop[i]),
  );
}

function channelLuminance(channel) {
  const v = channel / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]) {
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

function contrastRatio(rgbA, rgbB) {
  const lumA = relativeLuminance(rgbA);
  const lumB = relativeLuminance(rgbB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

// The desktop behind a translucent panel is arbitrary, so measure contrast
// against both extremes (pure white and pure black backdrops) and keep the
// worse of the two; a colour passing here passes everywhere in between.
function worstCaseContrast(panelHex, foregroundHex) {
  const fg = hexToRgb(foregroundHex);
  const overWhite = contrastRatio(fg, compositeOver(panelHex, "#FFFFFF"));
  const overBlack = contrastRatio(fg, compositeOver(panelHex, "#000000"));
  return Math.min(overWhite, overBlack);
}

describe("themes structure", () => {
  it("has five themes in contract order", () => {
    assert.equal(THEMES.length, 5);
    assert.deepEqual(
      THEMES.map((t) => t.name),
      ["石墨", "魔力", "終端", "精簡", "紙白"],
    );
  });

  it("exports usage thresholds from StatusColors", () => {
    assert.equal(WARNING_AT, 60);
    assert.equal(CRITICAL_AT, 85);
  });

  it("every theme has all required fields with the right types", () => {
    for (const theme of THEMES) {
      assert.equal(typeof theme.name, "string");
      assert.equal(typeof theme.description, "string");
      assert.equal(typeof theme.panel, "string");
      assert.equal(typeof theme.accent, "string");
      assert.equal(typeof theme.textPrimary, "string");
      assert.equal(typeof theme.textSecondary, "string");
      assert.equal(typeof theme.textMuted, "string");
      assert.equal(typeof theme.track, "string");
      assert.equal(typeof theme.border, "string");
      assert.equal(typeof theme.meterStyle, "string");
      assert.equal(typeof theme.coloring, "string");
      assert.equal(typeof theme.status, "object");
      assert.equal(typeof theme.status.good, "string");
      assert.equal(typeof theme.status.warning, "string");
      assert.equal(typeof theme.status.critical, "string");
      assert.equal(typeof theme.monospace, "boolean");
      assert.equal(typeof theme.segmentRadius, "number");
      assert.equal(typeof theme.brackets, "boolean");
      assert.equal(typeof theme.panelWidth, "number");
      assert.equal(typeof theme.segmentCells, "number");
      assert.equal(typeof theme.segmentWidth, "number");
      assert.ok(
        ["smooth", "segmented", "text"].includes(theme.meterStyle),
        `Theme "${theme.name}" has unknown meterStyle "${theme.meterStyle}"`,
      );
      assert.ok(
        ["accent", "status"].includes(theme.coloring),
        `Theme "${theme.name}" has unknown coloring "${theme.coloring}"`,
      );
    }
  });

  it("every colour field is a 6-digit hex code", () => {
    const fields = [
      "panel",
      "accent",
      "textPrimary",
      "textSecondary",
      "textMuted",
      "track",
      "border",
    ];
    for (const theme of THEMES) {
      for (const field of fields) {
        assert.match(
          theme[field],
          HEX_RE,
          `Theme "${theme.name}" field "${field}" must match ${HEX_RE}`,
        );
      }
      for (const field of ["good", "warning", "critical"]) {
        assert.match(
          theme.status[field],
          HEX_RE,
          `Theme "${theme.name}" field "status.${field}" must match ${HEX_RE}`,
        );
      }
    }
  });

  it("themeByName finds by name and falls back to the first theme", () => {
    assert.equal(themeByName("魔力").name, "魔力");
    assert.equal(themeByName("no-such-theme").name, "石墨");
  });
});

describe("themes known values", () => {
  it("魔力 uses segmented status meters", () => {
    const theme = themeByName("魔力");
    assert.equal(theme.meterStyle, "segmented");
    assert.equal(theme.coloring, "status");
    assert.equal(theme.segmentCells, 10);
    assert.equal(theme.segmentWidth, 7);
    assert.equal(theme.segmentRadius, 2.5);
  });

  it("終端 uses monospace brackets with square segments", () => {
    const theme = themeByName("終端");
    assert.equal(theme.monospace, true);
    assert.equal(theme.brackets, true);
    assert.equal(theme.segmentRadius, 0);
    assert.equal(theme.segmentCells, 10);
    assert.equal(theme.segmentWidth, 7);
  });

  it("精簡 is the narrow text-only theme", () => {
    const theme = themeByName("精簡");
    assert.equal(theme.meterStyle, "text");
    assert.equal(theme.monospace, true);
    assert.equal(theme.panelWidth, 196);
  });

  it("石墨 and 紙白 use smooth accent meters", () => {
    for (const name of ["石墨", "紙白"]) {
      const theme = themeByName(name);
      assert.equal(theme.meterStyle, "smooth");
      assert.equal(theme.coloring, "accent");
    }
  });

  it("all themes except 精簡 are full width", () => {
    for (const theme of THEMES) {
      if (theme.name === "精簡") continue;
      assert.equal(
        theme.panelWidth,
        252,
        `Theme "${theme.name}" panelWidth must be 252`,
      );
    }
  });
});

describe("themes WCAG contrast at safe opacity", () => {
  // Text must stay readable and meter colours distinguishable even though
  // the panel is translucent over an unknown desktop (WCAG 4.5:1 / 3:1).
  const cases = [
    ["textPrimary", 4.5],
    ["textSecondary", 4.5],
    ["textMuted", 4.5],
    ["accent", 3.0],
    ["status.good", 3.0],
    ["status.warning", 3.0],
    ["status.critical", 3.0],
  ];

  function foregroundOf(theme, key) {
    return key.startsWith("status.")
      ? theme.status[key.slice("status.".length)]
      : theme[key];
  }

  for (const theme of THEMES) {
    for (const [key, required] of cases) {
      it(`${theme.name} ${key} >= ${required}:1 worst-case`, () => {
        const fg = foregroundOf(theme, key);
        const ratio = worstCaseContrast(theme.panel, fg);
        assert.ok(
          ratio >= required,
          `Theme "${theme.name}" colour "${key}" (${fg}) has worst-case contrast ` +
            `${ratio.toFixed(2)}:1 at opacity ${SAFE_OPACITY}, ` +
            `required ${required.toFixed(1)}:1; recompute the colour, ` +
            `do not lower the threshold.`,
        );
      });
    }
  }
});
