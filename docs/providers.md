# Provider 取數對照表

六家 AI 訂閱的用量來源，共七張卡（Antigravity 的兩個額度池各一張）。
全部讀本機既有的登入憑證，不需要另外申請 API key，不需要帳號密碼。
所有 endpoint 皆為非公開介面，可能隨對方改版而失效。

## opencode Go

已驗證（2026-09-05）。

- 憑證（依序讀取，同一把 key 只算一個帳號）：
  - `~/.local/share/opencode/auth.json` → `["opencode-go"].key`（`sk-` 開頭；`opencode auth login` → OpenCode Go）
  - 同檔 `["opencode"].key`（`opencode auth login` → OpenCode，也就是 Zen／console 的 API key）。
    伺服器端與 Go 共用同一張 key 表，所以同一個 `/usage` 端點也吃這把 key；
    該 workspace 沒有 Go 訂閱時回 **403**（`EntitlementError`），面板顯示「此帳號沒有 Go 訂閱」而非錯誤
  - `~/.config/opencode/opencode-go-accounts.json`（opencode-go-multi-auth 外掛：
    `{ version: 1, accounts: [{ apiKey, label, enabled }] }`，`enabled: false` 略過）
  - `opencode.db` 的 `credential` 表（新版 opencode 把登入都存在這裡，auth.json 不再更新）
    裡 `integration_id = 'opencode'` 的列：console 登入（裝置碼 OAuth，
    `value = { type:'oauth', access, refresh, expires, metadata:{ server, accountID, email, orgID, orgName } }`）
    或服務帳號金鑰（`type:'key'`）
- console 帳號的用量不在 `/zen`（實測 2026-09-26）：
  1. `GET {server}/api/config`（`Authorization: Bearer <console access>`、`x-org-id: <orgID>`）
     回 `config.provider["opencode-go"]`：`api` = `https://opencode.ai/inference/go/openai/v1`、
     `options.headers` = `{ "x-opencode-org-id": … }`；`options.apiKey` 只是樣板
     `{env:OPENCODE_CONSOLE_TOKEN}`，也就是 console access token 本身
  2. `GET https://opencode.ai/inference/go/v1/usage`，帶同一個 token 與 `x-opencode-org-id`，
     回應形狀與 `/zen/go/v1/usage` 相同
- console token 約 30 天到期；到期前以 `POST {server}/auth/device/token`
  （`{grant_type:"refresh_token", refresh_token, client_id:"opencode-cli"}`）換發並寫回該列
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

> 所有 Anthropic 請求改走系統 `curl.exe`（URL、header、body 經 stdin 設定檔傳入，不上命令列）：
> tinyjs 後端的 fetch 一定會帶 `Origin` header，Anthropic 視為瀏覽器 CORS 請求，
> 組織設定不允許時直接回 401「CORS requests are not allowed for this Organization」，
> 加 `anthropic-dangerous-direct-browser-access` 也無效。

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

## Muse Code（Meta）

