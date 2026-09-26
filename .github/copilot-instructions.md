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
- Production schema-only dump 若由使用者提供，只能放在 `.gitignore` 排除的位置，例如 `schema-intake/`；不得 commit，不得要求或輸出 Production password / connection string。
- Production schema-only 只能用於本機 diff 與 migration 設計，不得直接套用到 DEV 或 Production。

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
- DEV 目標是逐步復刻 Production 的全系統結構與功能，不是只為單一任務臨時補表。
- DEV 與 Production 必須維持同一套 application codebase；核心流程不得依環境分支成不同業務邏輯。
- Schema migrations 必須先在 DEV 驗證，且應可審核後推進 Production。
- Schema migration 必須與 DEV demo seed 分離。
- DEV-only seed 不得套用到 Production。
- Production 可接收已審核 schema / system reference seed，但不得接收 DEV 假資料。
- 參考正式區 Supabase 時，只能使用 schema-only / policy / config evidence；不得匯入正式資料列。

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
- RLS policy 若直接呼叫 helper function，該 helper 必須明確設計 EXECUTE grants；authenticated 查表需要能執行 policy 內 helper，但 anon / PUBLIC 不得取得不必要的 EXECUTE。
- 使用者刪除流程不得只刪 `profiles`；若刪除 App 使用者，必須由 server-side 權限檢查通過後同步處理 Supabase Auth user，並清理 `user_roles` / scope 關聯。
- 若 `profiles` 已被盤點改善、工單、庫存或其他歷史業務資料 FK 引用，不得硬刪或修改歷史資料來完成刪除；應保留 profile、撤除角色與 scope，並停用 Supabase Auth 登入。
- 若 Supabase Auth Admin API 刪除使用者只回傳籠統的 `Database error deleting user`，不得直接把原始錯誤丟給使用者；應視為可能受歷史 FK 阻擋並走保留 profile + 停用登入 fallback。
- 前端隱藏按鈕或選單只改善 UX，不等於安全控制。
- 不得使用 service role 代替 authenticated user 驗證 RLS / RPC。
- service role 只能用於 server-only、已通過權限檢查後的管理查詢或受控 seed，不得在 client component 中引用。
- 導覽與入口顯示必須依 effective permissions 與已完成模組狀態判斷，不得依帳號名稱或角色名稱猜測。
- Navbar 或其他導覽權限不得只靠 client-side direct RBAC table join；必須合併或優先使用 server-side effective permissions / permission API，避免 RLS 或 join shape 造成已指派權限漏顯。
- Navbar 的 admin-like compatibility 必須與 server-side `hasPermission` admin bypass 保持一致；系統管理者不應因 client-side permissionSet 讀取不到資料而缺少正式功能入口。
- 店長、督導、經理或門市範圍指派 API 必須依 `store.manager.assign`、`store.supervisor.assign`、`store.manage` 等 RBAC permission code 檢查，不得只依 `profiles.role === 'admin'` 或職稱文字放行。
- 門市主檔新增、編輯、停用、搬遷等管理操作必須走 server-side action / API guard 與 RBAC permission code；client component 不得直接對 `stores` 做 insert / update / delete 來完成管理儲存。
- RBAC 管理、使用者搜尋、角色權限或 navbar 權限相關修改完成後，先執行 `npm run test:rbac-safe-preflight`。此 preflight 只可包含不需密碼、不使用 service role、不寫 DEV 資料的語法、靜態與未登入 smoke 檢查。
- 需要確認 RBAC 本機驗收準備狀態時，優先執行 `npm run test:rbac-local-ready`；它只會列測試範圍並執行 safe preflight，不得登入、不得呼叫 authenticated API、不得連 DB。
- 在要求使用者輸入 DEV 密碼前，可先執行 `npm run test:rbac-user-management-cases` 確認 RBAC dynamic test 範圍；此指令不得登入、不得呼叫 API、不得連 DB。
- 需要 authenticated DEV RBAC 動態驗收時，優先執行 `npm run test:rbac-user-management-dev`，由使用者在 Terminal hidden prompt 輸入 DEV 密碼；不得把密碼、JWT、refresh token 或 cookie 寫入檔案或輸出。
- Next.js server API 的 authenticated dynamic tests 必須使用目前 `@supabase/ssr` 相容的 `base64url` session cookie 格式；不得退回舊的 Supabase auth JSON array cookie 格式。
- `scripts/test-rbac-navbar-permissions-dev.js` 會使用 service role 建立或更新 DEV-only Auth users / roles / role_permissions / user_roles，屬於重型寫入驗收；除非使用者明確批准建立或更新 DEV RBAC temporary data，否則不得執行。
- `test:rbac-safe-preflight` 不得完整實跑 password-based dynamic scripts，也不得執行任何 `supabase` CLI 指令；這些腳本最多只能以 `node --check` 形式納入 preflight。

