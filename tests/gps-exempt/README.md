# 巡店定位例外測試

只連 DEV（mjpdfpxqttbhzeimmtqr）。不修改 package.json：用 `npm i --no-save vitest@4.1.12 @playwright/test@1.64.1` 暫裝工具。
測試帳號憑證預設讀 `../富康菁英業務網/.tmp-check/test-credentials.json`（可用 GPSEX_CREDENTIALS_FILE 覆寫）。

- 單元：`npx vitest run -c tests/gps-exempt/vitest.config.mts`
- integration + e2e（依序、單一 worker）：先 `npx next dev -p 3014`，再
  `GPSEX_SHOTS_DIR=<截圖資料夾> npx playwright test -c tests/gps-exempt/playwright.config.ts`
  （GPSEX_BASE_URL 可改網址；啟動時建立暫時測試角色，結束時依 id 清除測試資料並印出殘留數）
