# DEV / Production Parity Audit

最後更新：2026-07-23

本文件記錄目前 DEV 測試區與 repository 中「正式菁英網功能結構」的差異盤點。此盤點只處理結構、功能入口、API、migration 與測試策略；不得用於複製 Production 營運資料。

## 1. 盤點範圍與安全邊界

本輪目標是確認 DEV 應如何逐步復刻正式區「功能與結構」，但不復刻正式區業務資料。

可以復刻到 DEV 的項目：

- Page routes、API routes、Server Actions、UI 操作流程。
- DB schema：tables、columns、constraints、indexes、sequences、views、functions / RPC、triggers、RLS、grants。
- Permission codes、system roles、role_permissions baseline。
- 必要 reference / master structure，例如分類、狀態、流程設定、feature availability。
- Storage bucket / policy 結構、edge function / cron 結構。
- DEV-only fake seed：測試門市、假員工、假設備、假料件、假庫存交易。

不得復刻到 DEV 的項目：

- 正式員工個資、Email、電話、帳號、密碼、session、token、JWT、key。
- 正式工單、維修照片、附件、設備紀錄、盤點、銷售、業績、獎金、庫存交易、調撥、申請、audit log。
- Production connection string 或完整 Project Ref。
- 任何會讓 DEV 混入正式營運資料的 snapshot。

## 2. 執行前 Guard 與 Migration 狀態

已執行並通過：

- App DEV Guard：`node scripts/verify-dev-supabase-environment.js`
- CLI DEV Guard：`node scripts/verify-dev-supabase-cli-environment.js`
- DEV Project Ref：`mjpd...mtqr`
- Production 候選：`odvksgucvfoaqrumpran`，未命中。

目前 7 筆 migration local / remote aligned：

| Timestamp | 狀態 |
| --- | --- |
| `20260722030244` | local / remote aligned |
| `20260722032048` | local / remote aligned |
| `20260722055852` | local / remote aligned |
| `20260722065952` | local / remote aligned |
| `20260722091526` | local / remote aligned |
| `20260722092849` | local / remote aligned |
| `20260722094917` | local / remote aligned |

本輪未執行 `db push`、`migration repair`、`db reset`、rollback、test SQL 或 Production 操作。

## 3. 證據來源

Repository 掃描：

- Pages：65 個 `app/**/page.tsx`。
- API routes：146 個 `app/**/route.ts`。
- 程式碼中 Supabase `.from()` 依賴：92 個名稱，其中部分為 Storage bucket。
- 程式碼中 `.rpc()` 依賴：15 個。
- 程式碼中 permission code 字串：約 100+ 個，涵蓋 RBAC、總務、盤點、月狀態、活動、藥師、門市、人員、跨部門等模組。
- Supabase SQL 檔：246 個。
- Middleware：`middleware.ts` 存在，但目前是 pass-through，註解明確表示 authentication checks 由 page components 自行處理。
- Edge Functions：本輪未發現 `supabase/functions/` 目錄或 Deno Edge Function source。
- Cron：本輪未發現可直接執行的 Supabase cron 設定檔；程式碼與 SQL 有 activity schedule / store relocation schedule 等業務排程資料表，不等同平台 cron。

DEV schema 擷取：

- `public` schema dump 成功，僅用於結構盤點，未讀取資料列。
- `storage` schema dump 成功，僅用於平台結構盤點，未讀取 storage object row data。
- `auth` schema dump 遇到 Supabase CLI 臨時登入角色認證失敗而停止；未重試、未要求密碼、未讀取 Auth 資料。

## 4. DEV 實際 Public Schema Inventory

目前 DEV `public` schema 已存在的 tables：

- `profiles`
- `roles`
- `permissions`
- `role_permissions`
- `user_roles`
- `stores`
- `store_managers`
- `ga_equipment_categories`
- `ga_facility_categories`
- `ga_part_categories`
- `ga_equipment_templates`
- `ga_equipment`
- `ga_facilities`
- `ga_parts`
- `ga_part_compatibilities`
- `ga_inventory_locations`
- `ga_inventory_location_parts`
- `ga_inventory_balances`
- `ga_inventory_transactions`

目前 DEV `public` functions / RPC 主要包含：

