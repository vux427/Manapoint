import { ICONS } from "./icons.js";

// Below this floor, text may wash out on light wallpapers. This range stays
// usable at the user's own risk: the page warns but never blocks or disables.
const SAFE_OPACITY = 0.8;

// Preview constants mirror the old settings page so each swatch shows the
// theme's real meter style rather than a generic colour chip.
const SMOOTH_PREVIEW_FILL = 60;
const SEGMENT_PREVIEW_CELLS = 5;
const SEGMENT_PREVIEW_LIT = 3;
const TEXT_PREVIEW_LABEL = "5h";
const TEXT_PREVIEW_VALUE = "12%";
const TEXT_PREVIEW_PERCENT = 12;

// themes.js and format.js are owned by other packages and may not exist yet,
// so they are loaded lazily inside start() instead of via static imports. A
// static import would make even the pure export below unimportable under Node
// while those files are still missing.
let THEMES = [];
let themeByName = (name) => THEMES.find((t) => t.name === name) ?? THEMES[0];
let statusColor = (theme) => theme.accent;

let invoke = null;
let appState = null;
let dragFromId = null;

// Convert a drop position into the dragged row's post-move index. from and
// target are pre-drop indices; insertAfter means the pointer was in the
// target row's lower half. The dragged row is removed first, so an insertion
// point after it shifts down by one.
export function resolveDropIndex(from, target, insertAfter) {
  const index = insertAfter ? target + 1 : target;
  return from < index ? index - 1 : index;
}

function byId(id) {
  return document.getElementById(id);
}

function messageOf(err) {
  return err && err.message ? err.message : String(err);
}

function showError(message) {
  const box = byId("error");
  box.textContent = message;
  box.hidden = false;
}

function currentTheme() {
  return themeByName(appState.settings.themeName);
}

function isEnabled(id) {
  const enabled = appState.settings.enabledProviders;
  return enabled === null ? true : enabled.includes(id);
}

function renderAll() {
  renderThemes();
  renderLayout();
  renderOpacity();
  renderProviders();
  renderAutoStart();
}

function buildThemePreview(theme) {
  const wrap = document.createElement("div");
  wrap.className = "swatch__preview";
  if (theme.monospace) {
    wrap.style.fontFamily = "Cascadia Mono, Consolas, monospace";
  }
  if (theme.meterStyle === "smooth") {
    const track = document.createElement("div");
    track.className = "preview-bar";
    track.style.background = theme.track;
    const fill = document.createElement("div");
    fill.className = "preview-bar__fill";
    fill.style.width = `${SMOOTH_PREVIEW_FILL}%`;
    fill.style.background = theme.accent;
    track.appendChild(fill);
    wrap.appendChild(track);
  } else if (theme.meterStyle === "segmented") {
    const cells = document.createElement("div");
    cells.className = "preview-cells";
    const lit = statusColor(theme, SMOOTH_PREVIEW_FILL);
    for (let i = 0; i < SEGMENT_PREVIEW_CELLS; i += 1) {
      const cell = document.createElement("i");
      const on = i < SEGMENT_PREVIEW_LIT;
      cell.className = on ? "preview-cell is-lit" : "preview-cell";
      cell.style.background = on ? lit : theme.track;
      cell.style.borderRadius = `${theme.segmentRadius}px`;
      cells.appendChild(cell);
    }
    wrap.appendChild(cells);
  } else {
    // Text style carries no graphic; keep the two-part label plus number so
    // colour is never the only encoding, same as the real panel.
    const label = document.createElement("span");
    label.className = "preview-text__label";
    label.style.color = theme.textMuted;
    label.textContent = TEXT_PREVIEW_LABEL;
    const value = document.createElement("span");
    value.className = "preview-text__value";
    value.style.color = statusColor(theme, TEXT_PREVIEW_PERCENT);
    value.textContent = TEXT_PREVIEW_VALUE;
    wrap.append(label, value);
  }
  return wrap;
}

function renderThemes() {
  const list = byId("theme-list");
  list.replaceChildren();
  const selected = currentTheme();
  for (const theme of THEMES) {
    const isSelected = theme.name === selected.name;
    const button = document.createElement("button");
    button.type = "button";
    button.className = isSelected ? "swatch is-selected" : "swatch";
    button.style.background = theme.panel;
    button.style.color = theme.textPrimary;
    button.style.borderColor = theme.border;
    if (isSelected) {
      button.style.outlineColor = theme.accent;
    }
    button.setAttribute("aria-pressed", isSelected ? "true" : "false");
    const name = document.createElement("span");
    name.className = "swatch__name";
    name.textContent = theme.name;
    const desc = document.createElement("span");
    desc.className = "swatch__desc";
    desc.style.color = theme.textMuted;
    desc.textContent = theme.description;
    button.append(buildThemePreview(theme), name, desc);
    button.addEventListener("click", () => selectTheme(theme.name));
    list.appendChild(button);
  }
}

