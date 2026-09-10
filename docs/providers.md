# Provider 取數對照表

五家 AI 訂閱的用量來源，共六張卡（Antigravity 的兩個額度池各一張）。
全部讀本機既有的登入憑證，不需要另外申請 API key，不需要帳號密碼。
所有 endpoint 皆為非公開介面，可能隨對方改版而失效。

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

已驗證（2026-09-05 取數；換發流程對照 MIT 授權的 riah-usage `lib/pull-claude.py`）。

- 憑證：`~/.claude/.credentials.json` → `claudeAiOauth`（`accessToken`、`refreshToken`、`expiresAt` 毫秒）
- 換發：`POST https://platform.claude.com/v1/oauth/token`
  （`grant_type=refresh_token`，client_id 為 Claude Code 公開值
  `9d1c250a-e61b-44d9-88ed-5944d1962f5e`；回 `access_token`／輪換的
  `refresh_token`／`expires_in` 秒）
- 請求：`GET https://api.anthropic.com/api/oauth/usage`，附
  `anthropic-beta: oauth-2025-04-20`
- 提供 5 小時 / 每週 窗口，另有模型分軸的 scoped window（目前只取前兩者）
- 本機 `expiresAt` 只當提示：到期前 5 分鐘主動換發並寫回同一個憑證檔
  （只動 `claudeAiOauth` 的三個 token 欄位，保留 scopes 等中繼資料）；
  用量 API 回 401/403 時再換發重試一次，仍失敗才顯示登入指示

## Codex

已驗證（2026-09-05）。

- 憑證：`~/.codex/auth.json` → `tokens.access_token`、`tokens.account_id`
- 換發：`POST https://auth.openai.com/oauth/token`（JSON body：
  `client_id` 為 Codex 公開值 `app_EMoamEEZ73f0CkXaXp7hrann`、
  `grant_type=refresh_token`、`refresh_token`；沿用 Codex 自己的
  `CODEX_REFRESH_TOKEN_URL_OVERRIDE`／`CODEX_APP_SERVER_LOGIN_CLIENT_ID`
  覆寫；回 `access_token`／輪換的 `refresh_token`／`id_token`）
  並寫回同一個憑證檔（只動 `tokens` 與 `last_refresh`）
- 到期前 5 分鐘（JWT `exp`）或閒置超過 8 天（`last_refresh`）主動換發，
  與 CLI 本體一致；用量 API 回 401/403 時再換發重試一次
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
部分方案沒有 5 小時窗口（premium）或沒有 `secondary_window`。讀不到的窗口直接略過。

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

回傳的 `config` 有三種訊號，每週池優先順序為
`creditUsagePercent` → `productUsage[].usagePercent` 取最大：

- credits 形狀：`creditUsagePercent` 為每週點數池已用百分比，
  重置時間先看 `currentPeriod.end`，沒有才退回 `billingPeriodEnd`。
  實測確認：opencode 授權在某些帳號上月結額度為 0，
  但這個每週百分比有數字——這就是之前顯示「沒有額度」的原因：
  舊版只問了月結形狀。
- SuperGrok（統一帳單）形狀：`isUnifiedBillingUser: true` 且
  `currentPeriod.type` 為 `USAGE_PERIOD_TYPE_WEEKLY` 的帳號，
  有時省略頂層 `creditUsagePercent`，改以
  `productUsage: [{"product": "GrokBuild", "usagePercent": n}]`
  逐產品回報（沒有數字的產品如 `{"product": "GrokChat"}` 直接略過）。
- 原形狀：`monthlyLimit.val`／`used.val`（皆包在 `{ "val": n }` 裡）。
  只有 `monthlyLimit > 0` 才算得出比例，此時多顯示一欄 MONTH。