- RBAC：`has_permission`、`current_user_has_permission`、`get_user_permissions`
- Store scope：`current_user_manages_store`、`current_user_is_store_manager`
- DEV baseline：`handle_new_user`、`dev_bootstrap_touch_updated_at`
- GA category helpers：`ga_category_*`、`ga_active_category_path`、`ga_category_has_active_path`
- GA soft delete：equipment、equipment template、facility、part、part compatibility、inventory location、inventory location part
- GA validation triggers：equipment、template、facility、part、compatibility、inventory location、location part
- Inventory transaction core：`ga_next_inventory_transaction_no`、`ga_post_inventory_transaction`、`ga_prevent_inventory_transaction_mutation`

目前 DEV `public` sequence：

- `ga_inventory_transaction_no_seq`

目前 7 筆 aligned migrations 合併後的 schema inventory 摘要：

| 類型 | 數量 / 狀態 | 摘要 |
| --- | --- | --- |
| Tables | 19 | RBAC 6、stores/store_managers 2、GA category/master 7、inventory 4 |
| Columns / defaults | 已盤點 | 來源為 7 筆 aligned migrations；所有目前 DEV tables 均有 UUID PK 或 auth-linked PK，主要 system fields 使用 `now()` / `gen_random_uuid()` default |
| Generated columns | 未發現 | 目前 DEV public schema 未使用 generated columns |
| PK / FK / unique / check constraints | 已盤點 | RBAC unique、category tree FK、GA master FK、inventory balance/transaction check、idempotency、soft delete partial unique indexes |
| Indexes | 78 | 搜尋、scope、FK、partial unique、transaction query indexes |
| Sequences | 1 | `ga_inventory_transaction_no_seq`，已移除 anon/authenticated direct usage |
| Views / materialized views | 0 | 目前 DEV public schema 未建立 view/mview |
| Enum types | 1 | `ga_category_kind`：`equipment`、`facility`、`part` |
| Extensions | 4 | `pg_stat_statements`、`pgcrypto`、`supabase_vault`、`uuid-ossp` |
| RLS enabled | 19 tables | 目前 public tables 均啟用 RLS |
| Forced RLS | 0 | 未發現 FORCE ROW LEVEL SECURITY |
| Policies | 42 | RBAC self-read、stores scope、GA category/master、inventory locations/balances/transactions |
| Grants | 已盤點 | Inventory transaction sequence / helper / post RPC 已 forward fix；legacy GA helper grants 仍保留於目前 schema，後續 parity hardening 可另列任務 |

目前 DEV RLS：

- 上述 19 個 public tables 均已 `ENABLE ROW LEVEL SECURITY`。
- 主要 policies 覆蓋 RBAC self-read、store manager scope、GA categories、equipment、facilities、parts、inventory locations、inventory balances、inventory transactions。
- Inventory transactions 與 balances 目前只開 SELECT policy，不開 client direct write policy。

目前 DEV triggers：

- `trg_profiles_updated_at`
- `trg_roles_updated_at`
- `trg_stores_updated_at`
- GA category before write triggers
- Equipment / template / facility / part / compatibility validation triggers
- Inventory location / location part validation triggers
- `trg_ga_inventory_transactions_immutable`

Repository 中有、目前 DEV 尚未具備或尚未套用的 trigger 類型主要集中在 legacy 模組：

- inspection auto score / improvement triggers
- maintenance updated_at triggers
- campaign updated_at triggers
- pharmacist updated_at / sync triggers
- stockout status sync triggers
- product / acquisition updated_at triggers
- monthly bonus preservation / calculation triggers
- relationship member updated_at triggers

這些 trigger 不是本輪要補的內容；後續應跟隨各模組 schema parity migration 一起建立。

## 5. Storage 與 Auth 狀態

Storage schema 結構存在 Supabase 平台預設 tables/functions，例如 `storage.buckets`、`storage.objects`、`storage.s3_multipart_uploads`。本輪未盤點 bucket row data，也未確認正式區 bucket 清單。

Repository 內可辨識的 Storage bucket / policy 依賴：

- `maintenance-photos`：維修回報照片。
- `clinic-selfpay-screenshots`：門市自費毛利截圖。
- `pharmacist-fee-proofs`：藥師年費繳費證明。
- `inspection-photos`：巡店 / 盤點照片，SQL 中有註解與 policy 草案。
- 行銷部圖檔 bucket：來源於 `migration_campaign_department_publish_storage.sql`，需後續確認實際 bucket 名稱與 policy。

