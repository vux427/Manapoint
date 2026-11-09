// Manapoint Usage Details Popup Overlay & Provider Settings & Usage History

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, closeOverlay, shared } from "herdr";
import { fetchCards, fetchUsageHistory, saveEnabledProviders } from "./data.js";
import {
  percentText,
  remainingText,
  dateText,
  historyRows,
  statusColor,
  statusBg,
  label,
  resetsInText,
  providerShortName,
  providerIcon,
  providerBrandColor,
} from "./format.js";

const ALL_PROVIDERS = [
  { id: "claude-code", name: "Claude Code", icon: "mods/manapoint-popup/icons/claude.svg", bg: "#D97757", fg: "#FFFFFF" },
  { id: "codex", name: "Codex", icon: "mods/manapoint-popup/icons/openai.svg", bg: "#10A37F", fg: "#FFFFFF" },
  { id: "grok", name: "Grok", icon: "mods/manapoint-popup/icons/grok.svg", bg: "#1A1A1A", fg: "#FFFFFF" },
  { id: "antigravity-gemini", name: "Antigravity Gemini", icon: "mods/manapoint-popup/icons/gemini.svg", bg: "#4285F4", fg: "#FFFFFF" },
  { id: "antigravity-3p", name: "Antigravity Claude/GPT", icon: "mods/manapoint-popup/icons/antigravity.svg", bg: "#4285F4", fg: "#FFFFFF" },
  { id: "muse-code", name: "Muse Code", icon: "mods/manapoint-popup/icons/muse.svg", bg: "#0866FF", fg: "#FFFFFF" },
  { id: "cursor", name: "Cursor", icon: "mods/manapoint-popup/icons/cursor.svg", bg: "#14120B", fg: "#FFFFFF" },
  { id: "opencode-go", name: "opencode Go", icon: "mods/manapoint-popup/icons/opencode.svg", bg: "#F2F2F2", fg: "#16181C" },
];

export default class ManapointPopup extends View {
  init(_props, cx) {
    this.tab = "usage"; // "usage" | "history" | "settings"
    this.historyProvider = ""; // "" for all
    this.historyDays = 7;
    this.historyPage = 0;

    // Load usage history asynchronously on init
    cx.spawn(async () => {
      await fetchUsageHistory();
      cx.notify();
    });
  }

  toggleProvider(id, enabledList, cx) {
    let next;
    if (enabledList.includes(id)) {
      next = enabledList.filter((x) => x !== id);
    } else {
      next = [...enabledList, id];
    }
    saveEnabledProviders(next);
    cx.notify();
  }

