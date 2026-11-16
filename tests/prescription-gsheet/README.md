# 處方箋 Google Sheet 匯入測試

只連 DEV（mjpdfpxqttbhzeimmtqr），只用 VW/ZT 測試門市與保留年份 2038，結束依門市清除自己建的資料。不修改 package.json：`npm i --no-save vitest@4.1.12 @playwright/test@1.64.1`。

- 單元（純函式，用程式產生 xlsx）：`npx vitest run -c tests/prescription-gsheet/vitest.config.mts`
- API + 畫面 e2e（單一 worker 依序）：先 `npx next dev -p 3014`，再
  `RXGS_SHOTS_DIR=<截圖資料夾> npx playwright test -c tests/prescription-gsheet/playwright.config.ts`
- 套用到 DEV：`node scripts/apply-prescription-store-aliases-dev.cjs`（`--rollback` 復原）
- 正式區：`docs/prescription-gsheet-import-prod.sql`（復原 `docs/prescription-gsheet-import-prod-rollback.sql`）