這些 bucket 屬於 DEV / Production parity 的結構項目，但 bucket 內物件與照片不得從 Production 複製到 DEV。

Auth schema 本輪未完成 dump。原因是 CLI 連線到 `auth` schema dump 時出現臨時登入角色認證失敗；已停止，未重試。後續若要做完整 Production/DEV auth 設定 parity，應由使用者提供不含帳號資料的 Auth 設定摘要或 schema-only dump，不得複製 `auth.users` rows。

## 5.1 Middleware / Edge / Cron 結構

目前 `middleware.ts`：

- 存在於 repo root。
- 目前回傳 `NextResponse.next()`，沒有在 middleware 層執行 auth / permission enforcement。
- matcher 排除 `_next/static`、`_next/image`、favicon 與常見圖片檔。
- 因 middleware 是 pass-through，安全控制必須由 page / API / Server Action / RLS 各自負責。

目前 Edge Functions：

- 本輪未發現 `supabase/functions/`。
- 未發現 `Deno.serve` source。
- 若 Production 有 Edge Functions，repository 目前不足以證明，需要使用者提供 Edge Function list 與設定摘要，不含 secrets。

目前 Cron / scheduled jobs：

- 本輪未發現 Supabase platform cron 設定。
- Repository 有多個「業務排程」概念，例如 `campaign_schedules`、`store_relocation_schedules`，這些應歸入 DB schema parity，不等於平台 cron。
- 若 Production 有 cron jobs，需要使用者提供 job 名稱、schedule、target function/RPC 摘要，不含 secrets。

## 6. Repository Expected Schema 與 DEV 缺口

Repository SQL 與程式碼顯示正式網還依賴大量尚未在 DEV public schema 存在的 legacy tables。重要缺口如下：

- 任務派發：`templates`、`assignments`、`assignment_collaborators`、`logs`
- 使用者 / 門市相容資料：`store_employees`
- 月狀態 / 獎金 / 績效：`monthly_staff_status`、`monthly_store_summary`、`monthly_performance_details`、`monthly_bonus_records`、`store_performance`、`store_performance_thresholds`
- 盤點與改善：`inspection_masters`、`inspection_results`、`inspection_templates`、`inspection_improvements`、`inspection_on_duty_staff`、`inspection_bonus_config`、`inspection_grade_mapping`
- 盤點結果分析：`inventory_result_batches`、`inventory_result_items`、`inventory_result_settings`
- 維修：`maintenance_requests`、`maintenance_categories`、`maintenance_photos`、`maintenance_updates`、`maintenance_update_photos`、`maintenance_progress_stages`、`maintenance_ticket_events`
- 總務尚未建置：`ga_vendors`、`ga_service_categories`、`ga_service_regions`
- 活動 / 行銷：`campaigns`、`campaign_schedules`、`campaign_store_details`、`campaign_checklist_items`、`campaign_checklist_completions`、`campaign_support_requests`、`campaign_support_staff`、`campaign_equipment_trips`、`campaign_department_publish`
- 藥師：`pharmacist_profiles`、`pharmacist_annual_master`、`pharmacist_annual_fees`、`pharmacist_monthly_snapshot`、相關 lock / sync log
- 門市自費毛利：`clinic_selfpay_claim_batches`、`clinic_selfpay_claim_items`、`clinic_selfpay_price_entries`、`clinic_selfpay_price_month_closures`
- 商品主檔：`products_master`、`product_barcodes`、`acquisition_scans`、`acquisition_unmatched`
- 關係會員 / 銷售：`relationship_members`、`relationship_sales_imports`、`relationship_sales_details`
- 缺貨 / 跨部門：`stockout_reports`、`stockout_responses`、`stockout_product_responses`、`stockout_product_response_history`
- 人事異動：`employee_movement_history`、`store_transfer_requests`、`store_relocation_history`
- 其他獎金 / 費用：`meal_allowance_records`、`spring_festival_bonus`、`support_staff_bonus`、`talent_cultivation_bonus`

Repository RPC 依賴中，DEV 目前缺少：

- `check_user_permission`
- `get_all_employees_for_rbac`

其餘總務 1A-1C 近期建立的 RPC 多數已在 DEV 存在。

## 6.1 Permission Reference Parity

本輪只讀查詢 DEV `public.permissions` reference data，未讀取任何業務資料或秘密。

目前 DEV active permission codes 共 20 個，全部集中在總務 1A-1C：

