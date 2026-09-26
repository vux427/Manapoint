// Pure geometry for snapping the panel to screen edges. Each axis independently looks
// at which end of the work area it is near and snaps only to the nearer one; if both
// ends are far it stays put. That gives all four corners and edges for free, and
// leaves a window dragged through the middle completely alone. No window calls here,
// so it is directly testable.
//
// Rectangles are { left, top, right, bottom } in the window-position units tinyjs
// uses (win.setPosition / getState / app.screens all share them).

/**
 * Snap distance in CSS pixels; scale it by window units per CSS pixel before
 * comparing. Deliberately small: snapping happens live during the drag, so every
 * pixel of this is a band where the window stops tracking the cursor.
 */
export const DEFAULT_THRESHOLD = 16;

/** Tolerance for "still flush against that edge", absorbing DPI rounding. */
const FLUSH_TOLERANCE = 2;

/** The grab distance feels the same on a 150% display as on a 100% one. */
export const thresholdFor = (scale) => Math.max(1, Math.round(DEFAULT_THRESHOLD * scale));

function snapAxis(raw, len, lo, hi, threshold) {
  const hiPos = hi - len;
  const toLo = Math.abs(raw - lo);
  const toHi = Math.abs(raw - hiPos);
  if (toLo > threshold && toHi > threshold) return raw;
  return toLo <= toHi ? lo : hiPos;
}

/** Snap a window's top-left corner to the work-area edges. */
export function snap([x, y], [w, h], area, threshold) {
  return [
    snapAxis(x, w, area.left, area.right, threshold),
    snapAxis(y, h, area.top, area.bottom, threshold),
  ];
}

function keepAxis(raw, oldLen, newLen, lo, hi) {
  if (Math.abs(raw - lo) <= FLUSH_TOLERANCE) return lo;
  if (Math.abs(raw + oldLen - hi) <= FLUSH_TOLERANCE) return hi - newLen;
  return raw;
}

/**
 * Keep whichever edge the window was flush against when its size changes. A refresh
 * that makes the cards taller must not push a bottom-anchored panel off the screen.
 */
export function keepEdges([x, y], [oldW, oldH], [newW, newH], area) {
  return [
    keepAxis(x, oldW, newW, area.left, area.right),
    keepAxis(y, oldH, newH, area.top, area.bottom),
  ];
}

/** The work area (taskbar excluded) of the screen holding the window's centre, from
 * tiny.app.screens(). Falls back to the nearest screen for a window dragged off. */
export function workAreaFor(screens, [x, y], [w, h]) {
  if (!Array.isArray(screens) || screens.length === 0) return null;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const rectOf = (s) => {
    const v = s.visible ?? s;
    return { left: v.x, top: v.y, right: v.x + v.width, bottom: v.y + v.height };
  };
  const distance = (r) =>
    Math.hypot(Math.max(r.left - cx, 0, cx - r.right), Math.max(r.top - cy, 0, cy - r.bottom));
  return screens.map(rectOf).reduce((best, r) => (distance(r) < distance(best) ? r : best));
}
