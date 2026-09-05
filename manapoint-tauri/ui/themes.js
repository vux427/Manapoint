// Theme palettes: colour, meter style and meter density for each look.
//
// The colour codes are computed, not picked. The panel is translucent, so text sits on
// "panel colour x alpha + whatever desktop is behind it" — and the desktop is arbitrary.
// Every value here clears WCAG contrast at the lowest safe opacity against both extremes,
// pure white and pure black. themes.test.mjs is the guard: if a check fails, recompute
// the colour rather than lower the threshold.

// Usage thresholds shared by all themes.
export const WARNING_AT = 60;
export const CRITICAL_AT = 85;

export const THEMES = [
  {
    name: "石墨",
    description: "連續長條，單一強調色",
    panel: "#1B1E24",
    accent: "#6FA8DC",
    textPrimary: "#E4E9F0",
    textSecondary: "#C8D0DA",
    textMuted: "#B7BBC2",
    track: "#2E333C",
    border: "#3A404A",
    meterStyle: "smooth",
    coloring: "accent",
    status: { good: "#4ADE80", warning: "#FBBF24", critical: "#F87171" },
    monospace: false,
    segmentRadius: 2.0,
    brackets: false,
    panelWidth: 252,
    segmentCells: 10,
    segmentWidth: 7,
  },
  {
    name: "魔力",
    description: "MP 藍條，耗魔轉色警示",
    panel: "#101622",
    accent: "#38BDF8",
    textPrimary: "#E8EDF2",
    textSecondary: "#BFC8D2",
    textMuted: "#B3B9C1",
    track: "#232D42",
    border: "#33405A",
    meterStyle: "segmented",
    coloring: "status",
    status: { good: "#38BDF8", warning: "#A78BFA", critical: "#FB7185" },
    monospace: false,
    segmentRadius: 2.5,
    brackets: false,
    panelWidth: 252,
    segmentCells: 10,
    segmentWidth: 7,
  },
  {
    name: "終端",
    description: "方塊分段，等寬字，磷光綠",
    panel: "#0A0E0A",
    accent: "#00FF66",
    textPrimary: "#D7FFD7",
    textSecondary: "#8CE68C",
    textMuted: "#86B386",
    track: "#1B2A1B",
    border: "#2C452C",
    meterStyle: "segmented",
    coloring: "status",
    status: { good: "#00FF66", warning: "#FFD400", critical: "#FF4D4D" },
    monospace: true,
    segmentRadius: 0,
    brackets: true,
    panelWidth: 252,
    segmentCells: 10,
    segmentWidth: 7,
  },
  {
    name: "精簡",
    description: "一行一家，只有數字",
    panel: "#16191E",
    accent: "#6FA8DC",
    textPrimary: "#E4E9F0",
    textSecondary: "#C8D0DA",
    textMuted: "#B7BBC2",
    track: "#2E333C",
    border: "#3A404A",
    meterStyle: "text",
    coloring: "status",
    status: { good: "#4ADE80", warning: "#FBBF24", critical: "#F87171" },
    monospace: true,
    segmentRadius: 2.0,
    brackets: false,
    panelWidth: 196,
    segmentCells: 10,
    segmentWidth: 7,
  },
  {
    name: "紙白",
    description: "連續長條，淺色底",
    panel: "#F4F4F2",
    accent: "#357191",
    textPrimary: "#1A1D21",
    textSecondary: "#41474F",
    textMuted: "#4E5156",
    track: "#DCDCD8",
    border: "#C8C8C4",
    meterStyle: "smooth",
    coloring: "accent",
    status: { good: "#137839", warning: "#975C07", critical: "#B91C1C" },
    monospace: false,
    segmentRadius: 2.0,
    brackets: false,
    panelWidth: 252,
    segmentCells: 10,
    segmentWidth: 7,
  },
];

// Look up by product name; unknown names fall back to the first theme
// so the panel always has a complete palette to render with.
export function themeByName(name) {
  return THEMES.find((t) => t.name === name) ?? THEMES[0];
}