## 模組 Availability 與錯誤安全

- 尚未建置資料表、RPC、API 或 UI 的模組，不得顯示可操作入口。
- 未建置模組若需要保留直接 route，應顯示安全 availability 頁面，例如「此功能尚未在目前測試環境開放」。
- Availability guard 是暫時防護，不代表 DEV / Production parity 已完成；每個 guard 都必須有恢復正式功能的 schema/API/UI 移除計畫。
- 不得把 Supabase schema cache、PostgreSQL 原始錯誤、table name、SQL、stack trace 或 migration file name 直接顯示給一般使用者。
- API 或 UI 遇到未建置模組時，應轉成一致且安全的使用者訊息；server log 可保留非敏感診斷，但不得輸出 key、token、password 或 connection string。
- 前端隱藏未開放入口只改善 UX；頁面、API、RPC 與 RLS 仍必須保留 server-side security。

## 總務 UX 與導覽規則

- 總務服務中心新功能必須優先使用共用 page template 與集中式 navigation definition，不得在 Navbar、總務首頁、手機導覽與子頁各自硬編一套入口。
- 巢狀導覽的 active state 必須採最具體 route 優先；同一時間只能有一個 active nav item。
- Parent group 展開狀態必須與 active item 狀態分離，不得因 child active 讓 parent route item 同時 active。
- 點擊 Sidebar 任一可導向功能項目後，應收合先前展開的其他功能群組；若點擊子項目，也必須收合所有父群組。
- UI 不得依 DEV / Production 分支成不同業務流程；DEV 與 Production 應使用同一套程式皮與 schema contract，資料內容可不同。
- Permission denied 必須在導覽層與 action 層收斂呈現：無權限入口可隱藏，可讀不可寫時操作按鈕需隱藏或顯示明確缺權限原因；但前端呈現不得取代 server/API/RLS 權限檢查。
- 正式業務流程進入實作前必須先有 UX spec / blueprint，明確定義角色旅程、入口、頁面模板、權限呈現、empty/loading/error states 與 mobile 驗收。
- Dashboard 不得使用硬編碼營運數字假裝有資料；KPI 必須來自既有 API 或已批准的新 API。
- API failure 不得轉譯成 KPI 0；沒有資料、載入中與載入失敗必須分開呈現。
- Dashboard 區塊必須同時受 permission 與 feature availability 控制。
- 尚未完成的業務流程不得顯示成可操作 KPI 或快捷按鈕，即使目前登入者是 Full Admin。
- Store scope 必須由 server API / RLS 控制，前端不得自行擴大資料可見範圍。
- 維修回報、我的回報、工單中心與總務首頁若顯示同一工單 status，必須共用集中式 status mapping；不得在不同頁面各自硬編不同中文名稱、tone 或可用操作。
- 同一業務資料不得為不同角色建立重複主表或重複主流程；requester view 與 manager view 應使用同一主資料、不同 scope 與操作權限。
- 總務「我的回報」與「工單中心」必須讀同一批 maintenance request / update / progress 資料；總務更新工單狀態後，門市端應直接讀取同一資料來源。
- Resource type 不得被誤建成獨立追蹤流程；例如料件／耗材回報在正式料件申請流程批准前，只能是維修回報的 `resource_type = material` 篩選。
- 若 Sidebar 資訊架構已定義為獨立使用者功能入口，應提供 route-level page；不得只用 `/path?section=...` query-string pseudo page 取代明確介面。
- 前端不得為了呈現流程而虛構尚未由後端支援的進度事件、預計完成日期、派工、報價、請款或工單扣料階段。
- 設備、設施、料件、庫存等主檔 UI 只能顯示已建置欄位與已批准流程；不得顯示假的保固文件、巡檢、保養排程、附件、費用、廠商或採購操作入口。
- 設備／設施等資產主檔若已拆成子模組 routes，列表頁不得再用主功能 tabs 把分類、保固、維修歷程塞回同一頁；Sidebar 子模組與 active state 要沿用集中式 navigation definition。
- 資產編號不得由前端自行產生正式流水號；需要分類前綴、購置日期與流水號時，必須由 DB/RPC/sequence 受控產生並以 unique constraint 防重。
- 圖片或附件能力未具備完整 storage bucket、policy、upload API 與資料表關聯前，不得顯示假上傳成功。
- 總務附件應優先使用共用 `ga_resource_attachments` / `general-affairs-attachments` / signed URL / soft delete RPC 模式；不得為設備、設施、維修回報各自臨時建立第二套不相容附件流程。
- 總務子功能導覽、頁面入口與 API guard 必須使用該子功能的正式 permission code；`general_affairs.service_center.access` 只能代表總務服務中心入口，不得用來放行廠商、服務分類、服務區域、設備、設施、料件或庫存管理。
- 總務服務中心的維修回報、料件申請暫行入口與工單中心不得把 `cross_dept.maintenance.*` 當作角色配置或導覽顯示依據；應使用 `general_affairs.maintenance_request.*` 與 `general_affairs.work_order.*`。若 legacy API / RLS 仍共用 `maintenance_*` 資料表，可在 shared compatibility layer 保留跨部門舊碼相容，但不可因此把總務角色權限綁回跨部門碼。
- 料件管理只能管理「這是什麼料件」；庫存數量、庫存位置餘額、入庫、出庫、調增、調減不得在料件主檔頁直接輸入或假造。
- 料件用途類型不得等同料件分類；若正式流程需要 `usage_type` 或 `compatibility_scope`，應以正式 DB 欄位或明確相容層設計處理，不得只做前端假欄位。
- 料件主檔是全公司共用資料，不得因門市不同而複製相同料件主檔；門市 / 位置差異應由庫存位置、庫存設定或 RLS scope 處理。
- 料件圖片或附件若附件 API / Storage policy 尚未支援 `PART` resource type，不得顯示假上傳成功。
- 一般人員、店長、督導、總務等業務角色能力必須由 `roles` / `permissions` / `role_permissions` / `user_roles` 與 `store_managers` scope 組合定義，不得用 email、role name、職稱文字或 `profiles.role` 硬判斷。
- Store manager 與 supervisor 的差異主要來自 `store_managers.role_type` 與管理門市範圍；前端可顯示 scope，但不得自行擴大 API / RLS 允許的資料範圍。
- 新的正式 permission code 必須先以 migration / seed reference data 明確建立，再同步 navigation、API guard、RLS 與測試；不得在前端先引用不存在的正式權限碼並宣稱功能完成。
- 人員異動紀錄若新增編輯能力，升職職位或生效日期修正後必須同步重算受影響月份後的每月人員狀態；不得只改 `employee_movement_history` 而留下 `monthly_staff_status` 舊職位。
- 姓名類人員異動修正若影響已建立月度資料，必須同步 `store_employees` 與受影響月份後的 `monthly_staff_status.employee_name`，並在 UI 告知使用者同步範圍。
- 督導管理日誌不得被實作成一般工作日誌 CRUD，也不得併入督導巡店；它應以 Management Case / Record / Follow-up 表達「發現、判斷、管理動作、追蹤結果」。
- 督導管理日誌的統計不得把紀錄數直接當成督導績效；可作管理觀察，但不得誘導大量建立低價值流水帳。
- 督導管理日誌的 AI / 語音整理不得直接寫入正式紀錄；AI 只能產生待確認草稿，必須由使用者確認後才可儲存。
- 督導管理日誌的 AI / 語音整理不得由 LLM 產生 `store_id`、`employee_id`、`profile_id` 或任何正式 FK；LLM 只能輸出 entity mention，正式 Entity Matching 必須由 application layer 依登入者權限、store scope、正式 stores / store_employees / profiles 主檔候選與使用者確認完成。

