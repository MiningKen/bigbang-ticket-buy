# Ticket Plus 瀏覽器輔助工具

這個工具使用專用 Chrome profile 保存登入狀態，透過活動頁本身使用的輕量公開狀態 API 監看指定場次；只有狀態變成可售時才重新整理完整頁面並立刻點入。它不會繞過 CAPTCHA、排隊、網站限制，也不會填寫實名或付款資料。

## 圖形控制面板（建議）

```bash
npm run app
```

程式會開啟一個本機控制面板，可設定場次、票數、票價優先順序、連號策略與是否自動進入下一步。面板也會顯示 Ticket Plus 登入狀態、即時票況、監看階段與操作紀錄。服務只監聽 `127.0.0.1`，不會開放給區域網路。

### Windows 一鍵可攜版

一般使用者不需要安裝 Node.js、npm 或 Playwright：

1. 取得 `ticketplus-assistant-windows-x64.zip`。
2. 完整解壓縮。
3. 雙擊 `START-WINDOWS.cmd`。

可攜版會內含官方 Windows Node.js 執行環境與所有程式依賴，並自動尋找 Google Chrome；未安裝 Chrome時會嘗試 Microsoft Edge。詳細步驟請見 `WINDOWS-README.txt`。

維護者可在 macOS/Linux 執行以下命令產生 Windows x64 可攜版：

```bash
npm run package:windows
```

輸出位於 `dist/`，並附有 SHA-256 校驗檔。

## 安裝

```bash
npm install
cp .env.example .env
```

編輯 `.env`：

- `TARGET_DATE`：目標日期，目前預設為 `2026-10-09`
- `TICKET_COUNT`：張數，限 1–4 張
- `INTERNAL_EVENT_ID`、`INTERNAL_SESSION_ID`：目前已設定為 10/9 場次的公開狀態識別碼
- `PREFERRED_PRICES`：由優先到次要，以逗號分隔，例如 `6800,5800,4800`
- `SEATING_MODE=adjacent-only`：一定要連號，配位失敗就停止
- `SEATING_MODE=adjacent-preferred`：先嘗試連號，失敗後接受不連號再試一次
- `SEATING_MODE=any`：第一次配位就允許不連號，速度優先
- `ACCEPT_TERMS=true`：僅在你已閱讀且接受活動與會員條款後設定
- `AUTO_ADVANCE=true`：選到偏好票價後自動按「下一步」；只有同時設定 `ACCEPT_TERMS=true` 才生效

控制面板提供三種監看速度：快速 5–8 秒、標準 10–15 秒、保守 15–25 秒。熱門票預設使用快速模式。這只讀取輕量狀態 API，完整頁面不會反覆重載；網站若回應 403/429，程式會自動停止。

發現票券或需要人工處理時，控制面板會顯示全畫面提示、播放三聲警示音、嘗試發送系統通知，並把購票 Chrome 視窗帶到前景。驗證碼、實名資料與付款仍由本人完成。

## 第一次登入

```bash
npm run login
```

在新開啟的 Chrome 完成登入，然後關閉該瀏覽器。

## 選擇場次日期

使用互動選單選擇日期、1–4 張票、連號策略，以及是否在你確認接受條款後自動進入下一步。設定會保存到 `.env`：

```bash
npm run configure
```

也可以在單次啟動時指定日期，不改動 `.env`：

```bash
npm run watch -- --date=2026-10-10
```

支援 `2026-10-09`、`2026-10-10`、`2026-10-11`；程式會自動套用該日期正確的狀態 API 場次 ID。

## 開始監看

```bash
npm run watch
```

請保持終端機聲音開啟。發現票券、排隊或驗證畫面時會響鈴，瀏覽器會保持開啟供你接手。

程式不保證買到票；Ticket Plus 改版時也可能需要更新頁面選擇器。付款、驗證碼與實名資料都必須由本人完成。
