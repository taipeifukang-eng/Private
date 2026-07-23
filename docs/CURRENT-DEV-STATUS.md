# Current DEV Status

最後更新：2026-07-23

## 目前階段

Task 1C-2C 已完成；本輪完成正式區使用者刪除歷史 FK 保護修正。

## 最新已完成項目

- Task 1C-2B DB Core Verified。
- Task 1C-2C Completed。
- Task 1C-2C API / dynamic tests / tsc / build 已通過。
- Task 1C-2C 人工 UI 複驗已通過。
- 總務導覽收斂完成。
- 未建置模組 availability guard 完成。
- 庫存功能人工複驗通過：
  - 入庫
  - 出庫
  - 調增
  - 調減
- 不再出現 schema cache 原始錯誤。
- 不再出現 maintenance migration 原始錯誤。
- 使用者管理刪除流程已修正：
  - 使用 `user.user.delete` RBAC 權限檢查。
  - 禁止刪除目前登入中的使用者。
  - 刪除前清理 `store_managers`、`store_employees`、`user_roles`、`collaborators` 關聯。
  - 透過 server-only Supabase Auth Admin API 刪除 Auth 使用者，避免只刪 `profiles` 後帳號殘留。
- 使用者基本資料編輯流程已對齊正式 RBAC：
  - 姓名、員編、部門、職稱需 `user.user.edit`。
  - 相容角色欄位需 `user.user.change_role`。
  - 不再用 `profiles.role` 作為編輯授權。
  - 員編會 trim / uppercase，並檢查不可與其他 profile 重複。
- 角色指派流程已對齊正式邏輯：
  - 角色管理仍以「員工編號」批次指派使用者。
  - DEV 可只靠 `profiles.employee_code` 指派角色。
  - 正式區若有 `store_employees`，仍作為相容補充來源。
  - DEV 缺 `store_employees` 時不再顯示 schema cache 原始錯誤。
- 正式區使用者刪除歷史 FK 保護已修正：
  - 若 `inspection_improvements.improved_by` 等歷史資料引用 `profiles.id`，不再回傳原始 FK 錯誤。
  - 若 Supabase Auth Admin API 只回傳 `Database error deleting user`，也會改走保留 profile + 停用登入 fallback。
  - 改為保留 `profiles`、撤除角色與管理範圍，並透過 Auth Admin API 停用登入。
  - 無歷史引用的新使用者仍可走原安全刪除流程。
  - UI 會顯示 server action 回傳的實際結果訊息。

## 目前阻擋

- 目前沒有 Task 1C-2C 阻擋。
- 正式區需人工複驗：刪除有歷史引用的使用者時，應顯示保留歷史資料並停用登入，且該帳號不得再登入。
- 使用者刪除、基本資料編輯、角色權限設定與用員編指派角色，仍建議由 DEV Full Admin 在 UI 人工複驗。
- Task 1C-3 尚未開始。
- 需由使用者明確批准後才可開始 Task 1C-3。

## 下一個最小任務

正式區人工複驗「有歷史引用使用者刪除」：使用系統管理員刪除被 `inspection_improvements` 等歷史資料引用的使用者，確認 UI 顯示保留歷史資料並停用登入，且不再出現 PostgreSQL FK 原始錯誤。

## Migration Local / Remote 狀態

目前 7 筆 migration local / remote aligned：

- `20260722030244`
- `20260722032048`
- `20260722055852`
- `20260722065952`
- `20260722091526`
- `20260722092849`
- `20260722094917`

目前無 local-only / remote-only / unknown migration。

## 最近一次檢查結果

- App DEV Guard：passed，Project Ref `mjpd...mtqr`
- CLI DEV Guard：passed，Project Ref `mjpd...mtqr`
- `npx supabase migration list`：7 筆 local / remote aligned
- `node --check scripts/test-general-affairs-availability.js`：通過
- `node scripts/test-general-affairs-availability.js`：通過
- `node --check scripts/test-admin-user-delete-action.js`：通過
- `node scripts/test-admin-user-delete-action.js`：通過
- `node --check scripts/test-rbac-formal-management-flow.js`：通過
- `node scripts/test-rbac-formal-management-flow.js`：通過
- `npx tsc --noEmit --pretty false`：通過
- `npm run build`：通過，exit code 0
- Task 1C-2C API dynamic tests：通過
- Task 1C-2C 人工 UI 複驗：通過

## 禁止操作

- 不得連 Production。
- 不得命中 Production 候選 Project Ref `odvksgucvfoaqrumpran`。
- 不得修改已套用 migration。
- 不得直接改 remote schema。
- 不得 `migration repair` / `db reset` / rollback。
- 不得為完成已結束的 Task 1C-2C 臨時建立維修、廠商、服務分類、服務區域、設備、設施或料件申請 migration。
- 不得直接用 SQL 或 service role 手動硬刪 DEV 測試使用者；若要清理帳號，優先走已修正的使用者管理 UI / server action。
- 不得為了刪除正式使用者修改或硬刪歷史業務資料；若 `profiles` 已被歷史資料 FK 引用，應保留 profile 並停用登入。
- 不得為 DEV 測試區建立第二套 RBAC 管理流程；使用者基本資料、角色、權限、角色指派必須沿用正式區 schema 與操作邏輯。
- 不得開始 Task 1C-3，除非使用者明確批准。
