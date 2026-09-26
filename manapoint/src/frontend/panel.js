// Panel renderer and window controller. Owns the DOM shape frozen in CONTRACT.md §5 —
// panel.css targets these exact class names, so changing one without the other
// silently breaks the layout. It also owns everything about the panel *window*
// (geometry, snapping, tray, menus) through tiny.win / tiny.tray / tiny.menu, so the
// backend only ever deals in data.

import { ICONS } from "./icons.js";
import { keepEdges, snap, thresholdFor, workAreaFor } from "./snap.js";
import { THEMES, themeByName } from "./themes.js";
import {
  alertText,
  label,
  litCells,
  percentText,
  resetsInText,
  runOutText,
  shortLabel,
  statusColor,
  trayLevel,
  trayTooltip,
} from "./format.js";

const call = (method, params) => tiny.api.call(method, params);

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
/** { current, latest, notes } when a newer release is available. */
let update = null;

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
    const ahead = window_.projected ? litCells(Math.min(100, window_.projected), theme.segmentCells) : lit;
    for (let i = 0; i < theme.segmentCells; i++) {
      cells.appendChild(el("i", i < lit ? "cell is-lit" : i < ahead ? "cell is-projected" : "cell"));
    }

    if (theme.brackets) cells.appendChild(el("span", "meter__bracket", "]"));
    item.appendChild(cells);
  } else {
    const track = el("div", "meter__track");
    // The ghost shows where this pace leaves the window at its reset.
    if (window_.projected) {
      const ghost = el("div", "meter__ghost");
      ghost.style.width = `${Math.min(100, window_.projected)}%`;
      track.appendChild(ghost);
    }
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

  // A window this pace empties early counts down to that instead of the reset.
  const runOut = runOutText(window_, now);
  const reset = el("span", runOut ? "meter__reset is-runout" : "meter__reset", runOut ? runOut.short : resetsInText(window_.resetsAt, now));
  if (runOut) item.title = runOut.title;
  item.appendChild(reset);
  return item;
}

/**
 * Windows grouped by account, in first-seen order. Windows without an `account` tag
 * (every single-account provider) form one unlabelled group, so those cards render
 * exactly as they always have.
 */
function accountGroups(windows) {
  const groups = [];
  for (const w of windows) {
    const account = w.account ?? null;
    let group = groups.find((g) => g.account === account);
    if (!group) groups.push((group = { account, windows: [] }));
    group.windows.push(w);
  }
  return groups.length ? groups : [{ account: null, windows: [] }];
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
    const groups = accountGroups(card.windows);
    for (const group of groups) {
      // Label a group only when there is more than one: a lone account needs no name.
      if (groups.length > 1) meters.appendChild(el("li", "meter-group", group.account));
      for (const w of group.windows) meters.appendChild(meterNode(w, now));
    }
    article.appendChild(meters);
  }
  return article;
}

/** One compact row per account, so every account keeps the same aligned columns. */
function compactCards(card) {
  const groups = accountGroups(card.windows);
  return groups.map((group, i) => compactCard(card, group, i === 0));
}

function compactCard(card, group, first) {
  const article = el("article", "card card--compact");
  article.dataset.provider = card.id;
  if (group.account) {
    article.dataset.account = group.account;
    article.title = `${card.name} · ${group.account}`;
  }
  article.appendChild(badgeNode(card.badge));

  for (const kind of COMPACT_SLOTS) {
    const window_ = group.windows.find((w) => w.kind === kind);
    const slot = el("span", window_ ? "compact__slot" : "compact__slot is-empty");
    slot.dataset.kind = kind;

    // An absent window still occupies its column: that is what keeps the numbers
    // aligned across providers when one of them reports fewer windows.
    if (window_) {
      slot.style.setProperty("--meter-fill", statusColor(theme, window_.percent));
      const runOut = runOutText(window_);
      if (runOut) {
        slot.classList.add("is-runout");
        slot.title = runOut.title;
      }
      slot.appendChild(el("i", null, shortLabel(kind)));
      slot.appendChild(el("b", null, percentText(window_.percent)));
    }
    article.appendChild(slot);
  }

  // The card-level note or error belongs to the provider: show it once, on the first row.
  const aside = first ? card.error ?? card.note : null;
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
  panel.style.setProperty("--critical", theme.status.critical);
  panel.style.setProperty("--segment-radius", `${theme.segmentRadius}px`);
  panel.style.setProperty("--segment-width", `${theme.segmentWidth}px`);
  panel.style.setProperty("--panel-width", `${theme.panelWidth}px`);
  panel.style.setProperty("--font", SYSTEM_FONT);

  const next = document.createDocumentFragment();
  for (const card of cards) {
    if (compact) next.append(...compactCards(card));
    else next.appendChild(meterCard(card, now));
  }
  cardsHost.replaceChildren(next);

  syncWindowSize();
}