- `general_affairs.service_center.access`
- `general_affairs.equipment_category.view`
- `general_affairs.equipment_category.manage`
- `general_affairs.facility_category.view`
- `general_affairs.facility_category.manage`
- `general_affairs.part_category.view`
- `general_affairs.part_category.manage`
- `general_affairs.equipment_template.view`
- `general_affairs.equipment_template.manage`
- `general_affairs.equipment.view`
- `general_affairs.equipment.manage`
- `general_affairs.facility.view`
- `general_affairs.facility.manage`
- `general_affairs.part.view`
- `general_affairs.part.manage`
- `general_affairs.inventory_location.view`
- `general_affairs.inventory_location.manage`
- `general_affairs.inventory_balance.view`
- `general_affairs.inventory_transaction.view`
- `general_affairs.inventory_transaction.manage`

Repository 中可辨識的 permission-like codes 約 165 個；排除 SQL 內部 `request.jwt.claim.sub` 等非權限字串後，DEV 尚缺約 145 個正式功能 permission reference。依 prefix 彙總：

| Prefix | DEV 缺少數量 | 代表模組 |
| --- | ---: | --- |
| `activity.*` | 19 | 活動 / 行銷 / 排程 |
| `cross_dept.*` | 8 | 維修、商品主檔、缺貨 |
| `employee.*` | 16 | 員工、異動、調店 |
| `general_affairs.*` | 1 | `general_affairs.service_center.force_close` |
| `home.*` | 1 | 首頁獎金明細 |
| `inspection.*` | 5 | 盤點 / 改善 |
| `inspection_type.*` | 1 | 巡檢類型相容權限 |
| `inventory.*` | 17 | 舊盤點管理 / 盤點結果分析 |
| `monthly.*` | 24 | 每月人員狀態 / 匯出 / 津貼 |
| `performance.*` | 2 | 績效獎金 |
| `pharmacist.*` | 4 | 藥師管理 |
| `role.*` | 9 | 角色權限管理 |
| `store.*` | 15 | 門市、店長、督導、自費毛利 |
| `supervisor.*` | 3 | 督導指派 |
| `task.*` | 14 | 任務派發 |
| `user.*` | 5 | 使用者管理 |

結論：

- DEV RBAC schema 存在，但 system reference permissions 尚未與正式網完整對齊。
- 這是 P1 gap，會造成 DEV 測試區即使有頁面與 API，也無法完整照正式權限流程授權。
- 下一步 P1 應先設計 `permissions` / `roles` / `role_permissions` system reference seed，且必須與 DEV demo users / demo roles 分離。
- Production 可套用經審核的 system permission seed；DEV demo role mapping 不得套用到 Production。

## 7. 功能差異矩陣

狀態說明：

- `COMPLETE`：page + API + schema + RLS + RBAC + reference/seed + tests 已到位。
- `PARTIAL`：部分層已到位，但仍缺 UI/API/schema/test/seed 中任一關鍵層。
- `UI_ONLY`：畫面存在，但 DEV schema/API 不完整。
- `API_ONLY`：API 存在，但 DB 或 UI 未完整。
- `DB_ONLY`：DB 已建立，但功能入口或 API/UI 不完整。
- `MISSING`：DEV 缺核心 schema 或功能不可用。
- `TEMPORARILY_DISABLED`：為避免誤操作或原始 DB error，已用 availability guard 擋住。
- `UNKNOWN`：repo 或 DEV 證據不足。

