# Provider 取數對照表

四家 AI 訂閱的用量來源。全部讀本機既有的登入憑證，不需要另外申請 API key，
不需要帳號密碼。所有 endpoint 皆為非公開介面，可能隨對方改版而失效。

## opencode Go

已驗證（2026-09-05）。

- 憑證：`~/.local/share/opencode/auth.json` → `["opencode-go"].key`（`sk-` 開頭）
- 請求：`GET https://opencode.ai/zen/go/v1/usage`
- 認證：`Authorization: Bearer <key>`
- 成本：純讀，不消耗配額

回傳：

```json
{ "usage": {
    "rolling": { "status": "ok", "percent": 0,  "resetsAt": "2026-09-05T13:38:32.096Z" },
    "weekly":  { "status": "ok", "percent": 15, "resetsAt": "2026-09-07T00:00:00.096Z" },
    "monthly": { "status": "ok", "percent": 24, "resetsAt": "2026-09-10T06:10:40.096Z" }
} }
```

窗口對應 Go 方案的三層金額上限：

| 欄位 | 窗口 | 上限 |
|---|---|---|
| `rolling` | 每 5 小時 | $12 |
| `weekly`  | 每週 | $30 |
| `monthly` | 每月 | $60 |

`percent` 是已用百分比，`resetsAt` 為 ISO8601 UTC。

備註：gateway 對 chat/completions 不回 `x-ratelimit-*` header，
CLI 本身也不輪詢配額，只在撞上限時處理 `account_rate_limit` 錯誤。
此 `/usage` 路徑未見於官方文件，是探測得出的。

## Claude Code

待實作。

- 憑證：`~/.claude/.credentials.json` → `claudeAiOauth`
- 換發：`POST https://platform.claude.com/v1/oauth/token`
  （`grant_type=refresh_token`，client_id 為 Claude Code 公開值）
- 請求：`GET https://api.anthropic.com/api/oauth/usage`
- 提供 5 小時 / 每週 窗口，另有模型分軸的 scoped window

## Codex

已驗證（2026-09-05）。

- 憑證：`~/.codex/auth.json` → `tokens.access_token`、`tokens.account_id`
- 請求：`GET https://chatgpt.com/backend-api/wham/usage`
- 認證：`Authorization: Bearer <access_token>` 加 `chatgpt-account-id: <account_id>`

回傳（節錄，已略去帳號個資）：

```json
{ "rate_limit": {
    "primary_window":   { "used_percent": 0,  "limit_window_seconds": 18000,  "reset_at": 1788617477 },
    "secondary_window": { "used_percent": 98, "limit_window_seconds": 604800, "reset_at": 1788756101 }
} }
```

窗口類型**依 `limit_window_seconds` 判斷，不依欄位順序**：
18000 秒為 5 小時、604800 秒為 7 天。`reset_at` 是 Unix 秒。
部分方案沒有 `secondary_window`。

注意：回應含 email、user_id、account_id 等個資，解析時只取用量欄位，其餘不保留。

## Grok

已驗證（2026-09-05，credits 形狀 2026-09-06）。

- 憑證：`~/.local/share/opencode/auth.json` → `xai.access`
  **不需要安裝 Grok CLI**——opencode 的 xAI OAuth token 可直接通到
  grok.com 的帳務介面，這點是實測確認的。
- 請求：`GET https://cli-chat-proxy.grok.com/v1/billing?format=credits`
- 認證：`Authorization: Bearer <access>`
  加 `x-xai-token-auth: xai-grok-cli` 與 `accept: application/json`
 （Grok CLI 本身也是這組 header）

回傳的 `config` 有兩種訊號，兩種都吃：

- credits 形狀：`creditUsagePercent` 為每週點數池已用百分比，
  重置時間先看 `currentPeriod.end`，沒有才退回 `billingPeriodEnd`。
  實測確認：opencode 授權在某些帳號上月結額度為 0，
  但這個每週百分比有數字——這就是之前顯示「沒有額度」的原因：
  舊版只問了月結形狀。
- 原形狀：`monthlyLimit.val`／`used.val`（皆包在 `{ "val": n }` 裡）。
  只有 `monthlyLimit > 0` 才算得出比例，此時多顯示一欄 MONTH。

兩種訊號都沒有時顯示說明文字而非畫一條 0%。

注意：`/v1/user` 回應含 email、姓名、userId 等個資，本專案不呼叫該端點。

---

Claude / Codex / Grok 三家的 endpoint 出處為 MIT 授權的
[RiahStudio/riah-usage](https://github.com/RiahStudio/riah-usage)
（`collect-usage.js`、`lib/pull-claude.py`、`lib/parse-grok-billing.js`）。
本專案為獨立實作，未複製其程式碼。

---

## 憑證政策

Manapoint 只讀取使用者自己機器上、由各家官方 CLI 寫下的登入狀態。

- **不換發 token。** 換發需要冒用該 CLI 的 OAuth client_id，並回寫別人的憑證檔。
  對一個要交給他人使用的工具，這風險不該由使用者承擔。
  token 過期時保留上次數字並顯示指示，該 CLI 下次執行自動換發後即恢復，
  不需重新登入。
- **不要求 API key 或密碼。**
- **不寫出 token。** 快取檔與記錄檔都不含憑證。

因此每個人在自己的機器上只會看到自己的用量，不需要 Manapoint 端的帳號系統。