// ── window geometry ──────────────────────────────────────────────────────────
// tinyjs positions and sizes windows in its own units (win.setPosition, getState,
// app.screens all agree). The page lays out in CSS pixels, so every conversion goes
// through the ratio between the page box as the window reports it and as the page
// sees it — correct at any display scale without assuming which unit either side uses.

const unitsPerCssPx = (state) =>
  state && state.width > 0 && window.innerWidth > 0 ? state.width / window.innerWidth : 1;

const outerSize = (s) => [s.outer?.width ?? s.width, s.outer?.height ?? s.height];

/** The OS window has no fixed height; it follows whatever the content just became. */
function syncWindowSize() {
  requestAnimationFrame(() => {
    const rect = panel.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    if (width < 1 || height < 1) return;
    if (width === lastSize.width && height === lastSize.height) return;

    lastSize = { width, height };
    resizeKeepingEdges(width, height).catch(reportFailure).finally(revealOnce);
  });
}

let revealed = false;

/** "activation": "accessory" launches hidden, so the first paint the user sees is
 * already the right size instead of the manifest's placeholder box. */
function revealOnce() {
  if (revealed) return;
  revealed = true;
  tiny.win.center();
  tiny.win.show();
}

/** Growing content must not push a bottom-anchored panel off the screen, so any edge
 * the window was already flush against is preserved. */
async function resizeKeepingEdges(width, height) {
  const before = await tiny.win.getState();
  const k = unitsPerCssPx(before);
  tiny.win.setSize(Math.round(width * k), Math.round(height * k));

  const [after, screens] = await Promise.all([tiny.win.getState(), tiny.app.screens()]);
  const area = workAreaFor(screens, [before.x, before.y], outerSize(before));
  if (!area) return;
  const [x, y] = keepEdges([after.x, after.y], outerSize(before), outerSize(after), area);
  if (x !== after.x || y !== after.y) tiny.win.setPosition(x, y);
}

function reportFailure(err) {
  // Nowhere to surface this in a chromeless panel; the backend terminal is the one
  // place a broken call can be diagnosed from.
  console.error("[manapoint]", err);
  tiny.log(`[panel] ${err && err.message ? err.message : err}`);
}

// ── drag with live edge snapping ─────────────────────────────────────────────
// The page moves the window itself so it can snap *during* the drag: the panel
// visibly grips an edge while the user is still holding it. Positions derive from
// the pointer's travel since pointerdown, never from where the window was last put —
// deriving from the snapped position would compound, welding the panel to the edge.
// Escaping therefore always costs exactly one threshold of movement.

let drag = null;

function beginDrag(event) {
  panel.setPointerCapture(event.pointerId);
  const d = { startX: event.screenX, startY: event.screenY, x: event.screenX, y: event.screenY };
  drag = d;
  // Moves that arrive before the window state does are folded into the first apply.
  Promise.all([tiny.win.getState(), tiny.app.screens()])
    .then(([state, screens]) => {
      if (drag !== d) return;
      Object.assign(d, {
        k: unitsPerCssPx(state),
        origin: [state.x, state.y],
        size: outerSize(state),
        screens,
        sent: [state.x, state.y],
      });
      applyDrag();
    })
    .catch(reportFailure);
}

let dragFrame = 0;

function applyDrag() {
  dragFrame = 0;
  const d = drag;
  if (!d || !d.origin) return;
  const raw = [
    Math.round(d.origin[0] + (d.x - d.startX) * d.k),
    Math.round(d.origin[1] + (d.y - d.startY) * d.k),
  ];
  const area = workAreaFor(d.screens, raw, d.size);
  const [x, y] = area ? snap(raw, d.size, area, thresholdFor(d.k)) : raw;
  if (x === d.sent[0] && y === d.sent[1]) return;
  d.sent = [x, y];
  tiny.win.setPosition(x, y);
}

function wireDrag() {
  panel.addEventListener("pointerdown", (event) => {
    if (event.button === 0) beginDrag(event);
  });
  panel.addEventListener("pointermove", (event) => {
    if (!drag) return;
    drag.x = event.screenX;
    drag.y = event.screenY;
    // One window move per frame: pointer events can outpace what is worth sending.
    dragFrame ||= requestAnimationFrame(applyDrag);
  });
  const end = () => {
    drag = null;
  };
  panel.addEventListener("pointerup", end);
  panel.addEventListener("pointercancel", end);
  panel.addEventListener("lostpointercapture", end);

  // Text selection during a drag looks like a glitch on a widget with no text input.
  panel.addEventListener("selectstart", (event) => event.preventDefault());
}