| 模組 | Page Route | API Route | DB Tables | Functions/RPC | RLS | Permission Codes | Reference Data | DEV 狀態 | Repository 正式結構狀態 | 缺口 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Auth / Profile | `/login`, `/register`, `/forgot-password`, `/reset-password`, `/auth/callback` | `/auth/callback`, `/api/user/profile`, `/api/admin/reset-password` | `auth.users`, `profiles` | `handle_new_user` | profiles self-read | `user.*` | DEV Auth users | PARTIAL | 存在 | Auth schema 未完整盤點；不得複製 auth.users |
| RBAC 管理 | `/admin/users`, `/admin/roles`, `/admin/roles/[id]` | `/api/roles/*`, `/api/admin/users/[id]/rbac`, `/api/permissions/*` | `roles`, `permissions`, `role_permissions`, `user_roles`, `profiles` | `has_permission`, `get_user_permissions` | 已有 | `role.*`, `user.*` | DEV Full Admin seed | PARTIAL | 存在 | 使用者 RBAC 詳細檢視仍需完整人工驗收 |
| 門市 / 管理範圍 | `/admin/stores`, `/admin/store-managers`, `/admin/supervisors` | `/api/store-managers/*`, `/api/supervisors/*`, `/api/stores-with-supervisors` | `stores`, `store_managers`, `store_employees` | `current_user_manages_store` | stores/store_managers 已有 | `store.*` | DEV001/DEV002 | PARTIAL | 存在 | `store_employees` 缺；測試門市可增加假資料，不可直接複製正式資料 |
| 任務派發 | `/dashboard`, `/my-tasks`, `/assignment/[id]`, `/admin/templates`, `/admin/create`, `/admin/edit/[id]` | 部分 Server Actions / API | `templates`, `assignments`, `assignment_collaborators`, `logs` | repo 有 legacy helpers | UNKNOWN | `task.*` | 無 | MISSING | 存在 | DEV 缺核心 tables |
| 月狀態 / 匯出 | `/monthly-status`, `/monthly-status/edit/[id]`, `/admin/export-monthly-status` | `/api/monthly-*`, `/api/export-monthly-status/*` | `monthly_staff_status`, `monthly_store_summary`, `monthly_performance_details`, bonus tables | repo SQL functions | UNKNOWN | `monthly.*` | 無 | MISSING | 存在 | DEV 缺 schema 與 reference seed |
| 績效 / 獎金 | `/admin/performance` | `/api/performance-*`, `/api/meal-allowance`, `/api/support-bonus`, `/api/talent-cultivation` | `store_performance`, `store_performance_thresholds`, bonus tables | repo functions | UNKNOWN | `performance.*`, `home.*` | 無 | MISSING | 存在 | DEV 缺 schema |
| 盤點與改善 | `/inspection`, `/inspection/*` | `/api/inspection-*` | `inspection_*` | repo functions | UNKNOWN | `inspection.*` | 無 | MISSING | 存在 | DEV 缺 schema；正式刪使用者 FK 保護已修 |
| 盤點結果分析報表 | `/inventory` | `/api/inventory/result-analysis` | `inventory_result_batches`, `inventory_result_items`, `inventory_result_settings` | 無明確 DEV RPC | UNKNOWN | `inventory.result_analysis.*` | 無 | MISSING | 存在 | DEV 缺 schema；正式區功能另有近期篩選修正 |
| 維修模組 | `/cross-dept/maintenance`, GA service home references | `/api/maintenance-*` | `maintenance_*` | repo SQL | UNKNOWN | `cross_dept.maintenance.*` | 無 | TEMPORARILY_DISABLED | 存在 | DEV 缺 migration；目前以 availability guard 避免 raw error |
| 總務服務中心入口 | `/general-affairs` | `/api/general-affairs/access` | GA category tables + inventory tables | `current_user_has_permission` | 依各子模組 | `general_affairs.service_center.access` | DEV seed | PARTIAL | 存在 | 入口已收斂；未建置模組不得顯示可操作入口 |
| 總務服務分類 / 區域 / 廠商 | GA home legacy actions | 未完整 | `ga_service_categories`, `ga_service_regions`, `ga_vendors` | 未在 DEV | UNKNOWN | 可能為 GA 權限 | 無 | TEMPORARILY_DISABLED | repo 有依賴 | DEV 缺 schema，不能臨時建空殼 |
| 總務設備 | `/general-affairs/equipment`, `/general-affairs/equipment/templates` | `/api/general-affairs/equipment*` | `ga_equipment`, `ga_equipment_templates`, `ga_equipment_categories` | soft delete / validate | 已有 | equipment / template permissions | DEV 1B seed | TEMPORARILY_DISABLED | 近期實作存在 | DB/API 已有，頁面目前因整體 GA 收斂暫停開放 |
| 總務設施 | `/general-affairs/facilities` | `/api/general-affairs/facilities*` | `ga_facilities`, `ga_facility_categories` | soft delete / validate | 已有 | facility permissions | DEV 1B seed | TEMPORARILY_DISABLED | 近期實作存在 | DB/API 已有，頁面目前暫停開放 |
| 總務料件 | `/general-affairs/parts` | `/api/general-affairs/parts*` | `ga_parts`, `ga_part_compatibilities`, `ga_part_categories` | soft delete / validate | 已有 | part permissions | DEV 1B seed | TEMPORARILY_DISABLED | 近期實作存在 | DB/API 已有，頁面目前暫停開放；庫存 options 仍依 part.view |
| 庫存位置 | `/general-affairs/inventory/locations` | `/api/general-affairs/inventory/locations*` | `ga_inventory_locations`, `ga_inventory_location_parts` | soft delete / validate | 已有 | inventory_location.* | DEV fake data | COMPLETE | 近期實作存在 | 無阻擋 |
| 庫存交易 / 餘額 | `/general-affairs/inventory` | `/api/general-affairs/inventory/*` | `ga_inventory_balances`, `ga_inventory_transactions` | `ga_post_inventory_transaction` | 已有 | inventory_balance.view, inventory_transaction.* | DEV fake transactions | COMPLETE | 近期實作存在 | Task 1C-3 未開始 |
| 活動 / 行銷 | `/activity-management`, `/admin/activity-management/*` | `/api/campaign-*` | `campaign*`, `event_dates`, `store_activity_settings` | repo SQL helpers | UNKNOWN | `activity.*` | 無 | MISSING | 存在 | DEV 缺 schema |
| 藥師管理 | `/admin/pharmacist-management` | `/api/pharmacist-*` | `pharmacist_*` | repo functions | UNKNOWN | `pharmacist.*` | 無 | MISSING | 存在 | DEV 缺 schema / storage bucket parity |
| 門市自費毛利 | `/store/clinic-selfpay-margin` | `/api/clinic-selfpay/*` | `clinic_selfpay_*` | repo helpers | UNKNOWN | `store.clinic_selfpay.*` | 無 | MISSING | 存在 | DEV 缺 schema / storage bucket parity |
| 商品主檔 | `/cross-dept/products-master` | `/api/products-master` | `products_master`, `product_barcodes`, `acquisition_*` | 無明確 DEV RPC | UNKNOWN | `store.products_master.manage` | 無 | MISSING | 存在 | DEV 缺 schema |
| 關係會員 | `/store/relationship-members` | `/api/relationship-*` | `relationship_*` | 無明確 DEV RPC | UNKNOWN | `relationship_member.*` | 無 | MISSING | 存在 | DEV 缺 schema |
| 缺貨 / 跨部門 | `/cross-dept/merchandise` | `/api/stockout-*` | `stockout_*` | `sync_stockout_report_status` | UNKNOWN | `cross_dept.stockout.*` | 無 | MISSING | 存在 | DEV 缺 schema |
| 人事異動 / 調店 | admin store employee pages | `/api/employee-movements/*`, `/api/store-transfer-requests/*` | `employee_movement_history`, `store_transfer_requests`, relocation tables | repo triggers | UNKNOWN | `employee.*` | 無 | MISSING | 存在 | DEV 缺 schema |