## 開發流程

- 接手前先讀 `docs/DEV-RBAC-HANDOFF.md`。
- 接手 DEV / Production parity 相關任務前，先讀 `docs/DEV-PRODUCTION-FULL-SYSTEM-PARITY-AUDIT.md`。Parity audit 必須涵蓋整個 repository，不得只盤點單一模組。
- `docs/DEV-PRODUCTION-PARITY-AUDIT.md` 是前一版較窄盤點歷史，可作補充參考。
- 執行 Production schema-only parity intake 前，先讀 `docs/PRODUCTION-SCHEMA-ONLY-PARITY-INTAKE.md`，並優先使用 `scripts/compare-schema-only-parity.js` 做本機安全掃描與差異摘要。
- 每個 DEV 開發小任務完成後，必須同步維護交接文件：
  - `docs/DEV-RBAC-HANDOFF.md` 保留重要歷史並追加任務完成狀態、修改檔案、API / UI / DB 影響、測試與 build 結果、發現問題、尚未完成事項、下一個最小任務、禁止事項與 migration 狀態。
  - `docs/CURRENT-DEV-STATUS.md` 覆寫為短版最新狀態，只保留目前階段、最新已完成項目、阻擋、下一個最小任務、migration local / remote 狀態、最近 guard / tsc / build / dynamic test 結果與禁止操作。
  - `.github/copilot-instructions.md` 只在出現新的永久開發規則時更新，不大量寫入一次性測試輸出、暫時錯誤、單一帳號驗收結果或短期任務進度。