async function selectTheme(name) {
  try {
    appState.settings = await invoke("set_theme", { name });
    renderAll();
  } catch (err) {
    showError(messageOf(err));
  }
}

function renderLayout() {
  const horizontal = appState.settings.cardsLayout === "Horizontal";
  byId("layout-vertical").checked = !horizontal;
  byId("layout-horizontal").checked = horizontal;
}

async function onLayoutChange(event) {
  try {
    appState.settings = await invoke("set_layout", { layout: event.target.value });
    renderLayout();
  } catch (err) {
    // Restore the radios to the persisted value so the page never shows a
    // layout the backend rejected.
    showError(messageOf(err));
    renderLayout();
  }
}

function opacityText(value) {
  return `${Math.round(value * 100)}%`;
}

function renderOpacity() {
  const value = appState.settings.panelOpacity;
  byId("opacity").value = String(value);
  byId("opacity-value").textContent = opacityText(value);
  byId("opacity-warning").hidden = value >= SAFE_OPACITY;
}

function onOpacityInput(event) {
  const value = Number(event.target.value);
  byId("opacity-value").textContent = opacityText(value);
  byId("opacity-warning").hidden = value >= SAFE_OPACITY;
}

async function onOpacityChange(event) {
  const value = Number(event.target.value);
  try {
    // Persist on release only; per-step writes would rewrite the file
    // dozens of times per drag.
    appState.settings = await invoke("set_opacity", { value });
    renderOpacity();
  } catch (err) {
    showError(messageOf(err));
    renderOpacity();
  }
}

function buildBadge(provider) {
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.style.background = provider.badge.background;
  badge.style.color = provider.badge.foreground;
  if (provider.badge.icon === null || provider.badge.icon === undefined) {
    badge.textContent = provider.badge.text ?? "";
  } else {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "badge__icon");
    const entry = ICONS[provider.badge.icon];
    if (entry) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", entry.d);
      path.setAttribute("fill-rule", entry.rule);
      path.setAttribute("fill", "currentColor");
      svg.appendChild(path);
    }
    badge.appendChild(svg);
  }
  return badge;
}

function renderProviders() {
  const list = byId("provider-list");
  list.replaceChildren();
  list.style.setProperty("--insertion", currentTheme().accent);
  appState.providers.forEach((provider, index) => {
    list.appendChild(buildProviderRow(provider, index));
  });
}

function buildProviderRow(provider, index) {
  const row = document.createElement("li");
  row.className = "provider-row";
  row.draggable = true;
  row.dataset.id = provider.id;
  row.dataset.index = String(index);

  const before = document.createElement("div");
  before.className = "drop-line drop-line--before";
  const after = document.createElement("div");
  after.className = "drop-line drop-line--after";

  const main = document.createElement("div");
  main.className = "provider-row__main";

  const grip = document.createElement("span");
  grip.className = "grip";
  grip.textContent = "⠿";
  grip.title = "拖曳以重新排序";
  grip.setAttribute("aria-hidden", "true");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = isEnabled(provider.id);
  checkbox.setAttribute("aria-label", provider.name);
  checkbox.addEventListener("change", () => onProviderToggle(provider.id, checkbox.checked));

  const text = document.createElement("span");
  text.className = "provider-text";
  const name = document.createElement("span");
  name.className = "provider-name";
  name.textContent = provider.name;
  const hint = document.createElement("span");
  hint.className = "provider-hint";
  hint.textContent = provider.credentialHint;
  text.append(name, hint);

  main.append(grip, checkbox, buildBadge(provider), text);
  row.append(before, main, after);

  row.addEventListener("dragstart", (event) => onDragStart(event, row));
  row.addEventListener("dragover", (event) => onDragOver(event, row));
  row.addEventListener("dragleave", clearInsertionLines);
  row.addEventListener("drop", (event) => onDrop(event, row));
  row.addEventListener("dragend", clearDragState);
  return row;
}

async function onProviderToggle(id, enabled) {
  try {
    appState.settings = await invoke("set_provider_enabled", { id, enabled });
    renderProviders();
  } catch (err) {
    showError(messageOf(err));
    renderProviders();
  }
}

function onDragStart(event, row) {
  dragFromId = row.dataset.id;
  row.classList.add("is-dragging");
  if (event.dataTransfer) {
    event.dataTransfer.setData("text/plain", row.dataset.id);
    event.dataTransfer.effectAllowed = "move";
  }
}

