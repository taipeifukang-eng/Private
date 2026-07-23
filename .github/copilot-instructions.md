# Copilot Repository Instructions

請所有回報使用繁體中文。回報要清楚標示已完成、未完成、測試結果與風險，不要宣稱未實際驗證的項目已通過。

## 安全與環境

- 目前 DEV Supabase Project Ref 為 `mjpd...mtqr`。
- Production 候選 Project Ref 為 `odvksgucvfoaqrumpran`。
- 不得連 Production，不得對 `odvksgucvfoaqrumpran` 執行任何 DB 操作。
- 每次遠端 DB 操作前必須先執行：

```powershell
node scripts/verify-dev-supabase-environment.js
node scripts/verify-dev-supabase-cli-environment.js
npx supabase migration list
```

- Guard 必須都 passed，且 App / CLI Project Ref 必須都是 DEV `mjpd...mtqr`。
- `NODE_ENV` 不得為 `production`。
- `ALLOW_DEV_DATABASE_OPERATIONS=true`。
- `ALLOW_SUPABASE_CLI_REMOTE_OPERATIONS=true`。
- 若 Supabase CLI 需要 DB password，只能由使用者在 Terminal 隱藏輸入，或用 PowerShell `SecureString` 暫時設定 `SUPABASE_DB_PASSWORD`；完成後必須清除。
- 不得把 password、JWT、access token、refresh token、anon key、service role key、DB password、connection string 寫入檔案、Git、console 或對話。

## Migration 規則

- 目前已套用且 local / remote aligned 的 migrations：
  - `20260722030244`
  - `20260722032048`
  - `20260722055852`
  - `20260722065952`
  - `20260722091526`
  - `20260722092849`
  - `20260722094917`
- 不得修改已套用 migration。
- DB 問題只能建立新的 forward migration。
- 不得自行執行 `migration repair`、`db reset`、rollback 或手動修改 remote migration history。
- `db push` 前必須先執行 `npx supabase db push --dry-run`。
- dry-run 必須只列出本輪批准的 migration；若列出 baseline、舊 task、test SQL、rollback、seed 或未知 migration，立即停止。
- 不得把 test SQL、rollback SQL 或 DEV seed 放進 `supabase/migrations/`。

## RBAC 與權限

- 使用既有 RBAC schema，不建立第二套：
  - `roles`
  - `permissions`
  - `role_permissions`
  - `user_roles`
  - `profiles`
  - `store_managers`
- `profiles.role` 只保留為舊程式相容與顯示用途，不得作為新功能唯一權限來源。
- 新功能正式權限來源是 `user_roles`、`role_permissions`、`permissions`。
- DEV 測試區的 RBAC 管理流程必須照正式區邏輯：使用者先註冊，再由系統管理員編輯 `profiles` 基本資料與員編，角色管理新增/編輯角色與 permission codes，最後用員編指派 `user_roles`。
- `store_employees` 可作為正式區相容資料來源，但 DEV baseline 可能不存在；不得因 optional table 缺少而阻斷以 `profiles.employee_code` 指派角色。
- 可保留既有 admin compatibility bypass，但 UI 必須明確標示它是 compatibility source，不可偽裝成 role_permissions。
- API、Server Action、RPC 與 RLS 都必須有 server-side permission guard。
- 使用者刪除流程不得只刪 `profiles`；若刪除 App 使用者，必須由 server-side 權限檢查通過後同步處理 Supabase Auth user，並清理 `user_roles` / scope 關聯。
- 若 `profiles` 已被盤點改善、工單、庫存或其他歷史業務資料 FK 引用，不得硬刪或修改歷史資料來完成刪除；應保留 profile、撤除角色與 scope，並停用 Supabase Auth 登入。
- 若 Supabase Auth Admin API 刪除使用者只回傳籠統的 `Database error deleting user`，不得直接把原始錯誤丟給使用者；應視為可能受歷史 FK 阻擋並走保留 profile + 停用登入 fallback。
- 前端隱藏按鈕或選單只改善 UX，不等於安全控制。
- 不得使用 service role 代替 authenticated user 驗證 RLS / RPC。
- service role 只能用於 server-only、已通過權限檢查後的管理查詢或受控 seed，不得在 client component 中引用。
- 導覽與入口顯示必須依 effective permissions 與已完成模組狀態判斷，不得依帳號名稱或角色名稱猜測。