## 8. Reference Data 分類

### A. 可進正式與 DEV 的 system reference

- Permission codes。
- System roles 與 role_permissions baseline。
- 狀態 enum / check value。
- 分類類型、流程狀態、feature availability 設定。
- 無個資、無營運資料的 lookup data。

### B. DEV-only demo master data

- DEV 測試門市，需明確 DEV prefix 或假資料命名。
- 假員工 / 假部門 / 假職稱 / 假管理範圍。
- 假設備、假設施、假料件、假廠商、假庫存位置。
- DEV 中產生的假交易、假工單、假盤點。

### C. 不得複製 Production 的資料

- Auth users、正式 Email、員編對應個資、電話。
- 正式門市機密營運資料、工單、照片、附件。
- 正式庫存、盤點、調撥、銷售、獎金、業績。
- audit log、session、token、key、password。

### D. 需要人工確認後才可安全建立的資料

- 正式門市名稱是否可作為 DEV 假主檔使用。
- 若要提高操作真實感，建議使用「相似但非正式原樣」的 DEV 門市清單，例如 DEV 台北門市一、DEV 台中門市二。
- 若使用真實門市名稱也必須確認不含敏感營運資訊，且不得附帶正式人員、電話、業績或庫存。

## 9. Gap 分級

### P0：會造成安全或方向錯誤

- Production/DEV 結構差異尚未完整標準化，不能直接把正式資料倒入 DEV。
- Auth schema 與 Supabase 設定未完整盤點，不能宣稱 parity complete。
- 任何缺表錯誤不得直接顯示給一般使用者。
- DEV 不得因測試方便使用 service role 繞過 RLS/RPC 驗收。

