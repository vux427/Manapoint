// Panel renderer. Owns the DOM shape frozen in CONTRACT.md §5 — panel.css targets these
// exact class names, so changing one without the other silently breaks the layout.

import { ICONS } from "./icons.js";
import { THEMES, themeByName } from "./themes.js";
import {
  alertText,
  label,
  litCells,
  percentText,
  resetsInText,
  shortLabel,
  statusColor,
} from "./format.js";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

const SYSTEM_FONT =
  'system-ui, "Segoe UI", "Microsoft JhengHei UI", "Noto Sans TC", sans-serif';

/** Fixed slot order for the compact theme so columns line up across providers. */
const COMPACT_SLOTS = ["Rolling", "Weekly", "Monthly"];

/** Countdowns are the only thing that changes between polls; re-render them each minute. */
const COUNTDOWN_INTERVAL = 60_000;

const panel = document.getElementById("panel");
const cardsHost = document.getElementById("cards");

let theme = THEMES[0];
let settings = null;
let cards = [];
let lastSize = { width: 0, height: 0 };

// ── rendering ────────────────────────────────────────────────────────────────

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function badgeNode(badge) {
  const host = el("span", "badge");
  host.style.setProperty("--badge-bg", badge.background);
  host.style.setProperty("--badge-fg", badge.foreground);

  const icon = badge.icon ? ICONS[badge.icon] : null;
  if (!icon) {
    host.appendChild(el("b", "badge__text", badge.text ?? ""));
    return host;
  }

  // Built as real SVG nodes rather than innerHTML: the path data is static, but keeping
  // one code path that never parses markup means no injection surface at all.
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "badge__icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", icon.d);
  path.setAttribute("fill-rule", icon.rule);
  path.setAttribute("fill", "currentColor");
  svg.appendChild(path);
  host.appendChild(svg);
  return host;
}

function meterNode(window_, now) {
  const item = el("li", "meter");
  item.dataset.kind = window_.kind;
  item.style.setProperty("--meter-fill", statusColor(theme, window_.percent));

  item.appendChild(el("span", "meter__label", label(window_.kind)));

  if (theme.meterStyle === "segmented") {
    const cells = el("div", "meter__cells");
    if (theme.brackets) cells.appendChild(el("span", "meter__bracket", "["));

    const lit = litCells(window_.percent, theme.segmentCells);
    for (let i = 0; i < theme.segmentCells; i++) {
      cells.appendChild(el("i", i < lit ? "cell is-lit" : "cell"));
    }

    if (theme.brackets) cells.appendChild(el("span", "meter__bracket", "]"));
    item.appendChild(cells);
  } else {
    const track = el("div", "meter__track");
    const fill = el("div", "meter__fill");
    fill.style.width = `${Math.max(0, Math.min(100, window_.percent))}%`;
    track.appendChild(fill);
    item.appendChild(track);
  }

  const value = el("span", "meter__value");
  const alert = alertText(window_.percent, theme.coloring);
  if (alert) value.appendChild(el("b", "meter__alert", alert));
  value.appendChild(document.createTextNode(percentText(window_.percent)));
  item.appendChild(value);

  item.appendChild(el("span", "meter__reset", resetsInText(window_.resetsAt, now)));
  return item;
}

function meterCard(card, now) {
  const article = el("article", "card");
  article.dataset.provider = card.id;

  const head = el("header", "card__head");
  head.appendChild(badgeNode(card.badge));
  head.appendChild(el("h2", "card__name", card.name));
  article.appendChild(head);

  if (card.error) article.appendChild(el("p", "card__error", card.error));
  if (card.note) article.appendChild(el("p", "card__note", card.note));

  if (card.windows.length > 0) {
    const meters = el("ul", "meters");
    for (const w of card.windows) meters.appendChild(meterNode(w, now));
    article.appendChild(meters);
  }
  return article;
}