## 模組 Availability 與錯誤安全

- 尚未建置資料表、RPC、API 或 UI 的模組，不得顯示可操作入口。
- 未建置模組若需要保留直接 route，應顯示安全 availability 頁面，例如「此功能尚未在目前測試環境開放」。
- 不得把 Supabase schema cache、PostgreSQL 原始錯誤、table name、SQL、stack trace 或 migration file name 直接顯示給一般使用者。
- API 或 UI 遇到未建置模組時，應轉成一致且安全的使用者訊息；server log 可保留非敏感診斷，但不得輸出 key、token、password 或 connection string。
- 前端隱藏未開放入口只改善 UX；頁面、API、RPC 與 RLS 仍必須保留 server-side security。

## 開發流程

- 接手前先讀 `docs/DEV-RBAC-HANDOFF.md`。
- 每個 DEV 開發小任務完成後，必須同步維護交接文件：
  - `docs/DEV-RBAC-HANDOFF.md` 保留重要歷史並追加任務完成狀態、修改檔案、API / UI / DB 影響、測試與 build 結果、發現問題、尚未完成事項、下一個最小任務、禁止事項與 migration 狀態。
  - `docs/CURRENT-DEV-STATUS.md` 覆寫為短版最新狀態，只保留目前階段、最新已完成項目、阻擋、下一個最小任務、migration local / remote 狀態、最近 guard / tsc / build / dynamic test 結果與禁止操作。
  - `.github/copilot-instructions.md` 只在出現新的永久開發規則時更新，不大量寫入一次性測試輸出、暫時錯誤、單一帳號驗收結果或短期任務進度。
- 不得自行開始下一個 Task。每個階段完成後停止並回報，等待使用者確認。
- 修改前先理解現有檔案與樣式，不建立第二套導覽、第二套 RBAC 或重複 API 模式。
- 對既有 dirty working tree，要只修改本輪需要的檔案，不 revert 使用者或其他代理的變更。
- 不要修改 Production 設定。
- 不要直接改 remote schema。

## 測試要求

所有修改至少需依變更範圍執行：

```powershell
node --check <對應腳本>
npx tsc --noEmit --pretty false
npm run build
```

若是 DEV 動態測試腳本：

- 密碼只能在 Terminal 隱藏輸入。
- 不得輸出 JWT、refresh token、cookie、key 或 password。
- 輸出只保留角色、測試案例、HTTP status、PASS / FAIL 與非敏感錯誤摘要。

Build 注意事項：

- 專案目前可能有既有 `DYNAMIC_SERVER_USAGE` 訊息。
- 必須區分 build warning 與真正 failure。
- 只有 exit code 0 才可回報 build 通過。

## 目前建議下一步

目前下一個最小任務是驗收並完成「使用者 RBAC 唯讀詳細檢視」：

- 使用者列表顯示 active roles。
- 顯示 effective permission count。
- 查看角色與權限詳細資料。
- 顯示 permission codes。
- 顯示權限來源角色。
- 顯示 store manager scope。
- 只讀。
- 不修改角色。
- 不新增使用者。
- 不改 migration。

相關檔案：

- `app/api/admin/users/[id]/rbac/route.ts`
- `lib/admin/user-rbac-view.ts`
- `components/admin/UserManagementTable.tsx`
- `scripts/test-rbac-user-permissions-view-dev.js`

完成後必須回報：

- 修改檔案。
- API path。
- permission guard。
- 四個 DEV 帳號的 roles。
- 四個 DEV 帳號的 effective permission codes。
- store scope。
- dynamic test。
- TypeScript 結果。
- build 結果。
- 人工 UI 驗收結果。

完成後停止，不自行接續下一階段。