  render(cx) {
    const t = theme();
    const p = props() ?? {};
    const cards = shared("manapoint.cards") ?? [];
    const updatedAt = shared("manapoint.updatedAt");
    const loading = Boolean(shared("manapoint.loading"));
    const source = shared("manapoint.source") ?? "cli";
    const enabledRaw = shared("manapoint.enabledProviders");
    const enabledList = Array.isArray(enabledRaw)
      ? enabledRaw
      : cards.map((c) => c.id);

    const updatedText = updatedAt
      ? new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "";

    return v_flex()
      .id("manapoint-popup")
      .size_full()
      .p(14)
      .gap(12)
      .bg(t.popover)
      .rounded(8)
      .border(1)
      .border_color(t.border)
      .text_color(t.foreground)
      // Header
      .child(
        h_flex()
          .justify_between()
          .items_center()
          .child(
            h_flex()
              .gap(8)
              .items_center()
              .child(
                div()
                  .size(10)
                  .rounded(5)
                  .bg(loading ? t.working : "#34d399")
              )
              .child(
                div()
                  .font_semibold()
                  .text_size(14)
                  .child("Manapoint AI 訂閱額度")
              )
              .when(loading, (el) =>
                el.child(
                  div()
                    .text_size(11)
                    .text_color(t.working)
                    .child("(更新中...)")
                )
              )
          )
          .child(
            h_flex()
              .gap(8)
              .items_center()
              // Tab buttons
              .child(
                h_flex()
                  .gap(2)
                  .p(2)
                  .rounded(4)
                  .bg(t.surface)
                  .border(1)
                  .border_color(t.border)
                  .child(
                    div()
                      .id("tab-usage")
                      .cursor_pointer()
                      .px(6)
                      .py(1.5)
                      .rounded(3)
                      .text_size(11)
                      .bg(this.tab === "usage" ? t.raised : "#00000000")
                      .text_color(this.tab === "usage" ? t.foreground : t.muted)
                      .on_click((_e, cx) => {
                        this.tab = "usage";
                        cx.notify();
                      })
                      .child("用量")
                  )
                  .child(
                    div()
                      .id("tab-history")
                      .cursor_pointer()
                      .px(6)
                      .py(1.5)
                      .rounded(3)
                      .text_size(11)
                      .bg(this.tab === "history" ? t.raised : "#00000000")
                      .text_color(this.tab === "history" ? t.foreground : t.muted)
                      .on_click((_e, cx) => {
                        this.tab = "history";
                        fetchUsageHistory();
                        cx.notify();
                      })
                      .child("歷史")
                  )
                  .child(
                    div()
                      .id("tab-settings")
                      .cursor_pointer()
                      .px(6)
                      .py(1.5)
                      .rounded(3)
                      .text_size(11)
                      .bg(this.tab === "settings" ? t.raised : "#00000000")
                      .text_color(this.tab === "settings" ? t.foreground : t.muted)
                      .on_click((_e, cx) => {
                        this.tab = "settings";
                        cx.notify();
                      })
                      .child("⚙ 設定")
                  )
              )
              // Close button
              .child(
                div()
                  .id("close-btn")
                  .cursor_pointer()
                  .px(6)
                  .py(2)
                  .rounded(4)
                  .text_size(12)
                  .text_color(t.muted)
                  .hover((s) => s.bg(t.raised).text_color(t.foreground))
                  .on_click(() => {
                    if (p.overlay) closeOverlay(p.overlay);
                  })
                  .child("✕")
              )
          )
      )
      // Body content: depends on this.tab
      .child(
        this.tab === "history"
          ? this.renderHistory(t, cx)
          : this.tab === "settings"
          ? this.renderSettings(t, enabledList, cx)
          : this.renderCards(t, cards, enabledList)
      )
      // Footer
      .child(
        h_flex()
          .justify_between()
          .items_center()
          .text_size(10.5)
          .text_color(t.dim)
          .child(
            div().child(
              updatedText ? `更新於 ${updatedText} · 來源: ${source === "app" ? "桌面服務" : "本機 CLI"}` : ""
            )
          )
          .child(div().child("按 Esc 關閉"))
      );
  }

