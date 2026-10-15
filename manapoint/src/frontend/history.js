const PAGE_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const KINDS = { Rolling: "5H", Weekly: "WEEK", Monthly: "MONTH" };

export function remainingText(percent) {
  if (!Number.isFinite(percent)) return "—";
  return `${Math.round(Math.max(0, Math.min(100, 100 - percent)) * 100) / 100}%`;
}

/** Filters use archive ids rather than today's enabled services, preserving old entries. */
export function historyRows(entries, provider = "", days = 7, now = Date.now()) {
  const rows = [];
  for (const entry of entries) {
    if (entry.timestamp <= now - days * DAY_MS || entry.timestamp > now) continue;
    for (const card of entry.cards) {
      if (provider && card.id !== provider) continue;
      for (const window of card.windows.length ? card.windows : [null]) {
        rows.push({ timestamp: entry.timestamp, card, window });
      }
    }
  }
  return rows.sort((a, b) => b.timestamp - a.timestamp);
}

const byId = (id) => document.getElementById(id);
const dateText = (timestamp) => {
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("zh-TW", { hour12: false }) : "—";
};
let entries = [];
let interval = 5;
let page = 0;
let loading = false;
let pending = false;

function render() {
  const rows = historyRows(entries, byId("provider").value, Number(byId("period").value));
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  page = Math.max(0, Math.min(page, pages - 1));
  const body = byId("rows");
  body.replaceChildren();
  for (const { timestamp, card, window } of rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    const row = document.createElement("tr");
    const values = [dateText(timestamp), card.name, window?.account ?? "—",
      [window?.quotaGroup, KINDS[window?.kind]].filter(Boolean).join(" · ") || "—",
      window ? remainingText(window.percent) : "—", window?.resetsAt ? dateText(window.resetsAt) : "—",
      card.error ?? card.note ?? (window ? "已更新" : "無額度資料")];
    for (const value of values) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    }
    body.appendChild(row);
  }
  byId("empty").hidden = rows.length > 0;
  byId("page").textContent = `${page + 1} / ${pages}`;
  byId("previous").disabled = page === 0;
  byId("next").disabled = page + 1 >= pages;
  byId("summary").textContent = `每 ${interval} 分鐘儲存，保留最近 7 天 · ${rows.length} 筆窗口紀錄`;
}

async function reload() {
  if (loading) { pending = true; return; }
  loading = true;
  byId("reload").disabled = true;
  byId("error").hidden = true;
  try {
    const [archive, state] = await Promise.all([tiny.api.call("get_usage_history"), tiny.api.call("get_state")]);
    entries = archive;
    interval = state.settings.historyIntervalMinutes;
    const select = byId("provider");
    const selected = select.value;
    const names = new Map(entries.flatMap((e) => e.cards.map((c) => [c.id, c.name])));
    select.replaceChildren(new Option("全部服務", ""));
    for (const [id, name] of names) select.appendChild(new Option(name, id));
    select.value = names.has(selected) ? selected : "";
    render();
  } catch (err) {
    byId("error").textContent = "載入用量歷史失敗：" + (err?.message ?? String(err));
    byId("error").hidden = false;
  } finally {
    loading = false;
    byId("reload").disabled = false;
    if (pending) { pending = false; await reload(); }
  }
}

if (typeof document !== "undefined") {
  byId("reload").addEventListener("click", reload);
  for (const id of ["provider", "period"]) byId(id).addEventListener("change", () => { page = 0; render(); });
  byId("previous").addEventListener("click", () => { page -= 1; render(); });
  byId("next").addEventListener("click", () => { page += 1; render(); });
  if (typeof tiny === "undefined") {
    byId("error").textContent = "tinyjs API 不可用，無法載入用量歷史。";
    byId("error").hidden = false;
  } else {
    tiny.api.on("usage_history", reload);
    tiny.api.on("settings", (settings) => { interval = settings.historyIntervalMinutes; render(); });
    window.addEventListener("focus", reload);
    // Expiry should remain visible even when the recording interval is long.
    setInterval(render, 60_000);
    reload();
  }
}