- 不得自行開始下一個 Task。每個階段完成後停止並回報，等待使用者確認。
- 修改前先理解現有檔案與樣式，不建立第二套導覽、第二套 RBAC 或重複 API 模式。
- 對既有 dirty working tree，要只修改本輪需要的檔案，不 revert 使用者或其他代理的變更。
- 不要修改 Production 設定。
- 不要直接改 remote schema。
- 不得為了提高 DEV 測試真實感而複製 Production 業務資料；可建立假資料或經確認的非敏感 reference data。

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
- `npm run build` 會重寫 `.next` 輸出；若 `next dev` 同時在跑，build 後需重啟 dev server，避免 dev route 暫時出現 chunk missing 500。

## 目前狀態來源

- 目前階段、下一個最小任務、最近 guard / tsc / build / dynamic test 結果，一律以 `docs/CURRENT-DEV-STATUS.md` 為準。
- 長期交接脈絡與歷史決策以 `docs/DEV-RBAC-HANDOFF.md` 為準。
- 不要在本檔大量寫入短期進度或單次測試輸出；本檔只保存 repository-level 永久規則。
- 完成任何階段後停止並回報，不自行接續下一階段。

- 總務設備、設施、料件等主檔新增 / 編輯頁的分類選擇器應同時支援逐層點擊與關鍵字搜尋分類名稱、分類 code、完整分類路徑；不得退回單一超長下拉。
- 料件圖片 / 附件必須走共用 `ga_resource_attachments`、`general-affairs-attachments`、signed URL、RLS helper 與 soft delete RPC；只有 DB constraint、helper、API 都支援 `resource_type = 'PART'` 後才可顯示正式上傳成功。
