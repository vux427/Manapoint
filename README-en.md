# Manapoint
[繁體中文](README.md)

> As an agentic engineer with superpowers, mana is where those powers come from. You need to keep an eye on it.

![Manapoint](docs/images/screenshot.webp)

Four AI subscriptions, one floating panel.

Manapoint is a Rust + Tauri 2 desktop widget that keeps opencode Go, Claude Code, Codex and Grok
usage windows (5-hour / weekly / monthly) on screen. Right-click to refresh, open settings, or quit.

## Themes

| Graphite | Vitals |
|---|---|
| ![](docs/images/theme-graphite.png) | ![](docs/images/theme-vitals.png) |

| Terminal | Compact |
|---|---|
| ![](docs/images/theme-terminal.png) | ![](docs/images/theme-compact.png) |

| Paper |
|---|
| ![](docs/images/theme-paper.png) |

## Features

- Reads the login state your CLIs already have. No API key required, expired tokens are
  refreshed automatically, and no credential is ever written out
- Five panel themes: Graphite, Vitals, Terminal, Compact, Paper
- Vertical and horizontal arrangements, each theme designed for both (the Compact theme
  collapses to a single row when horizontal)
- Drag to reorder providers in the settings window, with an insertion line
- Live edge and corner snapping while you drag — it grips when you get close and lets go
  the moment you pull away, so it never fights your hand
- Failures explain themselves and keep the last known numbers instead of going blank
- Minimise to the tray from the context menu; optional start-at-login

## Build and test

```sh
# Rust side: collectors, window, snapping
cd manapoint-tauri/src-tauri
cargo test
cargo run                 # dev run
cargo build --release     # size-optimised binary

# Frontend side: theme contrast and presentation rules
cd ../..
node --test manapoint-tauri/ui/*.test.mjs
```

The release binary is about 4.7 MB (LTO, opt-level=z, stripped); rendering goes through the
system WebView2, so no runtime is bundled.

Requires Rust 1.82+ and Node 18+ (Node only runs the tests; the UI itself has zero npm
dependencies). On Windows you also need the WebView2 runtime, which ships with Windows 11.

## Layout

```
manapoint-tauri/
  CONTRACT.md          frontend/backend contract: commands, events, DOM, layout rules
  ui/                  plain HTML/CSS/ES modules, no build step
  src-tauri/src/
    providers/         the four collectors and parsers, pure functions where it counts
    snap.rs            edge-snapping geometry
    win.rs             Win32: work area, live snapping during a drag
    lib.rs             window, tray, commands, polling
```

## Docs

- [Provider reference](docs/providers.md): endpoints, credential paths, window definitions
- [Frontend/backend contract](manapoint-tauri/CONTRACT.md): types, commands, layout rules
