# 富康公司 Google 日曆同步設定

系統以年度行事曆為唯一編輯來源，單向同步公司行事及已發布的政府假日到指定的公司 Google 日曆。個人行程不會同步；Google 端的修改不會回寫系統。

## 1. 套用資料庫 migration

在正式資料庫確認基礎 migration `20261008100000_organization_annual_calendar.sql` 已執行。若尚未執行，先執行該檔，再執行 `20261010120000_organization_calendar_google_sync.sql`。不要重複執行已套用的基礎 migration。

## 2. 建立 OAuth 用戶端

在 Google Cloud 的 OAuth 用戶端建立「Web application」。將正式站台回呼網址填入「已授權的重新導向 URI」：

```text
https://<正式站台網域>/api/organization/calendar/google/callback
```

本機測試時可另外加入 `http://localhost:3000/api/organization/calendar/google/callback`，並在本機環境使用相同網址。OAuth「資料存取權」需允許 `https://www.googleapis.com/auth/calendar.events.owned`，並保留 `openid`、`email` 基本身分範圍。測試期間，需把實際執行連結操作的 Google 帳號加為測試使用者。

此 Calendar scope 可管理該 Google 帳號擁有的日曆事件；應使用專門持有公司日曆的帳號。程式只呼叫環境變數指定的日曆，不列出或讀取其他日曆。

## 3. 設定正式站台環境變數

從 Google OAuth 用戶端取得 Client ID 與 Client Secret；從「富康公司行事曆」整合設定取得 Calendar ID。於正式站台環境設定以下變數，切勿將 Client Secret、加密金鑰或 refresh token 放入程式碼、瀏覽器設定或聊天訊息：

```text
GOOGLE_CALENDAR_CLIENT_ID=<OAuth Client ID>
GOOGLE_CALENDAR_CLIENT_SECRET=<OAuth Client Secret>
GOOGLE_CALENDAR_REDIRECT_URI=https://<正式站台網域>/api/organization/calendar/google/callback
GOOGLE_CALENDAR_ID=<富康公司行事曆的 Calendar ID>
GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY=<64 位十六進位字串>
```

在 PowerShell 產生 32-byte 加密金鑰：

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

將結果直接設為 `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY`，不要傳給他人。設定正式環境變數後重新部署；本機開發則將各環境值放在未提交的 `.env.local`。

## 4. 授予系統同步管理權限

在系統權限管理中，僅授予指定管理者 `組織管理 → 年度行事曆 → 管理 Google 行事曆同步`（`organization.calendar.google.manage`）。一般同仁不需要此權限。

## 5. 首次連結與驗證

登入正式系統並進入「組織管理 → 年度行事曆」，按「連結 Google」，選擇持有公司日曆的 Google 帳號並同意授權。完成後系統會補同步既有有效公司行事與已發布的政府假日。檢查 Google 公司日曆中的日期、台灣時間、地點及取消行事，再新增一筆測試行事、修改後確認同一筆 Google 事件更新，最後取消測試行事確認 Google 端移除。

測試使用者模式的 refresh token 可能在七天後失效。若要長期自動同步，需按 Google OAuth 同意畫面規範將應用程式轉為正式使用，並完成 Google 要求的驗證；未完成前，需預期重新授權。
