# P1-B Schema Parity Design

最後更新：2026-07-23

## 1. Scope

P1-B 的目標是解讀 Production public schema-only 與 DEV migrations 的差異，規劃下一個最小可審查的 DEV parity migration。

本輪只做設計，不執行 DB migration、不 `db push`、不 `repair`、不 `reset`、不 `rollback`，也不開始 Task 1C-3。

## 2. Inputs

Production schema-only：

- `schema-intake/production-public.schema-only.sql`
- SHA-256：`CF52046B1E63F02FD0EE181CF3E78A18B76D1B237B6974455B85EB5F59B912DE`
- 只包含 public schema structure，不應包含 Production data rows、Auth users、Storage object rows、password、JWT、token、key 或 connection string。

DEV schema source：

- `supabase/migrations`
- 目前 7 筆 migration local / remote aligned：
  - `20260722030244`
  - `20260722032048`
  - `20260722055852`
  - `20260722065952`
  - `20260722091526`
  - `20260722092849`
  - `20260722094917`

本機比對：

```powershell
node scripts/compare-schema-only-parity.js --production schema-intake/production-public.schema-only.sql --dev supabase/migrations
```

## 3. Diff Summary

Production public schema-only：

- tables：83
- functions：33
- policies：220
- triggers：38
- indexes：165
- constraints：339
- grants：370

DEV migrations：

- tables：19
- functions：40
- policies：42
- triggers：15
- indexes：78
- constraints：128
- grants：156

差異摘要：

- DEV missing Production tables：76
- DEV extra tables：12
- DEV missing Production functions：30
- DEV missing Production policies：220
- DEV missing Production triggers：38
- 同名 table 欄位差異：7 tables

同名核心表欄位集合一致：

- `profiles`
- `permissions`
- `roles`
- `role_permissions`
- `user_roles`
- `store_managers`
- `stores`

這 7 張表主要差異是 default 表示法、quoted type、部分 `NOT NULL` 嚴格度與 timestamp default 寫法。P1-B 不建議先改這些已運作中的 DEV RBAC baseline，除非後續實測證明正式功能依賴特定 nullability。

## 4. Missing Tables By Domain

### Core Task Assignment

- `templates`
- `assignments`
- `assignment_collaborators`
- `logs`
- `assignment_cleanup_backup_20260401`

這組支撐首頁任務、派發任務、任務模板與任務歷程，是正式區主流程入口之一。

### Store / Employee Compatibility

- `store_employees`
- `employee_movement_history`
- `store_transfer_requests`
- `store_relocation_history`

這組是門市管理、每月人員狀態、員編查詢、藥師月資料、促遷與員工角色管理的共同依賴。`store_employees` 是 P1-B 第一優先。

### General Affairs Legacy

- `ga_vendors`
- `ga_service_categories`
- `ga_service_regions`

這三張表是人工 UI 驗收曾出現 schema cache 原始錯誤的直接原因。它們屬於正式區既有總務供應商 / 服務分類 / 服務區域功能，和目前 DEV-first 的設備、設施、料件、庫存主檔並行。

### Maintenance

- `maintenance_categories`
- `maintenance_requests`
- `maintenance_updates`
- `maintenance_photos`
- `maintenance_update_photos`
- `maintenance_ticket_events`
- `maintenance_progress_stages`
- `maintenance_status_migration_backup`

目前 DEV 已用 availability guard 避免暴露原始 schema cache error。若要恢復維修回報與工單中心，需另開專門階段，不能塞進 P1-B core migration。

### Inspection And Inventory Result Analysis

- `inspection_templates`
- `inspection_masters`
- `inspection_results`
- `inspection_improvements`
- `inspection_on_duty_staff`
- `inspection_bonus_config`
- `inspection_grade_mapping`
- `inventory_result_batches`
- `inventory_result_items`
- `inventory_result_settings`

這組牽涉正式版盤點結果分析報表與督導巡店權限。使用者已要求正式版報表需依店長 / 督導 scope 控制，DEV parity 後續也要以 store scope / supervisor scope 驗收。

### Monthly / Performance / HR

- `monthly_staff_status`
- `monthly_store_summary`
- `monthly_bonus_records`
- `monthly_performance_details`
- `meal_allowance_records`
- `spring_festival_bonus`
- `store_performance`
- `store_performance_thresholds`
- `support_staff_bonus`
- `talent_cultivation_bonus`

這組支撐每月人員狀態、績效、獎金與人事異動關聯畫面。

### Campaign / Activity

