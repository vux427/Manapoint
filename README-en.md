# Manapoint
[繁體中文](README.md)

> As an agentic engineer with superpowers, mana is where those powers come from. You need to keep an eye on it.

![Manapoint](docs/images/screenshot.webp)

Five AI subscriptions, one floating panel.

Manapoint is a Rust + Tauri 2 desktop widget that keeps opencode Go, Claude Code, Codex, Grok and Antigravity
usage windows (5-hour / weekly / monthly) on screen. Right-click to refresh, open settings, or quit.

## Download

Grab `Manapoint.exe` from [Releases](https://github.com/vux427/Manapoint/releases), put it
anywhere, double-click it. No installer, no admin rights, no .NET or Node to install first.

Windows 11 already ships the WebView2 runtime it needs; on Windows 10 without it, the first
run offers to install it.

Clone the repo only if you want to change something — see Build and test below.

### If your antivirus blocks it

`Manapoint.exe` does not carry a paid code signing certificate yet. Windows Defender and
SmartScreen warn about unsigned executables that few people have downloaded, and sometimes
call them outright malware — that is a false positive. To check the file you have was not
tampered with, compare it against the SHA-256 listed on the Releases page:

```powershell
Get-FileHash .\Manapoint.exe -Algorithm SHA256
```

Manapoint only reads the sign-in state each vendor's CLI already stores on your machine and
calls the vendors' official APIs. The whole collection path lives in
`src-tauri/src/providers/` and the source is all in this repo. If it stays blocked, you can
report the file at [Microsoft's false positive form](https://www.microsoft.com/en-us/wdsi/filesubmission);
it is usually cleared within a few days.

## Themes

| Graphite | Vitals |
|---|---|
| <img src="docs/images/theme-graphite.png" width="252"> | <img src="docs/images/theme-vitals.png" width="252"> |

| Terminal | Paper |
|---|---|
| <img src="docs/images/theme-terminal.png" width="252"> | <img src="docs/images/theme-paper.png" width="252"> |

| Compact |
|---|
| <img src="docs/images/theme-compact.png" width="196"> |

### Horizontal arrangement

The Compact theme collapses every provider onto a single row:

<img src="docs/images/theme-compact-h.png" width="440">

The other themes give each provider its own column, header on top:

<img src="docs/images/theme-graphite-h.png" width="760">

<img src="docs/images/theme-vitals-h.png" width="760">

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

### Releasing

`scripts/release.ps1` builds, signs (when a certificate is configured), stages the
executable at `dist/Manapoint.exe` and prints the SHA-256 for the release notes. It fails
outright if the version resource lost its publisher or copyright string, and warns when the
binary is unsigned — an unsigned executable is almost certain to be flagged by Defender, so
it never passes quietly.

```powershell
# Example: Azure Trusted Signing. {} is replaced with the file to sign.
$env:MANAPOINT_SIGN_CMD = 'signtool sign /v /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib "C:\ats\Azure.CodeSigning.Dlib.dll" /dmdf "C:\ats\metadata.json" "{}"'
pwsh -File scripts
elease.ps1
```

Requires Rust 1.82+ and Node 18+ (Node only runs the tests; the UI itself has zero npm
dependencies). On Windows you also need the WebView2 runtime, which ships with Windows 11.

## Layout

```
manapoint-tauri/
  CONTRACT.md          frontend/backend contract: commands, events, DOM, layout rules
  ui/                  plain HTML/CSS/ES modules, no build step
  src-tauri/src/
    providers/         the collectors and parsers, pure functions where it counts
    snap.rs            edge-snapping geometry
    win.rs             Win32: work area, live snapping during a drag
    lib.rs             window, tray, commands, polling
```

## Docs

- [Provider reference](docs/providers.md): endpoints, credential paths, window definitions
- [Frontend/backend contract](manapoint-tauri/CONTRACT.md): types, commands, layout rules
