# Manapoint

> As an Agentic engineer with superpowers, Mana is the source of your power — keep it under control at all times.

![Manapoint](docs/images/screenshot.webp)

Usage of four AI subscriptions, all in one floating panel.

Manapoint is an Avalonia desktop widget that keeps opencode Go, Claude Code, Codex and Grok
usage windows (5-hour / weekly / monthly) always visible. Right-click to refresh, open settings, or quit.

Built with C# + Avalonia 12, cross-platform (Windows / macOS / Linux).

## Gallery

| Graphite | Vitals |
|---|---|
| ![](docs/images/theme-graphite.png) | ![](docs/images/theme-vitals.png) |

| Terminal | Compact |
|---|---|
| ![](docs/images/theme-terminal.png) | ![](docs/images/theme-compact.png) |

| Paper |
|---|
| ![](docs/images/theme-paper.png) |

[中文版](README.md)

## Features

- Reads only the login state already written by each vendor's CLI on your machine. No API keys; expired tokens auto-refresh; no credential leakage.
- Five panel styles: Graphite, Vitals, Terminal, Compact, Paper.
- Reorder subscriptions by drag and drop in settings, with an insertion-line indicator.
- Fetch failures show their reason instead of silently hiding.
- Start on boot (Windows, toggle in settings, no admin rights needed).

## Build & Test

```sh
dotnet build src/Manapoint/Manapoint.csproj
dotnet test tests/Manapoint.Tests/Manapoint.Tests.csproj
```

Requires the .NET 10 SDK.

## Docs

- [Provider fetch reference](docs/providers.md): endpoints, credential locations and window definitions for each provider.
  (Document is written in Traditional Chinese.)
