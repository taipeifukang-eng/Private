# DEV RBAC / General Affairs Handoff

本文件供後續 AI 開發代理接手使用。請先讀完本文件與 `.github/copilot-instructions.md`，再進行任何實作或資料庫操作。

## 1. 專案環境

- 專案名稱：富康菁英業務網
- 技術架構：
  - Next.js 14 App Router
  - TypeScript
  - React Client / Server Components
  - Supabase Auth、Postgres、RLS、RPC
  - Supabase CLI migrations
  - Tailwind CSS / lucide-react
- 目前 DEV Supabase Project Ref：`mjpd...mtqr`
- Production 候選 Project Ref：`odvksgucvfoaqrumpran`
- 任何遠端 DB 操作前都必須確認沒有命中 Production 候選 Project Ref。

### Guards

每次遠端 DB 操作前都必須先跑：

```powershell
node scripts/verify-dev-supabase-environment.js
node scripts/verify-dev-supabase-cli-environment.js
npx supabase migration list
```

通過條件：

- App Guard 顯示 `Environment guard passed`
- CLI Guard 顯示 `Supabase CLI environment guard passed`
- URL Project Ref 與 CLI Project Ref 都是 DEV：`mjpd...mtqr`
- Project Ref 不得等於 `odvksgucvfoaqrumpran`
- `ALLOW_DEV_DATABASE_OPERATIONS=true`
- `ALLOW_SUPABASE_CLI_REMOTE_OPERATIONS=true`
- `NODE_ENV` 不得為 `production`

### 必要環境變數

本機 DEV 應由 `.env.development.local` 或 Next.js development 載入順序提供：