  renderHistory(t, cx) {
    const rawEntries = shared("manapoint.history") ?? [];
    const loading = Boolean(shared("manapoint.historyLoading"));
    const rows = historyRows(rawEntries, this.historyProvider, this.historyDays);

    const PAGE_SIZE = 25;
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    this.historyPage = Math.max(0, Math.min(this.historyPage, totalPages - 1));
    const pageRows = rows.slice(this.historyPage * PAGE_SIZE, (this.historyPage + 1) * PAGE_SIZE);

    return v_flex()
      .flex_1()
      .gap(8)
      // Top filter toolbar
      .child(
        v_flex()
          .gap(6)
          .p(8)
          .rounded(6)
          .bg(t.surface)
          .border(1)
          .border_color(t.border)
          // Row 1: Provider selection pills (horizontal scrolling)
          .child(
            h_flex()
              .gap(4)
              .items_center()
              .overflow_x_scrollbar()
              .child(
                div()
                  .cursor_pointer()
                  .px(6)
                  .py(2)
                  .rounded(3)
                  .text_size(10.5)
                  .font_semibold()
                  .bg(this.historyProvider === "" ? t.raised : "#00000000")
                  .text_color(this.historyProvider === "" ? t.foreground : t.muted)
                  .border(1)
                  .border_color(this.historyProvider === "" ? t.border : "#00000000")
                  .on_click((_e, cx) => {
                    this.historyProvider = "";
                    this.historyPage = 0;
                    cx.notify();
                  })
                  .child("全部服務")
              )
              .children(
                ALL_PROVIDERS.map((p) => {
                  const active = this.historyProvider === p.id;
                  return h_flex()
                    .gap(4)
                    .items_center()
                    .cursor_pointer()
                    .px(6)
                    .py(2)
                    .rounded(3)
                    .text_size(10.5)
                    .bg(active ? t.raised : "#00000000")
                    .text_color(active ? t.foreground : t.muted)
                    .border(1)
                    .border_color(active ? t.border : "#00000000")
                    .on_click((_e, cx) => {
                      this.historyProvider = p.id;
                      this.historyPage = 0;
                      cx.notify();
                    })
                    .child(
                      svg(p.icon)
                        .size(11)
                        .flex_none()
                        .text_color(p.bg)
                    )
                    .child(div().child(p.name));
                })
              )
          )
          // Row 2: Period & Reload
          .child(
            h_flex()
              .justify_between()
              .items_center()
              .child(
                h_flex()
                  .gap(4)
                  .items_center()
                  .text_size(10.5)
                  .child(div().text_color(t.muted).child("時間："))
                  .child(
                    div()
                      .cursor_pointer()
                      .px(5)
                      .py(1.5)
                      .rounded(3)
                      .bg(this.historyDays === 1 ? t.raised : "#00000000")
                      .text_color(this.historyDays === 1 ? t.foreground : t.dim)
                      .on_click((_e, cx) => {
                        this.historyDays = 1;
                        this.historyPage = 0;
                        cx.notify();
                      })
                      .child("24 小時")
                  )
                  .child(
                    div()
                      .cursor_pointer()
                      .px(5)
                      .py(1.5)
                      .rounded(3)
                      .bg(this.historyDays === 3 ? t.raised : "#00000000")
                      .text_color(this.historyDays === 3 ? t.foreground : t.dim)
                      .on_click((_e, cx) => {
                        this.historyDays = 3;
                        this.historyPage = 0;
                        cx.notify();
                      })
                      .child("3 天")
                  )
                  .child(
                    div()
                      .cursor_pointer()
                      .px(5)
                      .py(1.5)
                      .rounded(3)
                      .bg(this.historyDays === 7 ? t.raised : "#00000000")
                      .text_color(this.historyDays === 7 ? t.foreground : t.dim)
                      .on_click((_e, cx) => {
                        this.historyDays = 7;
                        this.historyPage = 0;
                        cx.notify();
                      })
                      .child("7 天")
                  )
              )
              .child(
                h_flex()
                  .gap(4)
                  .items_center()
                  .cursor_pointer()
                  .px(6)
                  .py(2)
                  .rounded(3)
                  .bg(t.surface)
                  .text_size(10.5)
                  .text_color(loading ? t.working : t.muted)
                  .hover((s) => s.bg(t.raised).text_color(t.foreground))
                  .on_click((_e, cx) => {
                    fetchUsageHistory();
                    cx.notify();
                  })
                  .child(div().child(loading ? "⠋ 載入中..." : "↻ 重新整理"))
              )
          )
      )
      // Subtitle status
      .child(
        h_flex()
          .justify_between()
          .items_center()
          .px(2)
          .text_size(10)
          .text_color(t.dim)
          .child(
            div().child(
              `保留最近 7 天採樣 · 共 ${rows.length} 筆窗口紀錄 (顯示第 ${this.historyPage * PAGE_SIZE + 1}–${Math.min(
                (this.historyPage + 1) * PAGE_SIZE,
                rows.length
              )} 筆)`
            )
          )
          .child(div().child("數值為儲存當下剩餘額度"))
      )
      // Records list
      .child(
        v_flex()
          .flex_1()
          .gap(4)
          .overflow_y_scrollbar()
          .when(rows.length === 0, (el) =>
            el.child(
              v_flex()
                .items_center()
                .justify_center()
                .p(24)
                .gap(6)
                .text_color(t.muted)
                .text_size(12)
                .child(
                  loading
                    ? "正在讀取用量歷史紀錄..."
                    : "尚無符合條件的用量紀錄。程式在背景運行時會定期採樣儲存。"
                )
            )
          )
          .children(
            pageRows.map(({ timestamp, card, window }, idx) => {
              const iconPath = providerIcon(card.id);
              const brandColor = providerBrandColor(card.id);
              const pct = typeof window?.percent === "number" ? window.percent : null;
              const color = statusColor(pct, t);
              const bg = statusBg(pct, t);

              return h_flex()
                .id(`hist-row-${idx}`)
                .justify_between()
                .items_center()
                .px(8)
                .py(5)
                .rounded(4)
                .bg(t.surface)
                .border(1)
                .border_color(t.border)
                // Left: Icon + Provider + Kind + Tags
                .child(
                  h_flex()
                    .gap(6)
                    .items_center()
                    .child(
                      h_flex()
                        .size(18)
                        .flex_none()
                        .rounded(3)
                        .items_center()
                        .justify_center()
                        .bg(brandColor)
                        .when(Boolean(iconPath), (el) =>
                          el.child(
                            svg(iconPath)
                              .size(11)
                              .flex_none()
                              .text_color("#ffffff")
                          )
                        )
                    )
                    .child(
                      div()
                        .font_semibold()
                        .text_size(11.5)
                        .text_color(t.foreground)
                        .child(providerShortName(card.id, card.name))
                    )
                    .when(Boolean(window?.kind), (el) =>
                      el.child(
                        div()
                          .px(4)
                          .py(1)
                          .rounded(2)
                          .bg(t.raised)
                          .text_size(9.5)
                          .text_color(t.muted)
                          .child(label(window.kind))
                      )
                    )
                    .when(Boolean(window?.quotaGroup), (el) =>
                      el.child(
                        div()
                          .text_size(9.5)
                          .text_color(t.dim)
                          .child(`[${window.quotaGroup}]`)
                      )
                    )
                    .when(Boolean(window?.account), (el) =>
                      el.child(
                        div()
                          .text_size(9.5)
                          .text_color(t.dim)
                          .child(`(${window.account})`)
                      )
                    )
                )
                // Right: Timestamp + Remaining quota + Resets
                .child(
                  h_flex()
                    .gap(6)
                    .items_center()
                    .child(
                      div()
                        .text_size(10)
                        .text_color(t.dim)
                        .child(dateText(timestamp))
                    )
                    .child(
                      div()
                        .px(6)
                        .py(1.5)
                        .rounded(3)
                        .text_size(10.5)
                        .font_semibold()
                        .bg(pct !== null ? bg : t.raised)
                        .text_color(pct !== null ? color : t.dim)
                        .child(pct !== null ? `剩餘 ${remainingText(pct)}` : (card.error ? "錯誤" : "無額度"))
                    )
                );
            })
          )
      )
      // Pagination controls
      .when(totalPages > 1, (el) =>
        el.child(
          h_flex()
            .justify_between()
            .items_center()
            .pt(4)
            .text_size(11)
            .child(
              div()
                .cursor_pointer()
                .px(8)
                .py(2)
                .rounded(4)
                .bg(this.historyPage > 0 ? t.surface : "#00000000")
                .text_color(this.historyPage > 0 ? t.foreground : t.dim)
                .border(1)
                .border_color(this.historyPage > 0 ? t.border : "#00000000")
                .hover((s) => (this.historyPage > 0 ? s.bg(t.raised) : s))
                .on_click((_e, cx) => {
                  if (this.historyPage > 0) {
                    this.historyPage -= 1;
                    cx.notify();
                  }
                })
                .child("← 上一頁")
            )
            .child(
              div()
                .text_color(t.muted)
                .child(`第 ${this.historyPage + 1} / ${totalPages} 頁`)
            )
            .child(
              div()
                .cursor_pointer()
                .px(8)
                .py(2)
                .rounded(4)
                .bg(this.historyPage + 1 < totalPages ? t.surface : "#00000000")
                .text_color(this.historyPage + 1 < totalPages ? t.foreground : t.dim)
                .border(1)
                .border_color(this.historyPage + 1 < totalPages ? t.border : "#00000000")
                .hover((s) => (this.historyPage + 1 < totalPages ? s.bg(t.raised) : s))
                .on_click((_e, cx) => {
                  if (this.historyPage + 1 < totalPages) {
                    this.historyPage += 1;
                    cx.notify();
                  }
                })
                .child("下一頁 →")
            )
        )
      );
  }

