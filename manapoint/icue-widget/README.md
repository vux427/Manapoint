# Manapoint iCUE widget：在鍵盤 / Dashboard / 水冷 LCD 上顯示用量

這個 widget 輪詢 Manapoint 本機端點（`GET http://127.0.0.1:47901/v1/usage`），
把每家訂閱的用量窗口畫成小進度條。需要 Manapoint 0.4.0 以上**正在執行**、
iCUE 5.47 以上，以及一台有 LCD 的 Corsair 設備
（鍵盤 `keyboard_lcd` 如 VANGUARD 96 / VANGUARD PRO 96，也支援 `dashboard_lcd`、`pump_lcd`）。

## 打包與安裝

```sh
npm install -g icuewidget-cli
cd manapoint/icue-widget
icuewidget package .
```

1. 開 iCUE → widgets 區 → 按 **+** → 選產生的 `.icuewidget` 檔。
2. 把 widget 放到你的 LCD 上。
3. 設定裡可改端點 URL（預設 `http://127.0.0.1:47901/v1/usage`）與更新間隔（15–300 秒，預設 60 秒）。

## 驗證端點

Manapoint 執行中時，瀏覽器或終端機開：

```powershell
Invoke-RestMethod http://127.0.0.1:47901/v1/usage | ConvertTo-Json -Depth 5
```

## 疑難排解

- LCD 顯示 offline：先確認 Manapoint 新版有在跑，再確認上面的 URL 打得開。
- Port 被佔用：設環境變數 `MANAPOINT_LOCAL_API_PORT` 換 port，widget 設定裡的端點 URL 跟著改。
- 不想開這個端點：設 `MANAPOINT_LOCAL_API=0`（端點只綁 loopback，本來就只聽本機）。
- 端點是唯讀的，只吐百分比與重置時間，沒有任何憑證。

## 檔案

```
icue-widget/
  manifest.json      widget 詮釋資料（id: com.manapoint.usage）
  index.html         版面骨架（CSS/JS 拆外部檔，head 保持 XML-well-formed）
  styles/main.css    版面樣式
  scripts/main.js    輪詢與繪製邏輯
  translation.json   英文 / 繁中字串
  resources/icon.svg widget 圖示
```