function compactCard(card) {
  const article = el("article", "card card--compact");
  article.dataset.provider = card.id;
  article.appendChild(badgeNode(card.badge));

  for (const kind of COMPACT_SLOTS) {
    const window_ = card.windows.find((w) => w.kind === kind);
    const slot = el("span", window_ ? "compact__slot" : "compact__slot is-empty");
    slot.dataset.kind = kind;

    // An absent window still occupies its column: that is what keeps the numbers
    // aligned across providers when one of them reports fewer windows.
    if (window_) {
      slot.style.setProperty("--meter-fill", statusColor(theme, window_.percent));
      slot.appendChild(el("i", null, shortLabel(kind)));
      slot.appendChild(el("b", null, percentText(window_.percent)));
    }
    article.appendChild(slot);
  }

  const aside = card.error ?? card.note;
  if (aside) {
    const note = el("span", "compact__note", "—");
    note.title = aside;
    article.appendChild(note);
  }
  return article;
}

function render() {
  const now = new Date();
  const compact = theme.meterStyle === "text";

  panel.dataset.layout = settings.cardsLayout === "Horizontal" ? "horizontal" : "vertical";
  panel.dataset.meter = theme.meterStyle;
  panel.dataset.mono = String(theme.monospace);

  panel.style.setProperty("--panel", theme.panel);
  panel.style.setProperty("--panel-alpha", String(settings.panelOpacity));
  panel.style.setProperty("--accent", theme.accent);
  panel.style.setProperty("--text-primary", theme.textPrimary);
  panel.style.setProperty("--text-secondary", theme.textSecondary);
  panel.style.setProperty("--text-muted", theme.textMuted);
  panel.style.setProperty("--track", theme.track);
  panel.style.setProperty("--border", theme.border);
  panel.style.setProperty("--segment-radius", `${theme.segmentRadius}px`);
  panel.style.setProperty("--segment-width", `${theme.segmentWidth}px`);
  panel.style.setProperty("--panel-width", `${theme.panelWidth}px`);
  panel.style.setProperty("--font", SYSTEM_FONT);

  const next = document.createDocumentFragment();
  for (const card of cards) {
    next.appendChild(compact ? compactCard(card) : meterCard(card, now));
  }
  cardsHost.replaceChildren(next);

  syncWindowSize();
}

/** The OS window has no fixed height; it follows whatever the content just became. */
function syncWindowSize() {
  requestAnimationFrame(() => {
    const rect = panel.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    if (width < 1 || height < 1) return;
    if (width === lastSize.width && height === lastSize.height) return;

    lastSize = { width, height };
    invoke("resize_panel", { width, height }).catch(reportFailure);
  });
}

function reportFailure(err) {
  // Nowhere to surface this in a chromeless panel, but swallowing it silently would
  // make a broken command impossible to diagnose from the webview console.
  console.error("[manapoint]", err);
}

// ── input ────────────────────────────────────────────────────────────────────

function wireInput() {
  panel.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    // Let the OS move the window: compositor-driven dragging tracks the cursor exactly,
    // where repositioning per pointer event lags and jitters.
    invoke("start_drag").catch(reportFailure);
  });

  panel.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    invoke("show_panel_menu").catch(reportFailure);
  });

  // Text selection during a drag looks like a glitch on a widget with no text input.
  panel.addEventListener("selectstart", (event) => event.preventDefault());
}

// ── startup ──────────────────────────────────────────────────────────────────

async function start() {
  const state = await invoke("get_state");
  settings = state.settings;
  theme = themeByName(settings.themeName);
  cards = await invoke("get_cards");
  render();
  wireInput();

  await listen("cards", (event) => {
    cards = event.payload;
    render();
  });

  await listen("settings", (event) => {
    settings = event.payload;
    theme = themeByName(settings.themeName);
    render();
  });

  setInterval(() => {
    if (cards.length > 0) render();
  }, COUNTDOWN_INTERVAL);
}

start().catch(reportFailure);