  renderSettings(t, enabledList, cx) {
    return v_flex()
      .flex_1()
      .gap(8)
      .overflow_y_scrollbar()
      .child(
        div()
          .text_size(11.5)
          .text_color(t.muted)
          .child("選擇要在 Herdr 底部狀態列顯示的 Provider：")
      )
      .children(
        ALL_PROVIDERS.map((p) => {
          const isEnabled = enabledList.includes(p.id);

          return h_flex()
            .id(`setting-row-${p.id}`)
            .justify_between()
            .items_center()
            .p(8)
            .rounded(6)
            .bg(t.surface)
            .border(1)
            .border_color(t.border)
            .cursor_pointer()
            .hover((s) => s.bg(t.raised))
            .on_click((_e, cx) => this.toggleProvider(p.id, enabledList, cx))
            // Left: badge + name
            .child(
              h_flex()
                .gap(8)
                .items_center()
                .child(
                  h_flex()
                    .size(22)
                    .flex_none()
                    .rounded(4)
                    .items_center()
                    .justify_center()
                    .bg(p.bg)
                    .child(
                      svg(p.icon)
                        .size(13)
                        .flex_none()
                        .text_color(p.fg)
                    )
                )
                .child(
                  div()
                    .font_semibold()
                    .text_size(12)
                    .text_color(isEnabled ? t.foreground : t.muted)
                    .child(p.name)
                )
            )
            // Right: status toggle pill
            .child(
              div()
                .px(8)
                .py(3)
                .rounded(4)
                .text_size(11)
                .bg(isEnabled ? "#34d39922" : t.raised)
                .text_color(isEnabled ? "#34d399" : t.dim)
                .border(1)
                .border_color(isEnabled ? "#34d39966" : t.border)
                .child(isEnabled ? "✓ 顯示" : "隱藏")
            );
        })
      );
  }