- `campaigns`
- `campaign_schedules`
- `campaign_store_details`
- `campaign_department_publish`
- `campaign_checklist_items`
- `campaign_checklist_completions`
- `campaign_equipment_trips`
- `campaign_store_headcount`
- `campaign_store_own_staff`
- `campaign_support_requests`
- `campaign_support_staff`
- `event_dates`
- `store_activity_settings`

這組支撐活動排程、督導/門市活動資料與跨部門發布。

### Product / Stockout / Clinic / Pharmacist / Relationship

後續需分階段處理：

- 商品與缺貨：`products_master`、`product_barcodes`、`stockout_*`、`acquisition_*`
- 自費價差：`clinic_selfpay_*`
- 藥師：`pharmacist_*`
- 關係會員：`relationship_*`

## 5. DEV Extra Tables

DEV 目前存在但 Production schema-only 不存在的 tables：

- `ga_equipment`
- `ga_equipment_categories`
- `ga_equipment_templates`
- `ga_facilities`
- `ga_facility_categories`
- `ga_inventory_balances`
- `ga_inventory_location_parts`
- `ga_inventory_locations`
- `ga_inventory_transactions`
- `ga_part_categories`
- `ga_part_compatibilities`
- `ga_parts`

這些是 DEV-first 總務 1B / 1C 成果。它們不是 P1-B 要移除的錯誤；只是代表 Production 尚未部署這些新模組。

## 6. Core Reference Priority

建議 P1-B 最小 migration 分成兩層：

### P1-B-1 RBAC Reference Seed

目的：

- 補齊正式版 Navbar、API guard 與頁面權限會用到的 permission codes。
- 建立或同步 system roles 的角色代碼與 role_permissions baseline。
- 不建立 Production users。
- 不複製 Production role assignments。

來源：

- 程式碼中出現的 permission codes。
- Production schema policies / functions 中引用的 permission codes。
- 現有 DEV RBAC schema：`permissions`、`roles`、`role_permissions`、`user_roles`。

必要 permission code 群組：

- `role.*`
- `user.*`
- `store.*`
- `task.*`
- `inventory.*`
- `monthly.*`
- `inspection.*`
- `activity.*`
- `employee.*`
- `cross_dept.*`
- `performance.*`
- `pharmacist.*`
- `relationship_member.*`
- `dashboard.view`
- `general_affairs.*`

規則：

- 權限來源仍只能是 `roles`、`permissions`、`role_permissions`、`user_roles`、`has_permission()` / `current_user_has_permission()`。
- `profiles.role` 只保留顯示與舊程式相容，不作為新授權唯一依據。
- 不以 email 白名單授權。
- DEV Full Admin 可透過 RBAC role_permissions 全開；不要靠 profile text role 當唯一來源。

### P1-B-2 Store / Employee Compatibility

目的：

- 建立 `store_employees`，讓使用者管理、員編管理、門市人員、每月狀態、藥師與促遷頁面有共同基礎。
- 支援「先 Auth 註冊，再由系統管理員編輯姓名、員編、部門、職稱、角色，再用員編做管理」的正式區操作邏輯。

Production `store_employees` 欄位：

- `id uuid`
- `store_id uuid`
- `user_id uuid`
- `employee_code varchar(20)`
- `position varchar(50)`
- `employment_type varchar(20) not null`
- `is_pharmacist boolean`
- `is_active boolean`
- `start_date date`
- `created_at timestamptz`
- `updated_at timestamptz`
- `employee_name varchar(100)`
- `current_position text`
- `last_promotion_date date`
- `employment_status varchar(20)`
- `last_movement_date date`
- `last_movement_type varchar(20)`
- `birthday date`

Production constraints / FK 重點：

- PK：`store_employees_pkey`
- `employment_type` in `full_time`, `part_time`
- `store_id -> stores(id) ON DELETE CASCADE`
- `user_id -> profiles(id) ON DELETE CASCADE`
- RLS enabled

DEV 安全建議：

- 先用 Production 欄位相容，不增加新欄位。
- 補 `updated_at` trigger。
- 新 API / server action 不使用 `profiles.role` 作授權依據。
- RLS 不照搬 Production 中過寬的 `authenticated` grants；以 RBAC permission + store_manager scope 重寫或包裝。
- DEV seed 只建立假員工與假門市，不複製正式員工資料。

### P1-B-3 Minimal Store Reference Seed

目的：

