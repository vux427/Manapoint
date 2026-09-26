# Manapoint
[繁體中文](README.md)

> As an agentic engineer with superpowers, mana is where those powers come from. You need to keep an eye on it.

![Manapoint](docs/images/screenshot.webp)

Five AI subscriptions, one floating panel.

Manapoint is a desktop widget built with [tinyjs](https://tinyjs.app) — JavaScript on both
sides — that keeps opencode Go, Claude Code, Codex, Grok and Antigravity usage windows
(5-hour / weekly / monthly) on screen. Right-click to refresh, open settings, or quit.

## Download

Grab `Manapoint-<version>-win.zip` from [Releases](https://github.com/vux427/Manapoint/releases),
unzip it anywhere, and double-click `Manapoint.exe`. No installer, no admin rights, no .NET or
Node to install first. The `launcher.exe` beside it is the half that owns the window, so keep
the two files together.

Windows 11 already ships the WebView2 runtime it needs; on Windows 10 without it, the first
run offers to install it.

Clone the repo only if you want to change something — see Build and test below.

### If your antivirus blocks it

Manapoint does not carry a paid code signing certificate yet. Windows Defender and
SmartScreen warn about unsigned executables that few people have downloaded, and sometimes
call them outright malware — that is a false positive. To check the file you have was not
tampered with, compare it against the SHA-256 listed on the Releases page:

```powershell
Get-FileHash .\Manapoint-0.3.1-win.zip -Algorithm SHA256
```

Manapoint only reads the sign-in state each vendor's CLI already stores on your machine and
calls the vendors' official APIs. The whole collection path lives in
`manapoint/src/providers/` and the source is all in this repo. If it stays blocked, you can
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
- Every route, one answer: each provider tries every login it can find (its own CLI,
  logins opencode holds — console login included — and multi-account plugins); any
  route with data wins, and it only errors when all fail. Distinct accounts get one
  group of bars each
- Failures explain themselves and keep the last known numbers instead of going blank
- Usage alerts: a system notification when any window crosses 80% or 95%, or resets
  after being high (can be turned off in settings)
- Burn-rate projection: from the last day's samples, a faint extension of the bar shows
  where the window will be at its reset; if this pace empties it first, the countdown
  turns red and shows "≈time left"
- Minimise to the tray from the context menu; the tray icon turns amber or red with the
  tightest window, and its tooltip lists every provider
- Auto-update: checks GitHub for a new release daily; the context menu then offers
  "更新到 x.y.z", which downloads, verifies and restarts
- Optional start-at-login

## Build and test

Install tinyjs 0.42+ (`irm https://tinyjs.app/install.ps1 | iex`) and Node 18+ (Node only
runs the tests; the app has zero npm dependencies).

```sh
cd manapoint
node --test test/*.test.mjs   # parsers, token rules, snapping geometry, theme contrast
tinyjs dev                    # dev run; frontend edits apply live
tinyjs build                  # dist/Manapoint.exe + dist/launcher.exe
```

A release is about 6.7 MB in total (5.8 MB txiki.js runtime + 0.9 MB WebView2 launcher);
rendering goes through the system WebView2.

When a card shows an error, the diagnostics script says why. It prints only whether files
exist, field names, expiry times and error messages — never a token — so its output is safe
to paste into an issue:

```powershell
cd manapoint
& "$env:LOCALAPPDATA\tinyjs\bin\tjs.exe" run diagnose.js
```

### Releasing

`scripts/release.ps1` runs the tests, builds, signs `launcher.exe` (when a certificate is
configured), zips both executables into `dist/Manapoint-<version>-win.zip` and prints the
SHA-256 for the release notes. It also writes `dist/manifest.json`, the file auto-update
reads — upload it to the release together with the zip. It warns when the build is unsigned — an unsigned executable
is almost certain to be flagged by Defender, so it never passes quietly.

```powershell
# Example: Azure Trusted Signing. {} is replaced with the file to sign.
$env:MANAPOINT_SIGN_CMD = 'signtool sign /v /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib "C:\ats\Azure.CodeSigning.Dlib.dll" /dmdf "C:\ats\metadata.json" "{}"'
pwsh -File scripts\release.ps1
```

## Layout

```
manapoint/
  tinyjs.json          window chrome (frameless, transparent, tray-style) and version
  CONTRACT.md          frontend/backend contract: API, events, DOM, layout rules
  diagnose.js          diagnostics (never prints a secret)
  src/
    main.js            backend entry: API, settings, snapshot, five-minute polling
    providers/         collectors, parsers and token refresh, pure where it counts
    lib/               shared: error kinds, file/network IO, Windows Credential Manager (FFI)
    frontend/          panel and settings pages; panel.js also owns window geometry,
                       drag snapping, the tray and the context menu
  test/                node --test suites
```

## Docs

- [Provider reference](docs/providers.md): endpoints, credential paths, window definitions
- [Frontend/backend contract](manapoint/CONTRACT.md): types, API, layout rules
