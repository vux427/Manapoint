// Manapoint Embedded Workspace Status Bar Mod for Herdr Desktop

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, shared, openOverlay } from "herdr";
import { fetchCards } from "./data.js";
import {
  percentText,
  statusColor,
  statusBg,
  label,
  shortLabel,
  resetsInText,
  providerShortName,
  providerIcon,
  providerBrandColor,
  cardWorstPercent,
  WARNING_AT,
  CRITICAL_AT,
} from "./format.js";

export default class ManapointStatus extends View {
  init(_props, cx) {
    // Initial fetch on mod load
    cx.spawn(async () => {
      await fetchCards();
    });

    // Background poll every 3 minutes
    cx.timer.every(180_000, () => {
      fetchCards();
    });
  }

  // Same keybinding hint detection as Herdr's workspace-status
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = {
      cmd: mac ? "⌘" : "Ctrl+",
      ctrl: mac ? "⌃" : "Ctrl+",
      shift: mac ? "⇧" : "Shift+",
      alt: mac ? "⌥" : "Alt+",
      option: mac ? "⌥" : "Alt+",
    };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  openPopup() {
    openOverlay({
      mod: "manapoint-popup",
      kind: "popup",
      at: "pointer",
      width: 480,
      height: 580,
    });
  }

  render(cx) {
    const t = theme();
    const space = spaces().find((s) => s.active);
    const list = agents();
    const needs = list.filter((a) => a.status === "blocked").length;

    const cards = shared("manapoint.cards") ?? [];
    const loading = Boolean(shared("manapoint.loading"));
    const enabledRaw = shared("manapoint.enabledProviders");
    const visibleCards = Array.isArray(enabledRaw)
      ? cards.filter((c) => enabledRaw.includes(c.id))
      : cards;

    const labelItem = (icon, text) =>
      h_flex()
        .gap(6)
        .items_center()
        .child(svg(`mods/workspace-chrome/${icon}.svg`).size(13))
        .child(text);

    // Calculate worst usage across visible cards
    let overallWorst = -1;
    for (const c of visibleCards) {
      const w = cardWorstPercent(c);
      if (w !== null && w > overallWorst) overallWorst = w;
    }
    const overallDotColor =
      overallWorst >= CRITICAL_AT ? "#f87171" : overallWorst >= WARNING_AT ? "#fbbf24" : "#34d399";

    return h_flex()
      .id("manapoint-status-bar")
      .size_full()
      .px(14)
      .gap(12)
      .items_center()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(11.8)
      .text_color(t.muted)
      // Space / Host info
      .child(labelItem(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), (el) => el.child(labelItem("branch", space.branch)))
      // Agents info
      .child(
        h_flex()
          .gap(6)
          .items_center()
          .child(div().size(6).rounded(3).bg(t.dim))
          .child(`${list.length} agents`)
          .when(needs > 0, (el) =>
            el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))
          )
      )
      // Divider
      .child(div().h(12).w(1).bg(t.border))
      // Manapoint AI Quota Indicators
      .child(
        h_flex()
          .id("manapoint-quotas")
          .gap(6)
          .items_center()
          // Logo / summary badge
          .child(
            h_flex()
              .id("manapoint-summary")
              .gap(4)
              .items_center()
              .px(5)
              .py(1.5)
              .rounded(3)
              .bg(t.surface)
              .border(1)
              .border_color(t.border)
              .cursor_pointer()
              .hover((s) => s.bg(t.raised))
              .tooltip("Manapoint AI 額度：點擊展開明細與設定")
              .on_click(() => this.openPopup())
              .child(image("mods/manapoint-status/icon.svg").size(13))
              .child(div().size(6).rounded(3).bg(overallDotColor))
          )
          // Cards chips
          .children(
            visibleCards.map((c) => {
              const worst = cardWorstPercent(c);
              const shortName = providerShortName(c.id, c.name);
              const color = statusColor(worst, t);
              const bg = statusBg(worst, t);

              // Build tooltip summary
              const details = (c.windows ?? [])
                .map((w) => {
                  const tag = w.quotaGroup ? `[${w.quotaGroup}] ` : (w.account ? `[${w.account}] ` : "");
                  const r = w.resetsAt ? ` (${resetsInText(w.resetsAt)} 後重置)` : "";
                  return `${tag}${shortLabel(w.kind)}: ${percentText(w.percent)}${r}`;
                })
                .join("\n");

              const tooltipText = `${c.name}:\n${details || (c.error ? "錯誤: " + c.error : "尚無用量資料")}`;

              const iconPath = providerIcon(c.id);
              const brandColor = providerBrandColor(c.id);

              return h_flex()
                .id(`quota-pill-${c.id}`)
                .gap(4)
                .items_center()
                .px(5)
                .py(1.5)
                .rounded(3)
                .bg(bg)
                .cursor_pointer()
                .hover((s) => s.bg(t.raised))
                .tooltip(tooltipText)
                .on_click(() => this.openPopup())
                .when(Boolean(iconPath), (el) =>
                  el.child(
                    svg(iconPath)
                      .size(12)
                      .flex_none()
                      .text_color(brandColor)
                  )
                )
                .when(!iconPath, (el) =>
                  el.child(
                    div()
                      .font_semibold()
                      .text_size(10)
                      .text_color(brandColor)
                      .child(shortName[0])
                  )
                )
                .child(
                  div()
                    .font_semibold()
                    .text_size(11)
                    .text_color(color)
                    .child(percentText(worst))
                );
            })
          )
      )
      // Spacer
      .child(div().flex_1())
      // Refresh button
      .child(
        h_flex()
          .id("manapoint-refresh-btn")
          .gap(4)
          .items_center()
          .px(6)
          .py(1.5)
          .rounded(3)
          .cursor_pointer()
          .text_color(loading ? t.working : t.dim)
          .hover((s) => s.bg(t.raised).text_color(t.foreground))
          .tooltip(loading ? "正在更新用量..." : "重新整理 AI 用量")
          .on_click(() => {
            fetchCards();
          })
          .child(div().font_semibold().text_size(12).child(loading ? "⠋" : "↻"))
      )
      // Palette shortcut hint
      .child(
        div()
          .id("palette")
          .text_color(t.dim)
          .cursor_pointer()
          .hover((s) => s.text_color(t.foreground))
          .on_click(() => run("app.palette"))
          .child(this.hint(t))
      );
  }
}