介面與回應形狀對照 [CodexBar 的 Muse provider](https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Resources/Plugins/muse.ts)（2026-10-14）；尚未以真實訂閱帳號實機驗證。
Windows 憑證位置對照 [Meta 官方 SDK issue #38](https://github.com/meta-models/muse-code-sdk/issues/38)：Muse Code 1.4.1 起恢復使用檔案儲存登入。

- 憑證：`~/.config/muse/auth.json` → `providers.meta.access_token`，必須是非空的 `dca:` 裝置登入 token（`muse login` 產生）
- 路徑：`MUSE_AUTH_PATH` 優先，其次 `$XDG_CONFIG_HOME/muse/auth.json`，預設上述位置（Windows 的 `~` 為 `%USERPROFILE%`）
- `api_key`、`META_API_KEY` 與 `LLM_`／`LLM|` 推論 key 無法查詢此訂閱用量，不代替裝置登入 token
- 請求：`POST https://api.meta.ai/muse-code/key`，JSON body 為 `{}`
- 認證：`Authorization: Bearer <dca token>`、`x-api-version: 1.0.0`、`User-Agent: Manapoint`
- 只呼叫登入／額度介面，不發模型推論請求；回應中的推論 key、email、方案名稱與付款資訊全部丟棄，不存入快取、歷史或診斷錯誤
- token 不換發、不寫回。每次輪詢重讀 CLI 登入檔；401/403 提示執行 `muse login`，保留上次成功的數字。沒有已知的裝置 token 換發介面

回應形狀（合成示例，已省略憑證與帳號欄位）：

```json
{
  "is_subs_active": true,
  "require_payment": false,
  "subs_usage": {
    "window": { "window_duration_mins": 300, "used_percent": 12.5, "resets_at": 1791946800 },
    "weekly": { "used_percent": 63, "resets_at": 1792454400 }
  }
}
```

`window` 為 5 小時池、`weekly` 為每週池；`used_percent` 是已用百分比，`resets_at` 為 Unix 秒。
百分比限制於 0–100；重置時間缺少或無效時保留百分比、不顯示倒數。
短期窗口長度必須是 300 分鐘，以免其他長度被現有面板誤標為 5H。

- `require_payment: true`：提示至 dev.meta.ai 完成付款設定
- `is_subs_active: false`：顯示沒有有效訂閱，不畫 0% bar
- 已訂閱但 `subs_usage` 缺少或為 null：顯示「此登入回應未提供用量」。2026-10-16 在真實訂閱帳號實測：回應只有訂閱狀態、方案名稱與 `api_key`，沒有 `subs_usage`；muse 1.4.7 執行檔內的欄位清單與解析結構（`SubscriptionUsageSnapshot`: window／weekly／tier）和我們一致，所以這是伺服器端沒給，不是解析錯。`dev.meta.ai` portal 端點（`/api/auth/me`、`/api/portal/teams`）對裝置 token 回 401，只認瀏覽器 cookie，本專案不走這條路。Meta 在短期窗口閒置時可能省略整份用量，即使每週已有消耗，也不能據此推算為 0%
- `subs_usage` 存在但窗口或百分比格式不符：回應格式錯誤，不合成數字

本版本讀取 Windows／Linux 的 CLI 檔案登入，不讀 macOS Keychain，也不讀瀏覽器 cookie 或自動挑選 dev.meta.ai 的 team。
尚未自訂啟用清單時預設顯示；既有使用者已設定清單時，請到設定頁勾選 Muse Code。

## Antigravity

初次實機驗證（2026-09-09）；2026-10-16 補強新版回應相容處理。
Antigravity CLI 的執行檔是 `agy`。新版相容性依上游解析器與合成 fixture 驗證，
尚未以使用者帳號的原始回應驗證。

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
- 請求：`POST /v1internal:retrieveUserQuotaSummary`，依序試 plain+CLI、`daily-`+CLI、`daily-`+hub
  （主機與客戶端字串各自的行為見下方「兩台 host」）。
- 認證：`Authorization: Bearer <access_token>`，另需 `User-Agent`；端點會挑 client 名稱
  （不帶 UA 或用 `agy` 都回 403），而且**客戶端字串決定回哪些群組**（2026-10-16 實測，`daily-` 主機）：

  | User-Agent | 群組 |
  |---|---|
  | `antigravity`、`antigravity-cli`、`antigravity-cli/1.3.6 windows/amd64` | 只有 Claude/GPT |
  | `antigravity/hub/2.9.1 windows/amd64` | Gemini ＋ Claude/GPT |
  | `antigravity/cli/1.3.6 windows/amd64` | Gemini ＋ Claude/GPT ＋ **Gemini 4 Argon**（`gemini-argon-wtu-weekly`） |

  plain 主機不論客戶端字串都只回 Gemini ＋ Claude/GPT，沒有 Argon。
  `fetchAvailableModels` 與 `retrieveUserQuota` 兩支 RPC 也沒有 Argon。
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

原本四個 bucket 分兩池，**同池共用一組 5 小時與每週上限**：

| bucketId | 池 | 窗口 | Manapoint 的卡 |
|---|---|---|---|
| `gemini-5h`     | Gemini Models        | 5 小時 | Antigravity Gemini |
| `gemini-weekly` | Gemini Models        | 每週   | Antigravity Gemini |
| `3p-5h`         | Claude and GPT models| 5 小時 | Antigravity Claude/GPT |
| `3p-weekly`     | Claude and GPT models| 每週   | Antigravity Claude/GPT |

兩池的上限與重置時刻各自獨立（實測連 reset 秒數都不同），一張卡只有 5H 與 WEEK
兩格放不下四個數字，所以拆成兩張卡。解析不看順序：舊版 `bucketId` 仍可用，
新版 ID 改名時以 `groups[].displayName`／`name` 辨識模型池，以 `window` 辨識窗口。
未提供 `window` 時才參考 bucket ID／`displayName`／`name`；支援 `5h`、
`five hour`、`5-hour`、`session`、`weekly`、`7d` 等明確窗口名稱。
明確回傳未知窗口時會報格式錯誤，不猜成 5 小時。

回應可位於根節點、`response` 或 `summary`；分組未提供可辨識模型池時，亦支援
根節點的 `buckets`。剩餘比例可位於 `remainingFraction`、
`remaining.remainingFraction` 或 protobuf oneof 的
`remaining: { case: "remainingFraction", value: 0.5 }`。
`remainingAmount` 不會當成比例；缺少比例仍是格式錯誤，不能假造 0%。
`disabled: true` 的窗口不畫 bar，只提供每週窗口的方案不會補造 5H。

`remainingFraction` 是「剩下」的比例，面板已用量是 `1 - remainingFraction`。
另一模型池已有可辨識額度、但此池未提供時才顯示「此帳號沒有這組模型的額度」。
空的 `groups` 或完全無法辨識的回應會視為暫時無法取得，保留上次數字；
不再直接斷言帳號沒有額度。相同模型池同時提供重複窗口時會報錯，避免選錯餘額。

2026-10-16 使用者提供的 agy `/usage` 畫面另有 **Gemini 4 Argon** 獨立週額度；
它與原本 Gemini 共用池放在同一張卡，以 `quotaGroup: "Argon"` 區分，不覆蓋
原本 Gemini 的週額度。一般主題以「共用／Argon」兩列顯示，共用池 5H／WEEK 並排，
Argon 的單一週額度則以整列寬度顯示；
精簡主題將 Argon 放進原本空白的第三格，維持單列。每個池的提醒、趨勢與歷史紀錄
各自獨立，設定中的每週窗口開關會同時控制兩個池的週額度。

### 兩台 host

**2026-10-16 起的取法：Gemini／Claude/GPT 取自 plain 主機，Argon 從 `daily-` 主機（CLI 客戶端字串）嫁接上去**
（`antigravity.js` 的 `withArgon`）。依據是 agy 1.3.6 `/usage` 畫面：Gemini 週額度 98.22%、
Argon 99.39%——前者等於 plain 主機的 0.98221374，而 `daily-` 現在對 Gemini 兩格回恆為 1；
後者只有 `daily-` ＋ CLI 字串的回應才有。Argon 請求失敗時卡片保留基礎讀數，不轉紅。

歷史（2026-09-09）：當時相反——`daily-` 才是 Gemini 的真值，plain 回佔位值
（`remainingFraction` 恆為 1、`resetTime` 每次重算成「現在 + 窗口長度」）：

| bucket | daily-cloudcode-pa | cloudcode-pa |
|---|---|---|
| `gemini-5h`     | rem=0.370169，reset 20:45:45Z（固定） | rem=1，reset = now+5h |
| `gemini-weekly` | rem=0.8950281 | rem=1，reset = now+7d |
| `3p-weekly`     | rem=0.6663967 | rem=0.6612584 |
| `3p-5h`         | rem=0，reset 20:58:51Z | rem=0，reset 20:58:51Z |

伺服器的行為會變，兩台 host 誰準要以 `agy` 的 `/usage` 為準對照；若日後 Gemini 又對不上，
先重跑 `scripts/diagnose-quotas.ps1` 比較兩台。

一次輪詢兩張卡只打一次網路：回應在模組內共用 30 秒（見 `antigravity.js` 的
`SUMMARY_TTL_MS`），遠短於 5 分鐘的輪詢週期。HTTP 200 仍須先通過額度解析，
空的或不相容回應會繼續嘗試備用主機，且不寫入共用快取。

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
新版 envelope、別名與 `remaining` oneof 的相容性參考
[steipete/CodexBar 的解析器](https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Providers/Antigravity/AntigravityQuotaSummaryParser.swift)
及其 [quota summary 測試](https://github.com/steipete/CodexBar/blob/main/Tests/CodexBarTests/AntigravityQuotaSummaryTests.swift)。
本專案為獨立實作，未複製其程式碼。

---

## 取數途徑與多帳號

每一家都可能有好幾條取數途徑（自家 CLI、opencode 代存的登入、多帳號外掛）。規則：

1. 找得到的途徑全部同時嘗試，依優先順序排列（自家 CLI 優先，其次 opencode，再來外掛）
2. 只要有任何一條拿到數字，其餘失敗的途徑一律忽略
3. 拿到數字的途徑若其實是同一個帳號（帳號 id／email 相同，無法辨識時看數字與重置時間是否一致），合併成一個
4. 只有全部途徑都失敗，卡片才顯示錯誤（用優先順序最高那條的原因）

| 家 | 途徑（優先順序） |
|---|---|
| opencode Go | auth.json `opencode-go`、`opencode`（Zen）；opencode.db console 登入／服務金鑰；opencode-go-multi-auth 外掛 |
| Claude Code | `~/.claude/.credentials.json`；opencode 的 `anthropic` 登入（opencode.db 或 auth.json） |
| Codex | `~/.codex/auth.json`；opencode 的 `openai` 登入（帳號 id 取自登入或 JWT） |
| Grok | opencode.db 的 `xai` 列；auth.json `xai`（舊版） |
| Muse Code | Muse CLI auth.json 的 `providers.meta.access_token`（Windows／Linux 檔案登入） |
| Antigravity | agy keyring；opencode 的 `google` 登入；opencode-antigravity-multi-auth 外掛 |

opencode 代存的 OAuth 登入換發後寫回原處（opencode.db 以交易合併該列 `value`；auth.json 只動該節點），
因為這些廠商會輪換 refresh token，不寫回會把 opencode 登出。

同一家找到兩個以上帳號時，卡片內每個帳號一組 bar，組前有小標（帳號標籤）；
精簡風格則每個帳號一列。只有一個帳號時畫面與單帳號版完全相同。

標籤：opencode Go 為 `Go`／`Zen`／console 組織名／外掛 `label`；Antigravity 為 `agy`／email；
其餘取 opencode credential 列的 label。外掛檔案：`~/.config/opencode/opencode-go-accounts.json`
（`{ accounts: [{ apiKey, label, enabled }] }`）、`%APPDATA%opencodeantigravity-accounts.json`
（`{ accounts: [{ refreshToken, email }] }`）。
外掛帳號只有 refresh token，Manapoint 每次啟動換發一次、只存在記憶體，不寫回外掛檔案。

---

## 憑證政策

Manapoint 只讀取使用者自己機器上、由各家官方 CLI 寫下的登入狀態。

- **token 過期會自動換發。** 用各家公開的 OAuth 換發流程，只動同機同使用者、
  該 CLI 自己管理的同一個憑證檔，並處理 refresh token 輪換與並發寫入。
  目前 Claude Code、Codex、opencode xAI 三家皆已實作；
  換發失敗時保留上次數字並顯示指示。
  Antigravity 的憑證在 OS keyring 而非檔案，換發到的 token
  只留在記憶體，不寫回 keyring（理由見上）。
  Muse Code 沒有已知的裝置 token 換發介面，登入失效時提示使用者執行 `muse login`。
- **不要求 API key 或密碼。**
- **不寫出 token。** 快取檔與記錄檔都不含憑證。

因此每個人在自己的機器上只會看到自己的用量，不需要 Manapoint 端的帳號系統。