```env
NEXT_PUBLIC_SUPABASE_URL=https://<DEV_PROJECT_REF>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<DEV_ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<DEV_SERVICE_ROLE_KEY>
EXPECTED_SUPABASE_PROJECT_REF=<DEV_PROJECT_REF>
ALLOW_DEV_DATABASE_OPERATIONS=true
ALLOW_SUPABASE_CLI_REMOTE_OPERATIONS=true
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

不得把真實 key、JWT、DB password、connection string 寫進 Git、文件或對話。

### SUPABASE_DB_PASSWORD 使用方式

如果 Supabase CLI 需要 DEV DB password，只能在本機 Terminal 隱藏輸入，或用 PowerShell `SecureString` 暫時設定 `SUPABASE_DB_PASSWORD`。完成後必須清除：

```powershell
$ErrorActionPreference = 'Stop'
$secure = Read-Host 'Enter DEV Supabase DB password' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $env:SUPABASE_DB_PASSWORD = $plain

  node scripts/verify-dev-supabase-environment.js
  node scripts/verify-dev-supabase-cli-environment.js
  npx supabase migration list
  npx supabase db push --dry-run
  # Only after explicit approval:
  # npx supabase db push
}
finally {
  Remove-Item Env:\SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue
  if ($bstr -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
  Write-Host ('SUPABASE_DB_PASSWORD cleared: ' + (-not (Test-Path Env:\SUPABASE_DB_PASSWORD)))
}
```

密碼不得出現在命令列參數、`.env`、console output、Git 或對話中。

## 2. Migration 狀態

目前 `supabase/migrations/` 已由 DEV schema baseline 導入並對齊 remote history。以下 migration 已套用 DEV，且 local / remote aligned：

| Timestamp | File | 狀態 |
| --- | --- | --- |
| `20260722030244` | `20260722030244_dev_schema_baseline.sql` | 已套用 DEV |
| `20260722032048` | `20260722032048_general_affairs_inventory_locations.sql` | 已套用 DEV |
| `20260722055852` | `20260722055852_fix_inventory_location_cascade_deletion_reason.sql` | 已套用 DEV |
| `20260722065952` | `20260722065952_general_affairs_inventory_transactions_foundation.sql` | 已套用 DEV |
| `20260722091526` | `20260722091526_revoke_inventory_transaction_sequence_grants.sql` | 已套用 DEV |
| `20260722092849` | `20260722092849_restrict_inventory_transaction_function_execute_grants.sql` | 已套用 DEV |
| `20260722094917` | `20260722094917_fix_inventory_balance_upsert_conflict_ambiguity.sql` | 已套用 DEV |

重要規則：

- 不得修改任何已套用 migration。
- 發現 DB 問題只能建立新的 forward fix migration。
- 不得自行執行 `migration repair`、`db reset`、rollback 或手動修改 migration history。
- `db push` 前必須先 `db push --dry-run`，且 dry-run 只能列出本輪批准的 migration。
- 不得把 test SQL、rollback SQL、DEV seed 放進標準 migrations。

## 3. Task 1C-1 狀態：庫存位置與位置料件設定

Task 1C-1 已正式 Completed。

完成內容：

- `ga_inventory_locations`
- `ga_inventory_location_parts`
- 權限：
  - `general_affairs.inventory_location.view`
  - `general_affairs.inventory_location.manage`
- RLS：
  - manage/view 依權限讀取
  - store manager 只能讀自己門市 STORE location 與其 location parts
  - 不建立 DELETE policy
- API：
  - `/api/general-affairs/inventory/locations`
  - `/api/general-affairs/inventory/locations/[id]`
  - `/api/general-affairs/inventory/locations/[id]/parts`
  - `/api/general-affairs/inventory/locations/[id]/parts/[locationPartId]`
- UI：
  - `/general-affairs/inventory/locations`
- 測試狀態：
  - DB constraints 通過
  - Trigger 通過
  - system fields 防偽通過
  - RLS/API 動態驗收通過
  - soft delete cascade forward fix 已套用並通過
  - UI 人工驗收完成
  - `npx tsc --noEmit --pretty false` 通過
  - `npm run build` 通過

重要檔案：

- `supabase/migration_general_affairs_inventory_locations.sql`
- `supabase/test_general_affairs_inventory_locations.sql`
- `supabase/rollback_general_affairs_inventory_locations.sql`
- `supabase/migrations/20260722032048_general_affairs_inventory_locations.sql`
- `supabase/migrations/20260722055852_fix_inventory_location_cascade_deletion_reason.sql`
- `scripts/test-general-affairs-inventory-locations.js`
- `scripts/test-general-affairs-inventory-locations-dev.js`
- `app/api/general-affairs/inventory/locations/`
- `app/general-affairs/inventory/locations/`
- `lib/general-affairs/inventory/`
- `components/general-affairs/`

已知技術債：

- `npm run build` 會出現既有 `DYNAMIC_SERVER_USAGE` 訊息，需要區分 warning 與真正 build failure。
- `npm audit` vulnerabilities 尚未在此階段處理。
- 舊 DEV 測試資料 `DEV-1C-1-SCRIPT-STORE` 待人工透過既有 soft delete 流程清理，不得硬刪。

## 4. Task 1C-2B 狀態：庫存流水與庫存餘額 DB Core

目前正式標記：

**Task 1C-2B DB Core Verified**

完成內容：

- `ga_inventory_balances`
- `ga_inventory_transactions`
- `ga_inventory_transaction_no_seq`
- `ga_next_inventory_transaction_no()`
- `ga_post_inventory_transaction(...)`
- append-only trigger function
- idempotency key partial unique index
- balance `location_id + part_id` unique constraint
- RLS：兩表只有 SELECT policy，client 不能直接 INSERT / UPDATE / DELETE
- grants：
  - sequence 不授權 PUBLIC / anon / authenticated direct usage
  - transaction number helper 不授權 PUBLIC / anon / authenticated EXECUTE
  - posting RPC 只授權 authenticated EXECUTE
- RPC 核心邏輯：
  - `auth.uid()`
  - `general_affairs.inventory_transaction.manage`
  - `general_affairs.part.view` / `general_affairs.part.manage`
  - advisory lock
  - `SELECT ... FOR UPDATE`
  - idempotency replay / conflict
  - negative stock validation
  - base / purchase unit conversion
  - transaction insert
  - balance update

### 測試覆蓋

已完成並通過：

- DB schema / constraints / indexes
- RLS catalog
- grants catalog
- append-only
- idempotency
- unit conversion
- negative stock
- direct write rejection
- concurrency
- DB Test SQL Coverage
- Dynamic Verification A
- Dynamic Verification B

重要檔案：

- `supabase/migration_general_affairs_inventory_transactions_foundation.sql`
- `supabase/test_general_affairs_inventory_transactions_foundation.sql`
- `supabase/verify_general_affairs_inventory_transactions_catalog.sql`
- `supabase/rollback_general_affairs_inventory_transactions_foundation.sql`
- `supabase/migrations/20260722065952_general_affairs_inventory_transactions_foundation.sql`
- `scripts/test-general-affairs-inventory-transactions-foundation.js`
- `scripts/test-general-affairs-inventory-transactions-dev.js`
- `scripts/test-general-affairs-inventory-transactions-api-dev.js`

### Forward fixes

1. `20260722091526_revoke_inventory_transaction_sequence_grants.sql`
   - 原因：`public.ga_inventory_transaction_no_seq` 曾有 anon/authenticated direct USAGE grant。
   - 結果：PUBLIC / anon / authenticated 無 sequence USAGE，transaction no 只能由 helper/RPC 受控產生。

2. `20260722092849_restrict_inventory_transaction_function_execute_grants.sql`
   - 原因：helper / RPC EXECUTE grants 需要收斂。
   - 結果：
     - `ga_next_inventory_transaction_no()` 無 PUBLIC / anon / authenticated EXECUTE。
     - `ga_post_inventory_transaction(...)` 無 PUBLIC / anon EXECUTE，authenticated 有 EXECUTE。

3. `20260722094917_fix_inventory_balance_upsert_conflict_ambiguity.sql`
   - 原因：RPC balance UPSERT 使用 `ON CONFLICT (location_id, part_id)` 造成 ambiguity。
   - 結果：已改為 `ON CONFLICT ON CONSTRAINT ga_inventory_balances_location_part_unique DO NOTHING`。

## 5. Task 1C-2C 狀態：庫存管理 API / UI

已建立：

- API routes：
  - `/api/general-affairs/inventory/balances`
  - `/api/general-affairs/inventory/transactions`
  - `/api/general-affairs/inventory/transactions/post`
  - `/api/general-affairs/inventory/options`
- UI route：
  - `/general-affairs/inventory`
- 導覽入口：
  - 上方導覽已補「總務服務中心 / 庫存管理」入口。
  - 顯示條件依 inventory balance / transaction 權限與 store manager scope。
  - no_access 不應顯示入口；直接輸入 URL 仍由頁面/API/RLS 擋。
- 權限補充：
  - `inventory_transaction.manage` 但缺 `part.view/manage` 時，頁面需顯示明確缺少 `general_affairs.part.view` 提示。
  - 不得用 service role 繞過 `ga_parts` RLS 取得料件目錄。

驗收狀態：

- API dynamic tests 已完成並通過。
- `npx tsc --noEmit --pretty false` 已通過。
- `npm run build` 已通過。
- 總務導覽收斂完成。
- 未建置模組 availability guard 完成。
- 人工 UI 複驗已完成並通過。
- 入庫 / 出庫 / 調增 / 調減人工複驗通過。
- 不再出現 schema cache 原始錯誤。
- 不再出現 maintenance migration 原始錯誤。

是否可標記 Completed：

- **Task 1C-2C Completed。**
- 不得自行開始 Task 1C-3。

## 6. DEV RBAC 正式化狀態

盤點結論：

- DEV 與正式區共用同一套 RBAC schema。
- 核心資料表：
  - `profiles`
  - `roles`
  - `permissions`
  - `role_permissions`
  - `user_roles`
  - `store_managers`
- 相關 RPC / function：
  - `has_permission(user_id, permission_code)`
  - `current_user_has_permission(permission_code)`
  - `get_user_permissions(user_id)`：只允許目前 `auth.uid()` 查自己，不可拿來讓一般 authenticated user 查別人。
- `profiles.role` 仍保留作舊程式相容與顯示用途，新功能不得只靠它授權。
- 正式 RBAC 來源是 `roles`、`permissions`、`role_permissions`、`user_roles`。

重要檔案：

- 角色管理頁：
  - `app/admin/roles/page.tsx`
  - `app/admin/roles/RoleListClient.tsx`
  - `app/admin/roles/[id]/page.tsx`
  - `app/admin/roles/[id]/RoleEditClient.tsx`
- 使用者管理頁：
  - `app/admin/users/page.tsx`
  - `components/admin/UserManagementTable.tsx`
- Navbar / permission config：
  - `components/Navbar.tsx`
  - `hooks/useNavbarPermissions.ts`
  - `lib/permissions/check.ts`
  - `lib/permissions/rbac-management.ts`
- 角色 API：
  - `app/api/roles/route.ts`
  - `app/api/roles/[id]/route.ts`
  - `app/api/roles/[id]/permissions/route.ts`
  - `app/api/roles/[id]/users/route.ts`
  - `app/api/roles/[id]/users/[userId]/route.ts`
- 使用者 RBAC read-only API：
  - `app/api/admin/users/[id]/rbac/route.ts`
- 使用者 RBAC 彙整 helper：
  - `lib/admin/user-rbac-view.ts`

目前階段：

- 第一階段盤點完成。
- DEV Full Admin 已透過 `profiles.role=admin` 與 active `admin` RBAC role 取得管理介面入口。
- 完整 RBAC 管理正式化尚未全部完成；目前已補上「使用者角色與有效權限唯讀詳細檢視」的程式碼，但仍需人工 UI 驗收與 DEV dynamic script 實跑確認。
- 這次補強不是新增使用者功能、不是角色 CRUD 重寫、不是 migration。

四個人工驗收帳號：

- `dev-ga-access@example.test`
- `dev-ga-manage@example.test`
- `dev-ga-view@example.test`
- `dev-no-ga@example.test`

接手時應確認：

- 使用者管理列表看得到上述四個 DEV 帳號。
- 列表能看到 active RBAC roles、effective permission count、store scope count。
- 點「查看角色與權限」能看到 permission codes、來源角色與 store manager scope。
- DEV 測試帳號 badge 只作顯示，不作授權依據。
- Admin compatibility bypass 顯示為 compatibility source，不可偽裝成 role_permissions 來源。

## 7. 已完成測試腳本與 SQL

### Guards

- `scripts/verify-dev-supabase-environment.js`
  - 用途：確認 App env 指向 DEV，拒絕 Production 候選。
  - 執行：`node scripts/verify-dev-supabase-environment.js`
- `scripts/verify-dev-supabase-cli-environment.js`
  - 用途：確認 Supabase CLI link 與 App env 都指向 DEV。
  - 執行：`node scripts/verify-dev-supabase-cli-environment.js`

### Task 1A / 1B

- `scripts/test-general-affairs-categories.js`
  - 用途：分類基礎靜態/API 測試。
- `scripts/test-task1a-rls.js`
  - 用途：Task 1A RLS direct tests。
- `scripts/test-task1a-category-api.js`
  - 用途：Task 1A category API tests。
- `scripts/test-general-affairs-equipment-master.js`
  - 用途：設備範本與設備主檔靜態測試。
- `scripts/test-general-affairs-facility-master.js`
  - 用途：設施主檔靜態測試。
- `scripts/test-general-affairs-part-master.js`
  - 用途：料件主檔與相容性靜態測試。

### Task 1C-1

- `scripts/test-general-affairs-inventory-locations.js`
  - 用途：庫存位置與位置料件設定靜態測試。
  - 執行：`node scripts/test-general-affairs-inventory-locations.js`
- `scripts/test-general-affairs-inventory-locations-dev.js`
  - 用途：DEV RLS / API dynamic tests。
  - 執行前需 dev server ready：`npm run dev -- -p 3002`
  - 執行：`node scripts/test-general-affairs-inventory-locations-dev.js`
  - 密碼只能在 Terminal 隱藏輸入。
- `supabase/test_general_affairs_inventory_locations.sql`
  - 用途：DB constraints / trigger / RLS catalog 驗收。

### Task 1C-2B / 1C-2C

- `supabase/verify_general_affairs_inventory_transactions_catalog.sql`
  - 用途：唯讀 catalog 驗收 sequence grants、function grants、RLS、policies、append-only trigger。
- `supabase/test_general_affairs_inventory_transactions_foundation.sql`
  - 用途：DB test SQL coverage，涵蓋 schema/security、基本交易、單位換算、負庫存、idempotency、append-only、validation。
- `scripts/test-general-affairs-inventory-transactions-foundation.js`
  - 用途：inventory transaction foundation 靜態測試。
  - 執行：`node scripts/test-general-affairs-inventory-transactions-foundation.js`
- `scripts/test-general-affairs-inventory-transactions-dev.js`
  - 用途：DEV dynamic DB/RLS/RPC 驗收。
- `scripts/test-general-affairs-inventory-transactions-api-dev.js`
  - 用途：庫存交易 API dynamic tests。

### RBAC

- `scripts/test-rbac-navbar-permissions-dev.js`
  - 用途：RBAC Navbar / role page / API guard DEV 動態測試。
  - 需要 hidden password，不得輸出 token。
- `scripts/test-rbac-user-permissions-view-dev.js`
  - 用途：使用者 RBAC read-only detail API 驗收。
  - 執行前需 dev server ready：`npm run dev -- -p 3002`
  - 執行：`node scripts/test-rbac-user-permissions-view-dev.js`
  - 需要在 Terminal 隱藏輸入 `dev-full-admin@example.test` 與 `dev-no-ga@example.test` 密碼。
  - 尚需接手者實際跑一次並回報結果。

通用檢查：

```powershell
node --check <script>
npx tsc --noEmit --pretty false
npm run build
```

## 8. 禁止事項

- 不連 Production。
- 不命中 Project Ref `odvksgucvfoaqrumpran`。
- 不修改已套用 migrations。
- 不直接改 remote schema。
- 不使用 `migration repair`、`db reset`、rollback 或手動修改 migration history，除非使用者在新回合明確批准。
- 不使用 service role 代替 authenticated user 驗證 RLS / RPC。
- 不輸出 password、JWT、access token、refresh token、service role key、anon key、DB password、connection string。
- 不建立第二套 RBAC。
- 不用 `profiles.role` 取代 `user_roles` / `role_permissions` / `permissions` 新架構。
- 不刪除 DEV temporary roles。
- 不自行開始下一個 Task。
- 不因前端隱藏選單就視為完成安全控制；API / Server Action / RLS 必須各自防守。

## 9. 下一個最小任務

任務名稱：

**新增使用者 RBAC 唯讀詳細檢視**

目前程式碼已建立初版，接手者應先驗收，再視結果修正。任務範圍：

- 使用者列表顯示 active roles。
- 使用者列表顯示 effective permission count。
- 使用者列表顯示 store manager scope count。
- 新增或確認「查看角色與權限」詳細資料。
- 詳細資料顯示 permission code。
- 詳細資料顯示權限來源角色。
- 詳細資料顯示 store manager scope。
- 只讀。
- 不修改角色。
- 不新增使用者。
- 不改 migration。
- 不改 DB schema / RLS。

目前相關新增檔案：

- `lib/admin/user-rbac-view.ts`
- `app/api/admin/users/[id]/rbac/route.ts`
- `scripts/test-rbac-user-permissions-view-dev.js`

目前相關修改檔案：

- `app/auth/actions.ts`
- `components/admin/UserManagementTable.tsx`

## 10. 完成判定

下一位代理完成「新增使用者 RBAC 唯讀詳細檢視」後，必須回報：

- 修改檔案。
- API path。
- permission guard。
- 四個帳號的實際 roles。
- 四個帳號的 effective permission codes。
- 四個帳號的 store scope。
- dynamic test 結果。
- `node --check scripts/test-rbac-user-permissions-view-dev.js` 結果。
- `npx tsc --noEmit --pretty false` 結果。
- `npm run build` 結果。
- 人工 UI 驗收結果。
- 是否有敏感資訊外洩風險。
- 是否仍需手動輸入網址。
- 是否仍有阻擋。

完成後停止，等待使用者確認，不得自行進入下一階段。

## 11. 最新 DEV 狀態更新規則

自 2026-07-23 起，後續每個 DEV 開發小任務完成後，都必須同步維護交接文件：

- `docs/DEV-RBAC-HANDOFF.md`
  - 保留重要歷史，不得只覆蓋成最新摘要。
  - 每個小任務完成後追加或更新：任務名稱、完成狀態、修改檔案、API / UI / DB 影響、測試與 build 結果、發現問題、尚未完成事項、下一個最小任務、禁止事項、migration 狀態。
- `docs/CURRENT-DEV-STATUS.md`
  - 維持短版，覆寫為目前最新狀態。
  - 只保留：目前階段、最新已完成項目、阻擋、下一個最小任務、migration local / remote 狀態、最近 guard / tsc / build / dynamic test 結果、禁止操作。
- `.github/copilot-instructions.md`
  - 只在出現永久開發規則時更新。
  - 不大量寫入一次性測試輸出、暫時錯誤、單一帳號驗收結果或短期任務進度。

## 12. Task 1C-2B DB Core Verified

任務名稱：Task 1C-2B「庫存流水與庫存餘額 DB Core」

完成狀態：**DB Core Verified**

目前已完成：

- `ga_inventory_balances`
- `ga_inventory_transactions`
- transaction number sequence 與 helper
- `ga_post_inventory_transaction(...)` RPC
- sequence direct grants forward fix
- function EXECUTE grants forward fix
- balance UPSERT ambiguity forward fix
- append-only trigger
- RLS catalog 驗收
- DB Test SQL Coverage Completion
- Dynamic Verification A
- Dynamic Verification B
- concurrency / idempotency / unit conversion / negative stock / append-only 驗收

已套用且 local / remote aligned 的 Task 1C-2B 相關 migrations：

- `20260722065952_general_affairs_inventory_transactions_foundation.sql`
- `20260722091526_revoke_inventory_transaction_sequence_grants.sql`
- `20260722092849_restrict_inventory_transaction_function_execute_grants.sql`
- `20260722094917_fix_inventory_balance_upsert_conflict_ambiguity.sql`

Forward fixes 原因與結果：

- `20260722091526`
  - 原因：`public.ga_inventory_transaction_no_seq` 曾對 `anon` / `authenticated` 有 direct `USAGE` grant，違反規格。
  - 結果：撤銷 `PUBLIC`、`anon`、`authenticated` sequence grants，transaction number 只由 SECURITY DEFINER helper / RPC 內部產生。
- `20260722092849`
  - 原因：helper / RPC EXECUTE grants 需要限制。
  - 結果：`ga_next_inventory_transaction_no()` 不對 `PUBLIC` / `anon` / `authenticated` 開放；`ga_post_inventory_transaction(...)` 只對 `authenticated` 開放 EXECUTE。
- `20260722094917`
  - 原因：balance UPSERT 使用 `ON CONFLICT (location_id, part_id)` 造成 ambiguity。
  - 結果：改為 `ON CONFLICT ON CONSTRAINT ga_inventory_balances_location_part_unique DO NOTHING`。

測試與驗收：

- `supabase/verify_general_affairs_inventory_transactions_catalog.sql`：通過。
- `supabase/test_general_affairs_inventory_transactions_foundation.sql`：完整通過。
- `scripts/test-general-affairs-inventory-transactions-foundation.js`：通過。
- `scripts/test-general-affairs-inventory-transactions-dev.js`：通過。
- `scripts/test-general-affairs-inventory-transactions-api-dev.js`：通過。

尚未完成事項：

- Task 1C-3 尚未開始。
- 不得因 Task 1C-2B 已完成而自行新增庫存 UI 新階段。

## 13. Task 1C-2C API / UI 狀態

任務名稱：Task 1C-2C「庫存 API 與庫存管理 UI」

完成狀態：**Task 1C-2C Completed。**

目前已完成：

- 庫存餘額 API
- 庫存流水 API
- 交易過帳 API
- 庫存 options API
- `/general-affairs/inventory`
- 庫存導覽入口
- API dynamic tests
- `npx tsc --noEmit --pretty false`
- `npm run build`
- 總務導覽收斂
- 未建置模組 availability guard
- 人工 UI 複驗

人工 UI 驗收發現：

- `dev-no-ga@example.test` 看不到總務服務中心，符合預期。
- 具總務入口權限的帳號可看到總務服務中心，但人工驗收發現總務服務中心內部顯示超出 DEV 已完成 DB 模組範圍。
- `ga_vendors`、`ga_service_categories`、`ga_service_regions` 目前不存在。
- 維修模組所需資料表尚未建置到 DEV。
- 未建置模組曾顯示可操作入口，導致 schema cache / table not found 類錯誤。

人工 UI 複驗結果：

- `dev-no-ga@example.test`：符合預期，看不到總務服務中心。
- `dev-ga-access@example.test`：可進總務服務中心；進入庫存管理時顯示沒有庫存管理查看權限，符合實際 permission 配置。
- `dev-ga-view@example.test`：目前沒有下列權限，因此看不到完整庫存管理是核准結果：
  - `general_affairs.inventory_balance.view`
  - `general_affairs.inventory_transaction.view`
  - `general_affairs.inventory_transaction.manage`
- `dev-ga-view@example.test`：無法看到庫存位置、看不到新增或儲存按鈕、沒有原始資料庫錯誤，符合目前實際 permission 配置。
- `dev-ga-manage@example.test`：符合預期。
- `dev-full-admin@example.test`：符合預期。
- 未開放 routes：全部顯示安全未開放提示。
- 庫存功能複驗：入庫、出庫、調增、調減均通過。
- 不再出現 schema cache 原始錯誤。
- 不再出現 maintenance migration 原始錯誤。

不得為了完成 Task 1C-2C 臨時建立以下 migration：

- 維修模組
- 廠商模組
- 服務分類 / 服務區域 DB
- 設備 / 設施完整模組
- 工單流程
- 料件申請流程

## 14. 總務服務中心導覽收斂與未建置模組防護

任務名稱：總務服務中心導覽收斂與未建置模組防護

完成狀態：**已完成，人工 UI 複驗通過。**

修改檔案：

- `app/general-affairs/page.tsx`
- `app/general-affairs/equipment/page.tsx`
- `app/general-affairs/equipment/templates/page.tsx`
- `app/general-affairs/facilities/page.tsx`
- `app/general-affairs/parts/page.tsx`
- `components/general-affairs/ModuleUnavailablePage.tsx`
- `scripts/test-general-affairs-availability.js`

UI 影響：

- `/general-affairs` 首頁改為目前 DEV 可用功能模式。
- 保留庫存管理入口。
- 移除「建立工單 / 新增維修回報 / 新增料件 / 新增設備 / 申請料件」等未完成操作入口。
- 「申請料件」不再錯誤導向料件主檔。
- 未建置模組直接 route 改顯示安全提示：「此功能尚未在目前測試環境開放。」
- 不再自動查詢 `ga_vendors`、`ga_service_categories`、`ga_service_regions`。

API / DB 影響：

- 未修改 API。
- 未修改 DB schema。
- 未建立 migration。
- 未執行 db push、repair、reset、rollback。

測試與 build 結果：

- `node --check scripts/test-general-affairs-availability.js`：通過。
- `node scripts/test-general-affairs-availability.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過。
- build 仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，但 exit code 0。

發現問題：

- DEV Full Admin 與總務入口帳號原本可看到尚未建置模組入口。
- 未建置模組缺表錯誤曾直接暴露 table name / schema cache message。

尚未完成事項：

- Task 1C-2C 目前沒有阻擋。
- Task 1C-3 尚未開始，需使用者明確批准後才可進入。

下一個最小任務：

**等待使用者批准後，才開始 Task 1C-3。**

禁止事項：

- 不得為未建置模組補 migration。
- 不得開始 Task 1C-3。
- 不得連 Production。
- 不得修改已套用 migration。
- 不得 repair / reset / rollback。

Migration 狀態：

- 目前 7 筆 migration local / remote aligned：
  - `20260722030244`
  - `20260722032048`
  - `20260722055852`
  - `20260722065952`
  - `20260722091526`
  - `20260722092849`
  - `20260722094917`

## 15. DEV 使用者刪除流程修正

任務名稱：使用者管理測試帳號刪除修正

完成狀態：**程式修正完成，等待 DEV UI 人工複驗。**

背景：

- 使用者管理頁面可看到許多開發期間建立的測試使用者。
- 既有刪除流程只刪除 `public.profiles` 與部分關聯資料，沒有刪除 Supabase Auth 的 `auth.users`。
- 因 `getAllUsers()` 會補齊 Auth-only 使用者，單純刪 `profiles` 會導致帳號仍留在列表中，看起來像「無法刪除」。
- 既有刪除權限檢查曾使用 `profiles.role === 'admin'`，不符合新 RBAC 規則。

修改檔案：

- `app/auth/actions.ts`
- `scripts/test-admin-user-delete-action.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`
- `.github/copilot-instructions.md`

API / UI / DB 影響：

- 未新增 API route。
- 未修改 UI component。
- 未修改 DB schema。
- 未建立或修改 migration。
- 未執行 db push、repair、reset、rollback。
- `components/admin/UserManagementTable.tsx` 仍呼叫既有 `deleteUser(userId)` server action。

刪除流程現況：

- `deleteUser()` 先取得目前登入使用者。
- 禁止刪除目前登入中的使用者。
- 使用 `hasPermission(currentUserId, 'user.user.delete')` 檢查正式 RBAC 權限。
- 不再使用 `profiles.role` 作為刪除授權依據。
- 使用 server-only `createAdminClient()`。
- 刪除 Auth user 前清理：
  - `store_managers`
  - `store_employees`
  - `user_roles`
  - `collaborators`
- 若 Supabase Auth user 存在，透過 `adminSupabase.auth.admin.deleteUser(userId)` 刪除。
- 若只有 profile 殘留、Auth user 已不存在，允許清除 profile。
- 成功後 revalidate：
  - `/admin/users`
  - `/admin/roles`

安全限制：

- 不刪除目前登入者。
- 不在 client component 使用 service role。
- 不把 service role key、JWT、password 或 token 輸出到 console 或 UI。
- 不直接用 SQL 或 service role 手動硬刪測試使用者作為驗收方式。
- 若要大量清理 DEV 測試帳號，需另開受控任務，明確定義刪除範圍、帳號 pattern、人工確認與 audit 回報。

測試與 build 結果：

- `node --check scripts/test-admin-user-delete-action.js`：通過。
- `node scripts/test-admin-user-delete-action.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0。
- build 仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，未造成 failure。

新增靜態測試覆蓋：

- `deleteUser()` 必須檢查 `user.user.delete`。
- `deleteUser()` 不得用 `profiles.role` 授權。
- `deleteUser()` 必須阻擋刪除目前登入者。
- `deleteUser()` 必須查詢並刪除 Supabase Auth user。
- `deleteUser()` 必須清理 `user_roles` 與 `store_managers`。
- `deleteUser()` 必須 revalidate `/admin/users`。

發現問題：

- 使用者清單能顯示 Auth-only 帳號是必要行為，否則 DEV Dashboard 建立但尚未觸發 profile 的測試帳號會不可見。
- 但刪除流程也必須同步刪 Auth user，否則帳號會重新出現在列表。

尚未完成事項：

- 尚未由 DEV Full Admin 實際在 UI 刪除一筆測試帳號並確認列表更新。
- 尚未建立批次清理測試使用者功能；目前不建議在未定義範圍前做大量刪除。

下一個最小任務：

**人工複驗使用者管理刪除 DEV 測試帳號。**

建議人工驗收方式：

1. 使用 `dev-full-admin@example.test` 登入 DEV。
2. 進入 `/admin/users`。
3. 選擇確定可刪除的測試帳號，不要選目前登入者。
4. 點擊刪除。
5. 確認顯示刪除成功。
6. 重新整理後確認該帳號不再出現在使用者列表。
7. 若帳號仍出現，需回報錯誤訊息與該帳號是否仍存在於 Supabase Auth Dashboard；不得貼 key、JWT 或 password。

禁止事項：

- 不得為此修改 migration。
- 不得連 Production。
- 不得直接 SQL hard delete Auth / RBAC / profile 資料。
- 不得用 `profiles.role` 取代 RBAC 權限。
- 不得開始 Task 1C-3。

## 16. DEV RBAC 管理流程對齊正式區

任務名稱：DEV RBAC 管理流程對齊正式區

完成狀態：**程式修正完成，等待 DEV UI 人工複驗。**

正式流程目標：

1. 使用者先自行註冊或由既有註冊流程建立 Auth user。
2. 系統管理員到「使用者管理」編輯使用者基本資料：
   - 姓名
   - 員編
   - 部門
   - 職稱
   - 角色相容欄位
3. 系統管理員到「角色權限管理」新增角色。
4. 編輯角色可使用的 permission code。
5. 在角色編輯頁用員工編號批次指派使用者。

修改檔案：

- `app/auth/actions.ts`
- `app/api/roles/[id]/users/route.ts`
- `scripts/test-rbac-formal-management-flow.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`
- `.github/copilot-instructions.md`

API / UI / DB 影響：

- 未新增 DB migration。
- 未修改已套用 migration。
- 未執行 db push、repair、reset、rollback。
- 未建立第二套 RBAC。
- 使用者管理 UI 仍沿用既有 `UserManagementTable`。
- 角色管理 UI 仍沿用既有 `RoleListClient` / `RoleEditClient`。
- 角色指派 API 仍為 `POST /api/roles/[id]/users`，payload 使用 `employee_codes`。

使用者基本資料編輯修正：

- `updateUserProfile()` 不再使用 `profiles.role === 'admin'` 作為授權。
- 編輯姓名、員編、部門、職稱需 `user.user.edit`。
- 編輯相容角色欄位需 `user.user.change_role`。
- 禁止修改目前登入使用者自己的相容角色欄位。
- `employee_code` 會 trim 並 uppercase。
- `employee_code` 不可空白。
- `employee_code` 更新前會檢查是否已被其他 `profiles` 使用。
- `profiles.role` 仍只作為舊程式相容與顯示用途，不是新 RBAC 權限來源。

角色使用者指派修正：

- `POST /api/roles/[id]/users` 保持正式邏輯：以員工編號批次指派角色。
- DEV / RBAC 測試帳號可只存在 `profiles.employee_code`。
- 正式區若有 `store_employees`，仍可作為相容補充來源。
- DEV baseline 缺 `store_employees` 時，API 會安全略過此 optional table。
- 不再因 `public.store_employees` 缺表而回傳 schema cache 原始錯誤。
- `GET /api/roles/[id]/users` 同樣會在 DEV 缺 `store_employees` 時改用 `profiles` 顯示姓名與員編。

安全設計：

- 寫入仍由 server-side API / server action 檢查 RBAC 權限後使用 server-only admin client。
- service role 不進 client component。
- 前端顯示或隱藏按鈕不取代 server-side permission guard。
- 不使用帳號名稱、email 或 role name 猜測權限。

測試與 build 結果：

- `node --check scripts/test-rbac-formal-management-flow.js`：通過。
- `node scripts/test-rbac-formal-management-flow.js`：通過。
- `node scripts/test-admin-user-delete-action.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0。
- build 仍有既有 `DYNAMIC_SERVER_USAGE` 訊息，未造成 failure。

新增靜態測試覆蓋：

- `updateUserProfile()` 必須使用 `user.user.edit`。
- `updateUserProfile()` 編輯相容角色時必須使用 `user.user.change_role`。
- `updateUserProfile()` 不得透過 `profiles.role` 授權。
- `employee_code` 必須 uppercase normalize。
- `employee_code` 必須檢查重複。
- 角色指派必須查詢 `profiles.employee_code`。
- `store_employees` 只能是 optional compatibility source。
- 角色編輯 UI 必須用 `employee_codes` 指派使用者。

尚未完成事項：

- 尚未由 DEV Full Admin 實際人工複驗完整流程。
- 尚未建立批次清理 DEV 測試使用者功能。
- 尚未開始 Task 1C-3。

下一個最小任務：

**人工複驗 DEV RBAC 正式流程。**

建議人工驗收清單：

1. 建立或選擇一個測試 Auth 使用者。
2. 使用 DEV Full Admin 到 `/admin/users`。
3. 編輯該使用者：
   - 姓名
   - 員編
   - 部門
   - 職稱
   - 相容角色欄位
4. 確認更新後列表顯示新的員編。
5. 到 `/admin/roles` 新增一個測試角色。
6. 進入角色編輯頁。
7. 在權限設定分頁勾選測試所需 permission code 並儲存。
8. 切換到使用者管理分頁。
9. 用剛才設定的員編指派使用者。
10. 確認角色使用者列表顯示該使用者、姓名與員編。
11. 回到使用者管理，確認該使用者的 active roles / effective permission count 有更新。

禁止事項：

- 不得為此建立新 migration。
- 不得直接修改 remote schema。
- 不得直接 SQL 寫入 `user_roles` 作為人工驗收捷徑。
- 不得用 `profiles.role` 取代正式 `user_roles` / `role_permissions`。
- 不得開始 Task 1C-3。

## 18. 正式區使用者刪除：歷史資料 FK 保護

任務名稱：正式區使用者刪除遇到歷史引用時改為停用登入與撤權

完成狀態：**程式修正完成，靜態測試、TypeScript 與 build 通過；尚未在正式區執行任何資料庫操作。**

問題背景：

- 正式區刪除使用者時曾出現：
  - `update or delete on table "profiles" violates foreign key constraint "inspection_improvements_improved_by_fkey" on table "inspection_improvements"`
- 根因是 `inspection_improvements.improved_by` 等歷史業務資料仍引用 `profiles.id`。
- 這類使用者不可強制硬刪 `profiles`，否則會破壞盤點改善紀錄、歷史稽核與人員責任歸屬。

本輪決策：

- 若使用者沒有歷史引用，仍可走原本安全刪除流程。
- 若刪除 `auth.users` 或 `profiles` 時遇到歷史 FK 錯誤，改採「保留 profile、停用登入、撤除角色與管理範圍」。
- 不修改正式資料庫 FK。
- 不建立 migration。
- 不直接改 remote schema。
- 不為了刪除使用者硬刪歷史資料。

修改檔案：

- `app/auth/actions.ts`
- `components/admin/UserManagementTable.tsx`
- `scripts/test-admin-user-delete-action.js`
- `docs/CURRENT-DEV-STATUS.md`
- `docs/DEV-RBAC-HANDOFF.md`
- `.github/copilot-instructions.md`

API / UI / DB 影響：

- DB schema：無異動。
- migration：無新增、無修改、無 push。
- 使用者刪除 Server Action 仍先檢查 `user.user.delete`。
- 刪除前仍清理：
  - `store_managers`
  - optional `store_employees`
  - `user_roles`
  - `collaborators`
- 若碰到歷史 FK：
  - 保留 `profiles`。
  - 透過 server-only Supabase Auth Admin API 將 Auth user 設定長期 ban。
  - 回傳明確訊息，告知使用者已保留歷史資料並停用登入。
- 若 Supabase Auth Admin API 只回傳籠統的 `Database error deleting user`，也視為可能存在資料庫歷史引用，採同一套保留 profile + 停用登入 fallback。
- 使用者管理 UI 成功訊息改讀取 server action 回傳的 `message`，避免將 fallback 誤顯示為單純刪除成功。
- `getAllUsers()` 會依 Supabase Auth `banned_until` 回填 `is_disabled`，供後續 UI 顯示停用狀態使用。

測試與 build 結果：

- `node --check scripts/test-admin-user-delete-action.js`：通過。
- `node scripts/test-admin-user-delete-action.js`：通過。
- `node scripts/test-rbac-formal-management-flow.js`：通過。
- `npx tsc --noEmit --pretty false`：通過。
- `npm run build`：通過，exit code 0。

發現問題：

- build 前曾有本機 `next dev -p 3002` 殘留程序造成 `.next` 產物干擾；已只停止本專案佔用 3002 的 node / next dev 程序後重新 build。
- 未刪除 `.next`、`node_modules`、lockfile、migration 或 env 檔。

尚未完成事項：

- 尚未在正式區實際操作刪除該名有歷史引用的使用者。
- UI 若要更完整，後續可加上「已停用登入」標籤與篩選。
- 後續若要真正永久清除帳號，必須先設計歷史資料匿名化或引用保留策略，不可直接硬刪。

下一個最小任務：

**在正式區用系統管理員操作一次有歷史引用的使用者刪除，確認畫面顯示「保留歷史資料並停用登入」且該帳號無法再登入。**

禁止事項：

- 不得為了刪除使用者修改 `inspection_improvements` 歷史資料。
- 不得把相關 FK 改成 `ON DELETE CASCADE`。
- 不得直接硬刪 `profiles` 或 `auth.users` 繞過應用程式流程。
- 不得用 service role 在 SQL Editor 手動刪資料作為正式操作捷徑。
- 不得開始 Task 1C-3。
