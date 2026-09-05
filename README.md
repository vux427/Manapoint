# Manapoint

![Manapoint](docs/images/screenshot.webp)

四家 AI 訂閱的用量，一個懸浮小面板全看到。

Manapoint 是 Avalonia 桌面小工具，常駐顯示 opencode Go、Claude Code、Codex、Grok
的用量窗口（5 小時 / 每週 / 每月），右鍵可重新整理、開設定、結束。

## 特色

- 只讀本機各家 CLI 既有的登入狀態，不要求 API key，不換發 token，不寫出憑證
- 五種面板風格：石墨、血條、終端、精簡、紙白
- 訂閱顯示順序可在設定頁拖曳調整（有插入線指示）
- 取數失敗時顯示原因，不靜默隱藏

## 建置與測試

```sh
dotnet build src/Manapoint/Manapoint.csproj
dotnet test tests/Manapoint.Tests/Manapoint.Tests.csproj
```

需要 .NET 10 SDK。

## 文件

- [Provider 取數對照表](docs/providers.md)：各家 endpoint、憑證位置、窗口定義