三種訊號都沒有時顯示說明文字而非畫一條 0%，但有一個例外：
xAI 會省略零值的百分比欄位，因此統一帳單加每週週期、
且所有金額（`monthlyLimit`／`used`／`onDemandCap`／`onDemandUsed`／
`prepaidBalance`）全為零時，視為全新未用池，顯示 Weekly 0% 並附
「本週期尚無用量」（實測 2026-09-10 的 SuperGrok 新週期即如此）。
任一金額非零卻無百分比時仍只顯示
「SuperGrok 統一帳單，帳務端未回傳用量百分比（下次重置 YYYY-MM-DD）」，
絕不合成 0%——帳務端沒給數字不代表訂閱不存在，
Opencode 聊天走的是同一個 token 的 chat 通道，不受此影響。

注意：`/v1/user` 回應含 email、姓名、userId 等個資，本專案不呼叫該端點。

## Antigravity

已驗證（2026-09-09）。Antigravity CLI 的執行檔是 `agy`。

- 憑證：**不是檔案**，是 OS keyring。`agy` 透過 go-keyring 存在 service `gemini`、
  account `antigravity` 底下；Windows 上就是憑證管理員的一般認證
  `gemini:antigravity`，blob 是 UTF-8 JSON：

  ```json
  { "token": { "access_token": "ya29…", "token_type": "Bearer",
               "refresh_token": "1//…", "expiry": "2026-09-09T00:37:23.75+08:00" },
    "auth_method": "consumer" }
  ```

- 換發：`POST https://oauth2.googleapis.com/token`（form：`client_id`／
  `client_secret`／`refresh_token`／`grant_type=refresh_token`）。client 是
  Antigravity 的公開 installed-app OAuth client，id 為
  `1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com`，
  Google 的流程要求連 secret 一起送——installed-app client 的 secret 本質上無法保密，
  所以它就夾在 `agy` 執行檔裡，不是使用者的祕密。
- **換發到的 token 不寫回 keyring。** 那裡是 `agy` 自己的登入狀態，Google 的
  refresh token 又會輪換，寫進去可能把 CLI 踢出它自己的 session。新 token 只留在
  Manapoint 的行程記憶體裡（常駐程式，一次換發夠用很多輪；重啟就再換一次），
  這同時守住下面「不寫出 token」那條。
- 到期前 5 分鐘主動換發；用量 API 回 401/403 時再換發重試一次。
- 請求：`POST /v1internal:retrieveUserQuotaSummary`，host **依序**試
  `daily-cloudcode-pa.googleapis.com`，失敗才退到 `cloudcode-pa.googleapis.com`。
  **順序有意義**（見下方「兩台 host」）。
- 認證：`Authorization: Bearer <access_token>`，另需 `User-Agent: antigravity`
  （端點會挑 client 名稱：`agy` 或不帶 UA 都回 403）
- 請求 body 只有 `project` 一個合法欄位，且給不給都不影響回傳
- 成本：純讀，不消耗配額

回傳：

```json
{ "groups": [
    { "displayName": "Gemini Models",
      "description": "Models within this group: Gemini Flash, Gemini Pro",
      "buckets": [
        { "bucketId": "gemini-weekly", "window": "weekly",
          "resetTime": "2026-09-15T16:02:03Z", "remainingFraction": 1 },
        { "bucketId": "gemini-5h", "window": "5h",
          "resetTime": "2026-09-08T21:02:03Z", "remainingFraction": 1 }
      ] },
    { "displayName": "Claude and GPT models",
      "description": "Models within this group: Claude Opus, Claude Sonnet, GPT-OSS",
      "buckets": [
        { "bucketId": "3p-weekly",  "window": "weekly", "remainingFraction": 0.93986666 },
        { "bucketId": "3p-5h",      "window": "5h",     "remainingFraction": 0.8302704  }
      ] } ] }
```

四個 bucket 分兩池，**同池共用一組 5 小時與每週上限**：

| bucketId | 池 | 窗口 | Manapoint 的卡 |
|---|---|---|---|
| `gemini-5h`     | Gemini Models        | 5 小時 | Antigravity Gemini |
| `gemini-weekly` | Gemini Models        | 每週   | Antigravity Gemini |
| `3p-5h`         | Claude and GPT models| 5 小時 | Antigravity Claude/GPT |
| `3p-weekly`     | Claude and GPT models| 每週   | Antigravity Claude/GPT |