  renderCards(t, cards, enabledList) {
    const visibleCards = cards.filter((c) => enabledList.includes(c.id));

    return v_flex()
      .flex_1()
      .gap(8)
      .overflow_y_scrollbar()
      .when(visibleCards.length === 0, (el) =>
        el.child(
          v_flex()
            .items_center()
            .justify_center()
            .p(24)
            .gap(6)
            .text_color(t.muted)
            .text_size(12)
            .child(cards.length === 0 ? "正在取得本機 AI 額度資料..." : "目前未勾選任何 Provider，請至右上角「⚙ 設定」開啟。")
        )
      )
      .children(
        visibleCards.map((c) => {
          const badgeBg = c.badge?.background ?? t.chrome;
          const badgeFg = c.badge?.foreground ?? t.foreground;
          const shortName = providerShortName(c.id, c.name);
          const iconPath = providerIcon(c.id);

          return v_flex()
            .id(`card-${c.id}`)
            .p(8)
            .gap(6)
            .rounded(6)
            .bg(t.surface)
            .border(1)
            .border_color(t.border)
            // Card title row
            .child(
              h_flex()
                .justify_between()
                .items_center()
                .child(
                  h_flex()
                    .gap(6)
                    .items_center()
                    .child(
                      h_flex()
                        .size(20)
                        .flex_none()
                        .rounded(4)
                        .items_center()
                        .justify_center()
                        .bg(badgeBg)
                        .when(Boolean(iconPath), (el) =>
                          el.child(
                            svg(iconPath)
                              .size(12)
                              .flex_none()
                              .text_color(badgeFg)
                          )
                        )
                        .when(!iconPath, (el) =>
                          el.child(
                            div()
                              .px(5)
                              .py(1)
                              .rounded(3)
                              .bg(badgeBg)
                              .text_color(badgeFg)
                              .font_semibold()
                              .text_size(10.5)
                              .child(shortName[0])
                          )
                        )
                    )
                    .child(
                      div()
                        .font_semibold()
                        .text_size(12)
                        .text_color(t.foreground)
                        .child(c.name)
                    )
                )
                .child(
                  h_flex()
                    .gap(4)
                    .items_center()
                    .when(Boolean(c.note), (el) =>
                      el.child(
                        div()
                          .text_size(10)
                          .text_color(t.muted)
                          .child(c.note)
                      )
                    )
                    .when(Boolean(c.error), (el) =>
                      el.child(
                        div()
                          .text_size(10)
                          .text_color(t.blocked)
                          .child(c.error)
                      )
                    )
                )
            )
            // Windows list
            .when(Array.isArray(c.windows) && c.windows.length > 0, (el) =>
              el.child(
                v_flex()
                  .gap(6)
                  .children(
                    c.windows.map((w, wIdx) => {
                      const pct = typeof w.percent === "number" ? Math.max(0, Math.min(100, w.percent)) : 0;
                      const color = statusColor(pct, t);
                      const tag = w.quotaGroup ? `[${w.quotaGroup}] ` : (w.account ? `[${w.account}] ` : "");
                      const resetStr = w.resetsAt ? `${resetsInText(w.resetsAt)} 後重置` : "";
                      const used = Math.max(0.1, pct);
                      const remain = Math.max(0, 100 - pct);

                      return v_flex()
                        .id(`win-${c.id}-${wIdx}`)
                        .gap(3)
                        // Window info text
                        .child(
                          h_flex()
                            .justify_between()
                            .items_center()
                            .text_size(11)
                            .child(
                              h_flex()
                                .gap(4)
                                .items_center()
                                .child(
                                  div()
                                    .text_color(t.muted)
                                    .child(`${tag}${label(w.kind)}`)
                                 )
                                .when(Boolean(resetStr), (rel) =>
                                  rel.child(
                                    div()
                                      .text_color(t.dim)
                                      .text_size(10)
                                      .child(`(${resetStr})`)
                                  )
                                )
                            )
                            .child(
                              div()
                                .font_semibold()
                                .text_color(color)
                                .child(percentText(pct))
                            )
                        )
                        // Progress bar (No projection note!)
                        .child(
                          h_flex()
                            .h(5)
                            .w_full()
                            .rounded(2)
                            .bg(t.border)
                            .overflow_hidden()
                            .child(div().h_full().flex_grow(used).bg(color))
                            .when(remain > 0, (rel) =>
                              rel.child(div().h_full().flex_grow(remain))
                            )
                        );
                    })
                  )
              )
            );
        })
      );
  }
}
