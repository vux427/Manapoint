// Usage alerts: which notifications one fresh reading earns, compared with the
// reading before it. Pure — the caller owns both readings and sends the result.
//
// Only a change fires: crossing a level on the way up, or a real drop after having
// been high. A restart compares against the cached snapshot, so it never re-announces
// numbers the user was already told about.

/** Levels that announce themselves, in percent. */
export const ALERT_LEVELS = [80, 95];

/** A drop this large from a high reading is a reset, not a rolling window easing off. */
const RESET_DROP = 20;

const KIND_TEXT = { Rolling: "5 小時", Weekly: "每週", Monthly: "每月" };

const sameWindow = (a, b) => a.kind === b.kind && (a.account ?? null) === (b.account ?? null);

function subject(name, w) {
  return `${name}${w.account ? `（${w.account}）` : ""}${KIND_TEXT[w.kind] ?? w.kind}額度`;
}

/** Alert lines for one provider: `before` and `after` are UsageWindow arrays. */
export function alertsFor(name, before, after) {
  if (!Array.isArray(before) || !Array.isArray(after)) return [];
  const lines = [];
  for (const w of after) {
    const prev = before.find((b) => sameWindow(b, w));
    if (!prev) continue;
    const crossed = ALERT_LEVELS.filter((l) => prev.percent < l && w.percent >= l);
    if (crossed.length > 0) {
      lines.push(`${subject(name, w)}已用 ${Math.round(w.percent)}%`);
    } else if (prev.percent >= ALERT_LEVELS[0] && w.percent < ALERT_LEVELS[0] && prev.percent - w.percent >= RESET_DROP) {
      lines.push(`${subject(name, w)}已重置（${Math.round(w.percent)}%）`);
    }
  }
  return lines;
}

/** One notification per round, however many lines: a burst of banners is noise. */
export function notification(lines) {
  if (lines.length === 0) return null;
  if (lines.length === 1) return { title: "Manapoint", body: lines[0] };
  return { title: `Manapoint：${lines.length} 項用量變化`, body: lines.join("\n") };
}
