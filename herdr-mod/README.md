# Manapoint for Herdr Desktop

把 Manapoint 的六家/七項 AI 訂閱額度（Claude Code、Codex、Grok、Antigravity Gemini、Antigravity 3P、Muse Code、opencode Go）直接內嵌在 [Herdr](https://herdr.dev) 桌面終端底部狀態列中。

![Manapoint Herdr](https://raw.githubusercontent.com/vux427/Manapoint/master/docs/images/screenshot.webp)

## 特色

- **底部狀態列品牌 Icon 即時指示**：在 Herdr 底部狀態列直接顯示各家官方向量 Logo 與當前最緊用量百分比（如 Claude、OpenAI、Grok、OpenCode、Muse、Gemini、Antigravity）。
- **三段狀態色彩預警**：
  - 綠色（<60%）：額度充裕健康
  - 黃色（60% ~ 84%）：用量偏高
  - 紅色（≥85%）：即將用盡或已滿
- **滑鼠停留即時預覽（Tooltip）**：查看各家所有窗口（5H、WEEK、MONTH）與重置倒數時間。
- **點擊展開多功能面板**：點擊狀態列任一指標或 Manapoint 標誌展開彈出視窗，內建三大分頁：
  1. **📊 用量**：即時掌握各家進度條、重置倒數時間、獨立帳號與多模型分組（如 Antigravity Argon）。
  2. **📜 歷史**：完整搬遷用量歷史功能！支援依各家 Provider 篩選、時間區間（24 小時 / 3 天 / 7 天）篩選、即時重整與分頁瀏覽。
  3. **⚙ 設定**：可在 Herdr 介面內直接勾選／隱藏要顯示在底部狀態列的 AI Provider。
- **無縫雙模式取數**：
  1. **本機服務模式**：Manapoint 桌面版執行時，自動透過 `127.0.0.1:47901/v1/cards` 及 `/v1/history` 快速讀取（<10ms）。
  2. **獨立 CLI 模式**：即使 Manapoint 桌面版未啟動，模組會自動調用 `bin/manapoint-cli.exe` 執行無介面取數與歷史存取，完全不依賴主視窗啟動！

## 安裝

在 PowerShell 中執行：

```powershell
pwsh -File .\herdr-mod\install.ps1
```

腳本會自動將模組與佈局安裝至 `~/.config/herdr-app/`，並自動切換 Herdr 視窗至 `manapoint` 佈局。

### 快捷鍵切換佈局

隨時可以在 Herdr 視窗按 `Ctrl+Shift+L` 在各佈局間輪替，或按 `Ctrl+Shift+P` 輸入 `layout.switch` 選擇 `manapoint`。