### P1：阻擋正式功能在 DEV 可測

- 任務派發核心 tables。
- 使用者 / 門市正式相容 tables：特別是 `store_employees`。
- 維修、盤點、月狀態、盤點結果分析、總務 vendor/service tables。
- RBAC 詳細檢視與正式操作流程需完成驗收。

### P2：影響操作真實感與跨模組串接

- DEV fake stores / employees / departments / vendors / equipment / parts seed 不完整。
- Storage bucket / policy parity 未完整確認。
- Legacy module RLS / grants 未被 DEV catalog 驗證。

### P3：優化與整理

- 建立自動 parity inventory script。
- 整理 deprecated SQL、backup tables、legacy compatibility paths。
- 將 availability guard 改為 feature flag / module availability table。

## 10. 建議分階段 Roadmap

不得建立一個超大 migration。建議以依賴順序拆分：

1. **P1 Core Reference / RBAC / Store Compatibility**
   - 補齊 `store_employees`、必要使用者與門市相容 schema。
   - 建立安全 system seed 與 DEV fake master seed。
   - 驗證 `/admin/users`、`/admin/roles`、store manager/supervisor flows。

2. **P2 Task Assignment Core**
   - 補齊 `templates`、`assignments`、`assignment_collaborators`、`logs`。
   - 先確保首頁、派發任務、我的任務可在 DEV 真正寫入測試資料。

3. **P3 Maintenance + GA Vendor / Service Foundation**
   - 補齊 `maintenance_*`、`ga_vendors`、`ga_service_categories`、`ga_service_regions`。
   - 移除對應 availability guard，改為正式 DEV 功能。

4. **P4 Inspection + Inventory Result Analysis**
   - 補齊 `inspection_*` 與 `inventory_result_*`。
   - 確保店長 / 督導 scope 測試在 DEV 可跑。

5. **P5 Monthly / Performance / Pharmacist / Clinic**
   - 依模組拆 migration 與 seed。
   - 不複製正式獎金、業績、藥師資料。

6. **P6 Activity / Products / Relationship / Stockout / Employee Movement**
   - 補齊活動、商品主檔、關係會員、缺貨、人事異動。
   - 每個模組各自建立 test SQL / dynamic tests。

7. **P7 Task 1C-3**
   - 只有在使用者批准後才開始。
   - 若 Task 1C-3 依賴前述 legacy modules，需先完成必要 schema parity。

## 11. Migration 與 Seed 策略

每個 gap 應拆成：

- `supabase/migrations/<timestamp>_<module>_schema.sql`
- `supabase/<module>_test.sql`
- `supabase/<module>_rollback.sql`
- `supabase/dev_seed/<module>_dev_demo_seed.sql` 或 scripts seed

原則：

- 已套用 migration 不可修改。
- 發現 DB 問題用 forward fix。
- Schema migration 不放 DEV demo data。
- Production 可套 schema 與 system reference seed，不可套 DEV demo seed。
- DEV demo seed 必須 idempotent、可重跑、DEV-prefix、不可覆寫人工輸入資料。
- 所有 seed 前仍需 guards。

## 12. Production Rollout Strategy

Production 不應接收 DEV demo data。

建議流程：

1. 在 DEV 完成 schema migration、test SQL、RLS/API/UI 驗收。
2. migration local/remote DEV 對齊後，產出 release note。
3. 對 Production 只執行經審核的 schema migration 與 system reference seed。
4. 不執行 DEV seed。
5. Production rollout 前先備份、確認 migration list、dry-run、人工批准。
6. 上線後只驗證 schema / permission / smoke test，不導入 DEV 假資料。

## 13. 需要使用者提供或確認的資訊

若要達到真正 DEV / Production parity，repository 目前仍不足以完全證明 Production 現況。需要下列不含資料列與不含秘密的資訊：

- Production schema-only dump：public schema tables/functions/triggers/RLS/policies/grants。
- Production migration history。
- Storage bucket names 與 policies，不能包含 object rows。
- Edge functions / cron / webhook 設定摘要。
- Auth settings 摘要，不含 `auth.users` rows、不含 password/token/key。
- 正式門市名稱是否允許作為 DEV fake seed 的顯示名稱；若不允許，改用相似假名稱。

## 14. 本輪結論

