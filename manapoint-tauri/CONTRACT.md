# Manapoint (Tauri) frontend/backend contract

**This file is the single source of truth. FROZEN — only the owner may change it.**

If you need a rule this contract does not state: **stop and report. Do not invent one**,
even a sensible one. An invented rule is never seen by the other side of the seam.

---

## 0. Layout and ownership

```
manapoint-tauri/
  CONTRACT.md          <- this file (owner)
  ui/
    index.html         <- owner: panel DOM skeleton
    panel.js           <- owner: fetch data, build DOM, measure window size
    icons.js           <- done, read-only
    themes.js          <- package A
    themes.test.mjs    <- package A
    format.js          <- package B
    format.test.mjs    <- package B
    settings.html      <- package C
    settings.css       <- package C
    settings.js        <- package C
    settings.test.mjs  <- package C
    panel.css          <- package D
    panel.preview.html <- package D
  src-tauri/           <- owner, off limits
```

---

## 1. Types

### 1.1 UsageWindowKind

String enum, exactly three values: `"Rolling"` | `"Weekly"` | `"Monthly"`.

### 1.2 UsageWindow

```js
{ kind: "Rolling", percent: 35.5, resetsAt: "2026-09-12T00:00:00Z" | null }
```

`percent` is a float 0–100. `resetsAt` is an RFC 3339 string or `null`.

### 1.3 ProviderDescriptor

```js
{
  id: "claude-code",
  name: "Claude Code",
  credentialHint: "Claude Code 登入狀態",
  badge: { icon: "Claude" | null, text: null | "X", background: "#D97757", foreground: "#FFFFFF" }
}
```

`badge.icon` is a key of `ICONS` exported by `ui/icons.js`; `ICONS[key]` has shape
`{ d, rule }` where `rule` is used directly as the SVG `fill-rule`. When `icon` is null,
render `badge.text` instead.

Provider ids are fixed: `opencode-go`, `claude-code`, `codex`, `grok`.

### 1.4 CardState

```js
{
  id: "claude-code",
  name: "Claude Code",
  badge: { ... },            // same as 1.3
  windows: [UsageWindow, ...],  // may be empty
  note: "上次數字，更新中" | null,
  error: "連線失敗：503" | null
}
```

When `error` is non-null, `windows` is empty. `note` and `error` are mutually exclusive —
never both non-null.

### 1.5 AppSettings

```js
{
  themeName: "石墨",
  cardsLayout: "Vertical" | "Horizontal",
  panelOpacity: 0.85,        // 0.30-1.0
  enabledProviders: ["opencode-go", ...] | null,   // null = all enabled
  providerOrder: ["opencode-go", ...] | null
}
```

Opacity constants: `MIN_OPACITY = 0.30`, `SAFE_OPACITY = 0.80`, `MAX_OPACITY = 1.0`.
Below `SAFE_OPACITY` the settings page shows a warning but **must not block** the user.

---

## 2. Rust commands (`window.__TAURI__.core.invoke`)

Global `__TAURI__` is enabled; the frontend needs no npm packages:

```js
const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
```

| Command | Args | Returns |
|---|---|---|
| `get_state` | — | `{ settings: AppSettings, providers: ProviderDescriptor[], autoStart: bool, autoStartSupported: bool }` |
| `get_cards` | — | `CardState[]` (already ordered and filtered by user prefs) |
| `refresh` | — | `CardState[]` |
| `set_theme` | `{ name }` | `AppSettings` |
| `set_opacity` | `{ value }` | `AppSettings` |
| `set_layout` | `{ layout }` | `AppSettings` |
| `set_provider_enabled` | `{ id, enabled }` | `AppSettings` |
| `set_provider_order` | `{ ids }` | `AppSettings` |
| `set_auto_start` | `{ enabled }` | `{ enabled: bool, error: string \| null }` |
| `start_drag` | — | — (panel drag, see §5) |
| `resize_panel` | `{ width, height }` | — (logical px, see §5) |
| `show_panel_menu` | — | — (native context menu) |
| `minimize_panel` | — | — |
| `open_settings` | — | — |

`providers` in `get_state` is already in the user's chosen order and includes
unchecked ones (the settings list needs all of them).

**Events** (receive with `listen`):

| Event | Payload |
|---|---|
| `cards` | `CardState[]` — pushed after each 5-minute poll |
| `settings` | `AppSettings` — pushed when settings change in another window |

---

## 3. Theme object (produced by package A, consumed by C and D)

`ui/themes.js` exports:

```js
export const WARNING_AT = 60;
export const CRITICAL_AT = 85;
export const THEMES = [ /* five, in the order below */ ];
export function themeByName(name) { /* falls back to THEMES[0] */ }
```

Every theme object has these fields — **all required, names must not change**:

```js
{
  name: "石墨",              // also the value stored in settings.themeName
  description: "連續長條，單一強調色",
  panel: "#1B1E24",
  accent: "#6FA8DC",
  textPrimary: "#E4E9F0",
  textSecondary: "#C8D0DA",
  textMuted: "#B7BBC2",
  track: "#2E333C",
  border: "#3A404A",
  meterStyle: "smooth",      // "smooth" | "segmented" | "text"
  coloring: "accent",        // "accent" | "status"
  status: { good: "#4ADE80", warning: "#FBBF24", critical: "#F87171" },
  monospace: false,
  segmentRadius: 2,          // px
  brackets: false,
  panelWidth: 252,           // px, panel width in vertical layout
  segmentCells: 10,
  segmentWidth: 7            // px
}
```

