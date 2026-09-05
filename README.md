# Manapoint

> 作為一個擁有超能力的 Agentic 工程師，魔力就是你的超能力根源，你需要隨時掌控好他們。
>
> *As an Agentic engineer with superpowers, Mana is the source of your power — keep it under control at all times.*

![Manapoint](docs/images/screenshot.webp)

四家 AI 訂閱的用量，一個懸浮小面板全看到。
*Usage of four AI subscriptions, all in one floating panel.*

Manapoint 是 Avalonia 桌面小工具，常駐顯示 opencode Go、Claude Code、Codex、Grok
的用量窗口（5 小時 / 每週 / 每月），右鍵可重新整理、開設定、結束。
*Manapoint is an Avalonia desktop widget that keeps opencode Go, Claude Code, Codex and Grok
usage windows (5-hour / weekly / monthly) always visible. Right-click to refresh, open settings, or quit.*

## 特色 | Features

- 只讀本機各家 CLI 既有的登入狀態，不要求 API key，不換發 token，不寫出憑證
  *Reads only the login state already written by each vendor's CLI on your machine. No API keys, no token refresh, no credential leakage.*
- 五種面板風格：石墨、血條、終端、精簡、紙白
  *Five panel styles: Graphite, Vitals, Terminal, Compact, Paper.*
- 訂閱顯示順序可在設定頁拖曳調整（有插入線指示）
  *Reorder subscriptions by drag and drop in settings, with an insertion-line indicator.*
- 取數失敗時顯示原因，不靜默隱藏
  *Fetch failures show their reason instead of silently hiding.*

## 建置與測試 | Build & Test

```sh
dotnet build src/Manapoint/Manapoint.csproj
dotnet test tests/Manapoint.Tests/Manapoint.Tests.csproj
```

需要 .NET 10 SDK。*Requires the .NET 10 SDK.*

## 文件 | Docs

- [Provider 取數對照表 | Provider fetch reference](docs/providers.md)：各家 endpoint、憑證位置、窗口定義
  *Endpoints, credential locations and window definitions for each provider.*
