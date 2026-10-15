// Account identity and quota pools are separate dimensions. Grouping only by
// cadence would silently drop Argon's weekly balance beside Gemini's weekly one.
export function quotaGroups(windows) {
  const groups = [];
  for (const window of windows) {
    const name = window.quotaGroup ?? null;
    let group = groups.find((item) => item.name === name);
    if (!group) groups.push((group = { name, windows: [] }));
    group.windows.push(window);
  }
  return groups;
}

export function compactWindows(windows, kinds) {
  const primary = windows.filter((window) => !window.quotaGroup);
  const extra = windows.filter((window) => window.quotaGroup);
  const slots = kinds.map((kind) => primary.find((window) => window.kind === kind) ?? extra.shift() ?? null);
  return [...slots, ...extra];
}