// ── menus, tray, minimise ────────────────────────────────────────────────────
// Native menus rather than HTML ones: the panel is only a couple of hundred pixels
// tall, so an in-page menu would be clipped by the window bounds.

/** An update, once known, heads both menus: it is the one thing worth acting on. */
const updateItems = () => (update ? [{ id: "update", label: `更新到 ${update.latest}` }, { separator: true }] : []);

const panelMenu = () => [
  ...updateItems(),
  { id: "refresh", label: "重新整理" },
  { separator: true },
  { id: "minimize", label: "最小化" },
  { id: "settings", label: "設定…" },
  { separator: true },
  { id: "quit", label: "結束" },
];

const trayMenu = () => [
  ...updateItems(),
  { id: "show", label: "顯示面板" },
  { id: "settings", label: "設定…" },
  { separator: true },
  { id: "quit", label: "結束" },
];

const TRAY_ICONS = { good: "tray.png", warning: "tray-warning.png", critical: "tray-critical.png" };

/** tray.set wants a real file path; the page knows where its own files live. */
function trayIconPath(level) {
  const name = TRAY_ICONS[level] ?? TRAY_ICONS.good;
  const path = decodeURIComponent(new URL(`./${name}`, location.href).pathname);
  return path.replace(/^\/([A-Za-z]:)/, "$1");
}

let minimized = false;

/** The tray icon exists only while minimised; its colour and tooltip follow the cards. */
function syncTray() {
  if (!minimized) return;
  tiny.tray.set({
    icon: trayIconPath(trayLevel(cards)),
    template: false,
    tooltip: trayTooltip(cards),
    menu: trayMenu(),
    primaryAction: true,
  });
}

/** Show both ways home only while hidden: a permanent tray icon plus a taskbar button
 * would occupy two slots for a widget that normally sits on the desktop. */
function minimizePanel() {
  minimized = true;
  syncTray();
  tiny.app.presence("normal");
  tiny.win.minimize();
}

function showPanel() {
  tiny.win.restore();
  tiny.win.show();
}

/** Back from the tray or taskbar: stop occupying either again. */
function settleRestored() {
  if (!minimized) return;
  minimized = false;
  tiny.tray.remove();
  tiny.app.presence("menubar");
}

function openSettings() {
  // Opens, or focuses the one already open.
  tiny.win.open("settings", { page: "settings.html", title: "Manapoint 設定", size: "420x640" });
}

async function handleMenu(id) {
  switch (id) {
    case "refresh":
      cards = await call("refresh");
      render();
      break;
    case "minimize":
      minimizePanel();
      break;
    case "settings":
      showPanel();
      openSettings();
      break;
    case "show":
      showPanel();
      break;
    case "quit":
      tiny.quit();
      break;
    case "update":
      await installUpdate();
      break;
  }
}

let installing = false;

/** On success the app relaunches as the new version; this page never hears back. */
async function installUpdate() {
  if (installing) return;
  installing = true;
  try {
    await call("install_update");
  } catch (err) {
    tiny.notify("Manapoint 更新失敗", String(err && err.message ? err.message : err));
    reportFailure(err);
  } finally {
    installing = false;
  }
}

function setUpdate(next) {
  update = next;
  tiny.menu.setContext(panelMenu());
  syncTray();
}

function wireMenus() {
  tiny.menu.setContext(panelMenu());
  tiny.menu.onContext((id) => handleMenu(id).catch(reportFailure));
  tiny.tray.on((id) => handleMenu(id).catch(reportFailure));
  tiny.tray.onClick(showPanel);
  tiny.win.onState(({ win, minimized: isMin, focused }) => {
    if (win === "main" && !isMin && focused) settleRestored();
  });
}

// ── startup ──────────────────────────────────────────────────────────────────

async function start() {
  const state = await call("get_state");
  settings = state.settings;
  theme = themeByName(settings.themeName);
  cards = await call("get_cards");
  update = state.update ?? null;

  tiny.win.setAlwaysOnTop(true);
  tiny.win.setResizable(false);
  render();
  wireDrag();
  wireMenus();

  tiny.api.on("cards", (next) => {
    cards = next;
    render();
    syncTray();
  });
  tiny.api.on("update", setUpdate);
  tiny.api.on("settings", (next) => {
    settings = next;
    theme = themeByName(settings.themeName);
    render();
  });

  setInterval(() => {
    if (cards.length > 0) render();
  }, COUNTDOWN_INTERVAL);
}

start().catch(reportFailure);