- DEV 需要更接近正式操作感的假門市。
- 不複製 Production 門市 rows。
- 可以使用正式 schema 欄位名稱與格式建立假資料，例如 `DEV001`、`DEV002`、`DEV003`、`DEV-HQ`。

規則：

- store names 必須明確為 DEV fake。
- 不使用正式地址、電話、主管姓名或營運資訊。
- seed 與 schema migration 分離。

## 7. RLS And Grants Strategy

Production schema-only 內有大量 legacy grants，例如 `GRANT ALL ... TO anon/authenticated`，以及部分 `USING (true)` policy。這些代表正式歷史狀態，不應未審查直接複製到 DEV。

P1-B 建議：

- Tables 可依 Production 欄位相容建立。
- RLS / grants 需採目前 DEV 安全標準重寫。
- `anon` 預設無 table grants。
- `authenticated` 只給必要 `SELECT` / 受控 DML。
- 寫入優先走 server-side guard 或 SECURITY DEFINER RPC。
- RLS scope：
  - admin/manage permission：可管理全域。
  - store_manager：只能讀/操作自己管理門市範圍。
  - ordinary user：只能讀自己的 profile / assignments / status。
- 不使用 service role 代替 authenticated user 驗證 RLS。

## 8. Migration Plan

不得修改已套用 migrations。所有 DB 修正都用 forward migration。

建議順序：

1. `general_affairs_core_rbac_reference_seed`
   - 補正式 permission reference。
   - 補 system roles / role_permissions baseline。
   - 不含 users / auth / production data。

2. `store_employee_compatibility_foundation`
   - 建立 `store_employees`。
   - 補 indexes、constraints、RLS、updated_at trigger。
   - 補與 profiles / stores / user_roles 的相容查詢 function，若必要。

3. `dev_fake_store_employee_seed`
   - DEV-only seed。
   - 建立假門市、假員工、假 user-role / store_manager mapping。
   - 必須另放 seed，不進 production migration。

4. 後續依功能拆分：
   - task assignment foundation
   - monthly staff status foundation
   - inspection foundation
   - inventory result analysis foundation
   - maintenance foundation
   - general affairs legacy vendor/category/region foundation

## 9. Test Plan

P1-B-1 RBAC reference：

- permission codes idempotent upsert。
- role_permissions 不重複。
- full admin effective permissions 全開。
- no_access 不取得新增 permissions。
- Navbar 依 effective permissions 顯示，而不是 role/profile/email 猜測。

P1-B-2 store_employees：

- `store_employees` exists / RLS enabled。
- FK to `stores` and `profiles`。
- `employment_type` constraint。
- store_manager 只能讀自己門市員工。
- admin/manage permission 可管理。
- 一般使用者不能枚舉所有員工。
- 使用者刪除不得因歷史 FK 直接炸出 PostgreSQL 原始錯誤；需友善阻擋或相容清理策略。

P1-B-3 DEV fake seed：

- 不含正式 email、正式員編、正式門市地址或電話。
- 可重跑。
- 可清理。
- 不套用 Production。

## 10. Rollback Plan

每個 forward migration 需有對應 rollback SQL 草案，但 DEV 執行 rollback 前仍需使用者批准。

Rollback 原則：

- 不 drop `auth`、`storage`、Supabase platform schema。
- 不修改已套用 migration history。
- 不刪除 Production-like schema 以外的 DEV 1A-1C 已驗收成果，除非該 rollback 明確屬於該 task。
- DEV fake seed cleanup 必須只清理 DEV prefix 或本輪 runId 資料。

## 11. Not In P1-B

本階段不做：

- Task 1C-3。
- 直接套用 Production schema dump。
- 複製 Production data rows。
- 建立正式 Auth users。
- 匯入正式員工、正式門市、工單、盤點、庫存、銷售、績效、附件或 audit logs。
- 一次建立 76 張缺表。
- 臨時關閉 RLS 或用 service role 讓 UI 看起來可用。

## 12. Recommended Next Minimal Task

**P1-B-1 RBAC Reference Seed Design Review**

先產出可審查 SQL 草案與 test SQL，不直接 push：

- `supabase/migration_rbac_reference_parity_seed.sql`
- `supabase/test_rbac_reference_parity_seed.sql`
- `supabase/rollback_rbac_reference_parity_seed.sql`

內容：

- 補齊程式碼與 Production policies 使用到的 permission codes。
- 建立 DEV-compatible system roles。
- DEV Full Admin role_permissions 全開。
- 不新增 Auth users。
- 不新增 Production data。
- 所有 seed idempotent。