DEV 目前不是正式菁英網的完整結構復刻；它目前是 RBAC + stores + 總務 1A-1C 已完成部分的 DEV。正式網其他 legacy 模組仍大量缺 schema，因此才會出現「畫面存在但 DEV 缺表」或必須 availability guard 的狀況。

建議下一個最小任務：

**P1 Core Reference / RBAC / Store Compatibility schema parity 設計。**

這個任務應先產出 schema-only 設計與 migration 草案，包含 `store_employees` 與任務派發依賴檢查；不得直接倒入 Production 資料，也不得開始 Task 1C-3。

## 15. 完成回報對照

| # | 要求 | 結果 |
| --- | --- | --- |
| 1 | Guard / migration 狀態 | App Guard passed、CLI Guard passed、7 筆 migration local / remote aligned |
| 2 | Repository 功能總數與模組清單 | 已盤點 65 pages、146 API routes，矩陣列出系統管理、總務、任務、月狀態、盤點、維修、活動、藥師、商品、關係會員等模組 |
| 3 | DEV table / function / policy inventory | 已列出 19 tables、主要 functions/RPC、sequence、RLS、policies、triggers、indexes/constraints 摘要；auth schema 因 CLI 認證失敗列為需補證據 |
| 4 | Repository 預期 schema inventory | 已從 SQL、route、`.from()`、`.rpc()`、permission strings 建立預期 schema 與缺口清單 |
| 5 | 缺少 tables | 已列出 legacy 缺表：`store_employees`、`maintenance_*`、`inspection_*`、`inventory_result_*`、`ga_vendors` 等 |
| 6 | 缺少 functions / triggers | 已列出缺少 `check_user_permission`、`get_all_employees_for_rbac` 與 legacy triggers 類型 |
| 7 | 缺少 RLS / grants | 缺表模組因 schema 不存在，RLS / grants 亦未能在 DEV catalog 驗證；inventory grants 已修正 |
| 8 | 缺少 permissions | DEV active permissions 目前 20 個；repo 約 165 個 permission-like codes，約 145 個正式功能 permission reference 尚未 seed 到 DEV |
| 9 | 缺少 reference data | 已分類為 system reference、DEV demo master、禁止匯入資料 |
| 10 | UI-only / API-only / DB-only 功能 | 矩陣標示 MISSING / PARTIAL / TEMPORARILY_DISABLED；GA equipment/facility/parts 屬 DB/API 有但頁面暫停開放 |
| 11 | Production 結構是否可完全從 repository 推導 | 不可完全推導；需要 schema-only dump、storage/auth/edge/cron 設定摘要 |
| 12 | 是否需要 schema-only dump | 是，需要 public schema、RLS、grants、functions、storage/auth 設定摘要；不需要資料列 |
| 13 | 不可複製的資料分類 | 已列出 Auth/PII/工單/庫存/盤點/銷售/附件/audit logs 等 |
| 14 | 建議 safe seed | System reference seed + DEV demo master data seed，嚴格分離 |
| 15 | P0/P1/P2/P3 缺口 | 已分級列出安全方向、功能阻擋、操作真實感、測試優化 |
| 16 | 建議 Parity Roadmap | P1 Core Reference / RBAC / Store Compatibility 到 P7 Task 1C-3 |
| 17 | 建議 migration 數量與順序 | 依模組拆小 migration；先 P1 core，再 task、maintenance/vendor、inspection、monthly/performance、activity 等 |
| 18 | DEV demo seed 策略 | DEV-prefix、idempotent、可重跑、不覆寫人工 DEV 資料、不進 Production |
| 19 | 未來 Production rollout 策略 | DEV 驗收後 release note、Production dry-run、backup/rollback plan、schema/system seed only |
| 20 | Task 1C-3 應何時恢復 | 使用者批准後，且必要前置 parity 不再阻擋時才恢復 |
| 21 | 風險 | Auth schema 未完整盤點、Production 結構不可完全從 repo 證明、legacy 模組缺表多 |
| 22 | 需要使用者決策事項 | 是否提供 Production schema-only dump、正式門市名稱是否可用於 DEV fake seed、P1 優先範圍 |
| 23 | 文件更新結果 | 已更新 `DEV-RBAC-HANDOFF.md`、`CURRENT-DEV-STATUS.md`、`DEV-PRODUCTION-PARITY-AUDIT.md`、Copilot 永久規則 |