The five themes, in order: 石墨, 魔力, 終端, 精簡, 紙白. Values are frozen — the contrast
test in `ui/themes.test.mjs` is the guard, so recompute a colour rather than lower a threshold.

---

## 4. Presentation rules (implemented by package B, consumed by C and D)

Pure functions exported from `ui/format.js`. No side effects, no DOM.

| Function | Rule |
|---|---|
| `label(kind)` | `Rolling->"5H"`, `Weekly->"WEEK"`, `Monthly->"MONTH"` |
| `shortLabel(kind)` | `Rolling->"5h"`, `Weekly->"7d"`, `Monthly->"30d"` |
| `percentText(percent)` | `0 -> "0%"`; `0 < p < 1 -> "<1%"`; otherwise rounded integer + `"%"` |
| `alertText(percent, coloring)` | `"!"` when `coloring === "status"` and `percent >= CRITICAL_AT`, else `""` |
| `statusColor(theme, percent)` | `theme.coloring === "accent"` -> `theme.accent`; else `>= CRITICAL_AT` -> critical, `>= WARNING_AT` -> warning, else good |
| `litCells(percent, cells)` | `round(percent / 100 * cells)`; **at least 1 when percent > 0**; clamped to `0..cells` |
| `resetsInText(resetsAt, now)` | null -> `""`; already past -> `"now"`; < 1h -> `"{floor min}m"`; < 1d -> `"{floor h}h"`; else `"{floor d}d"` |

`resetsInText`'s `now` is a `Date`; when omitted it defaults to `new Date()`.

---

## 5. Panel DOM skeleton (owner-produced; package D writes CSS only)

`ui/panel.js` guarantees this structure and these class names.
Package D writes `ui/panel.css` only — **do not touch index.html or panel.js**.

```html
<div id="panel"
     data-layout="vertical|horizontal"
     data-meter="smooth|segmented|text"
     data-mono="true|false">
  <div id="cards">

    <!-- meter themes (smooth / segmented) -->
    <article class="card" data-provider="claude-code">
      <header class="card__head">
        <span class="badge"><svg class="badge__icon" viewBox="0 0 24 24">...</svg></span>
        <h2 class="card__name">Claude Code</h2>
      </header>
      <p class="card__error">連線失敗：503</p>       <!-- omitted when absent -->
      <p class="card__note">此帳號沒有訂閱額度</p>    <!-- omitted when absent -->
      <ul class="meters">
        <li class="meter" data-kind="Rolling">
          <span class="meter__label">5H</span>
          <!-- smooth themes emit this -->
          <div class="meter__track"><div class="meter__fill"></div></div>
          <!-- segmented themes emit this (no __bracket when brackets is false) -->
          <div class="meter__cells">
            <span class="meter__bracket">[</span>
            <i class="cell is-lit"></i><i class="cell"></i>...
            <span class="meter__bracket">]</span>
          </div>
          <span class="meter__value"><b class="meter__alert">!</b>35%</span>
          <span class="meter__reset">4h</span>
        </li>
      </ul>
    </article>

    <!-- compact (text) theme -->
    <article class="card card--compact" data-provider="codex">
      <span class="badge">...</span>
      <span class="compact__slot" data-kind="Rolling"><i>5h</i><b>12%</b></span>
      <span class="compact__slot" data-kind="Weekly"><i>7d</i><b>4%</b></span>
      <span class="compact__slot is-empty" data-kind="Monthly"></span>
      <span class="compact__note">—</span>              <!-- omitted when absent -->
    </article>

  </div>
</div>
```

### 5.1 CSS custom properties (set inline on `#panel` by panel.js)

```
--panel, --panel-alpha, --accent, --text-primary, --text-secondary,
--text-muted, --track, --border, --segment-radius, --segment-width,
--panel-width, --font
```

Per-meter fill colour is set on `.meter` as `--meter-fill`.
`.badge` carries `--badge-bg` and `--badge-fg`.

### 5.2 Layout rules (**these are the two defects this port must fix**)

| `data-layout` | `data-meter` | Layout |
|---|---|---|
| `vertical` | any | Cards stack top to bottom. Panel width fixed at `--panel-width` |
| `horizontal` | `text` | **All cards on ONE single row**: `#cards` is a row, each `.card--compact` is one segment of that row, with a divider between segments. Panel width follows content |
| `horizontal` | `smooth` / `segmented` | **One column per provider** side by side: `#cards` is a row, each `.card` is a `--panel-width` wide column with the header on top and meters stacked below. Panel width follows content |

The C# version's defects were: the compact theme was force-reverted to vertical in
horizontal mode (i.e. it had no horizontal layout at all), and the other themes' horizontal
mode just placed vertical cards side by side without designing for horizontal. Fix both in CSS.

Panel chrome: 10px radius, 1px border (`--border`), padding `13px 11px`,
background `--panel` at `--panel-alpha` opacity (`color-mix` or rgba, either is fine).
`body` must be fully transparent — the window itself is transparent and undecorated.

---

## 6. Hard rules (all packages)

- **No commit, no push, no branches.**
- **Stay out of**: `src-tauri/**`, `ui/index.html`, `ui/panel.js`, `ui/icons.js`,
  and anything outside `manapoint-tauri/`.
- **Do not read files outside the repo**; skip the `@RTK.md` reference in CLAUDE.md.
- **No npm dependencies**, no `package.json`, no CDN. Everything is a native ES module
  loaded directly by the browser; there is no build step.
- **Do not swallow errors**; do not ship `TODO`s.
- Code comments in **English**, explaining *why* not *what*. (User-visible product
  strings — UI labels, messages shown in the app — stay Traditional Chinese.)
- Write the REPORT file in English. Reply with the REPORT file path only.