兩池的上限與重置時刻各自獨立（實測連 reset 秒數都不同），一張卡只有 5H 與 WEEK
兩格放不下四個數字，所以拆成兩張卡。**bucket 一律用 `bucketId` 認，不看順序**——
group 的順序不固定，實測 weekly 還排在 5h 前面。`remainingFraction` 是「剩下」的比例，
面板要顯示的已用量是 `1 - remainingFraction`。沒有該 bucket 的帳號直接略過那一格；
整池都沒有就顯示說明文字，不畫一條 0%。

### 兩台 host

`agy` 自己打的是 `daily-cloudcode-pa`，**只有那台在計 Gemini 這一池**。
`cloudcode-pa` 對 Gemini 兩格回的是佔位值：`remainingFraction` 恆為 1、
`resetTime` 每次查都重算成「現在 + 窗口長度」——那是窗口從未開始計數的樣子。
連 Claude/GPT 那池也略舊。2026-09-09 相隔數秒的實測：

| bucket | daily-cloudcode-pa | cloudcode-pa |
|---|---|---|
| `gemini-5h`     | rem=0.370169，reset 20:45:45Z（固定） | rem=1，reset = now+5h |
| `gemini-weekly` | rem=0.8950281 | rem=1，reset = now+7d |
| `3p-weekly`     | rem=0.6663967 | rem=0.6612584 |
| `3p-5h`         | rem=0，reset 20:58:51Z | rem=0，reset 20:58:51Z |

同時間 `agy` 的 `/usage` 顯示 Gemini 5h 剩 48.69%（reset 4h13m 後 = 20:45:45Z）、
3p weekly 剩 66.64%——兩個數字都只對得上 daily 那台。
`cloudcode-pa` 留著當退路，是為了 daily 哪天消失；退到它時 Gemini 會低報成 0%。

一次輪詢兩張卡只打一次網路：回應在模組內共用 30 秒（見 `antigravity.rs` 的
`SUMMARY_TTL`），遠短於 5 分鐘的輪詢週期。

注意：此端點的回應不含 email、user_id 等個資，只有上面這些 bucket 欄位。
另有 `loadCodeAssist`（回 tier，可用）／`retrieveUserQuota`／`fetchAvailableModels`
（這兩個對消費者帳號回 403），本專案不需要，未實作。

---

Claude / Codex / Grok 三家的 endpoint 出處為 MIT 授權的
[RiahStudio/riah-usage](https://github.com/RiahStudio/riah-usage)
（`collect-usage.js`、`lib/pull-claude.py`、`lib/parse-grok-billing.js`）。
Antigravity 的 endpoint 與 OAuth client 出處為 MIT 授權的
[lamchun1110/UsageDeck](https://github.com/lamchun1110/UsageDeck)
（`src-tauri/src/providers/antigravity`），憑證位置與回應形狀本專案另行實機驗證。
本專案為獨立實作，未複製其程式碼。

---

## 憑證政策

Manapoint 只讀取使用者自己機器上、由各家官方 CLI 寫下的登入狀態。

- **token 過期會自動換發。** 用各家公開的 OAuth 換發流程，只動同機同使用者、
  該 CLI 自己管理的同一個憑證檔，並處理 refresh token 輪換與並發寫入。
  目前 Claude Code、Codex、opencode xAI 三家皆已實作；
  換發失敗時保留上次數字並顯示指示。
  Antigravity 是唯一例外：它的憑證在 OS keyring 而非檔案，換發到的 token
  只留在記憶體，不寫回 keyring（理由見上）。
- **不要求 API key 或密碼。**
- **不寫出 token。** 快取檔與記錄檔都不含憑證。

因此每個人在自己的機器上只會看到自己的用量，不需要 Manapoint 端的帳號系統。