function onDragOver(event, row) {
  // Without this the row is not a valid drop target.
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "move";
  }
  if (dragFromId === null || dragFromId === row.dataset.id) {
    // Hovering the dragged row itself shows no insertion line.
    clearInsertionLines();
    return;
  }
  // Pointer in the row's upper half inserts above, lower half below.
  const rect = row.getBoundingClientRect();
  const insertAfter = event.clientY > rect.top + rect.height / 2;
  clearInsertionLines();
  row.classList.add("is-drop-target");
  row.dataset.insertAfter = insertAfter ? "true" : "false";
  const line = row.querySelector(insertAfter ? ".drop-line--after" : ".drop-line--before");
  line.classList.add("is-active");
  line.style.background = currentTheme().accent;
}

function clearInsertionLines() {
  for (const row of document.querySelectorAll(".provider-row.is-drop-target")) {
    row.classList.remove("is-drop-target");
    delete row.dataset.insertAfter;
  }
  for (const line of document.querySelectorAll(".drop-line.is-active")) {
    line.classList.remove("is-active");
  }
}

function clearDragState() {
  dragFromId = null;
  for (const row of document.querySelectorAll(".provider-row.is-dragging")) {
    row.classList.remove("is-dragging");
  }
  clearInsertionLines();
}

async function onDrop(event, row) {
  event.preventDefault();
  const order = appState.providers.map((p) => p.id);
  const from = order.indexOf(dragFromId);
  const target = order.indexOf(row.dataset.id);
  const insertAfter = row.dataset.insertAfter === "true";
  clearDragState();
  if (from < 0 || target < 0 || dragFromId === row.dataset.id) {
    return;
  }
  const index = resolveDropIndex(from, target, insertAfter);
  if (index === from) {
    return;
  }
  const [moved] = order.splice(from, 1);
  order.splice(index, 0, moved);
  try {
    appState.settings = await invoke("set_provider_order", { ids: order });
    const byProviderId = new Map(appState.providers.map((p) => [p.id, p]));
    appState.providers = order.map((id) => byProviderId.get(id)).filter((p) => p !== undefined);
    renderProviders();
  } catch (err) {
    showError(messageOf(err));
    renderProviders();
  }
}

function renderAutoStart() {
  byId("section-autostart").hidden = appState.autoStartSupported === false;
  byId("autostart").checked = appState.autoStart === true;
}

function showAutoStartError(message) {
  const box = byId("autostart-error");
  box.textContent = message;
  box.hidden = false;
}

async function onAutoStartChange(event) {
  const checkbox = event.target;
  byId("autostart-error").hidden = true;
  try {
    const result = await invoke("set_auto_start", { enabled: checkbox.checked });
    appState.autoStart = result.enabled;
    // Trust the backend's reported state, not what was clicked.
    checkbox.checked = result.enabled;
    if (result.error !== null && result.error !== undefined) {
      showAutoStartError(String(result.error));
    }
  } catch (err) {
    showError(messageOf(err));
    checkbox.checked = appState.autoStart === true;
  }
}

function applyRemoteSettings(next) {
  appState.settings = next;
  if (Array.isArray(next.providerOrder)) {
    // Another window reordered providers; follow it while keeping any
    // descriptor the payload does not mention.
    const byProviderId = new Map(appState.providers.map((p) => [p.id, p]));
    const reordered = next.providerOrder.map((id) => byProviderId.get(id)).filter((p) => p !== undefined);
    for (const provider of appState.providers) {
      if (!reordered.includes(provider)) {
        reordered.push(provider);
      }
    }
    appState.providers = reordered;
  }
  renderAll();
}

function bindControls() {
  byId("layout-vertical").addEventListener("change", onLayoutChange);
  byId("layout-horizontal").addEventListener("change", onLayoutChange);
  byId("opacity").addEventListener("input", onOpacityInput);
  byId("opacity").addEventListener("change", onOpacityChange);
  byId("autostart").addEventListener("change", onAutoStartChange);
}

async function start() {
  if (typeof window === "undefined" || !window.__TAURI__) {
    showError("Tauri API 不可用，無法載入設定。");
    return;
  }
  invoke = window.__TAURI__.core.invoke;
  const { listen } = window.__TAURI__.event;
  try {
    const [themesMod, formatMod] = await Promise.all([import("./themes.js"), import("./format.js")]);
    THEMES = themesMod.THEMES;
    themeByName = themesMod.themeByName;
    statusColor = formatMod.statusColor;
  } catch (err) {
    showError("載入共用模組失敗：" + messageOf(err));
    return;
  }
  try {
    appState = await invoke("get_state");
  } catch (err) {
    showError("載入設定失敗：" + messageOf(err));
    return;
  }
  bindControls();
  renderAll();
  try {
    await listen("settings", (event) => {
      applyRemoteSettings(event.payload);
    });
  } catch (err) {
    showError("訂閱設定同步失敗：" + messageOf(err));
  }
}

// Startup stays out of the module top level so Node (no DOM, no Tauri) can
// import the pure export above for unit testing.
if (typeof document !== "undefined") {
  start().catch((err) => {
    showError("啟動設定頁失敗：" + messageOf(err));
  });
}
