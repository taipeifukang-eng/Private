# DEV / Production Full-System Parity Audit

最後更新：2026-07-23

## 1. Scope And Rules

本文件是 Project P0「DEV / Production 全系統功能與 Schema Parity Audit」的交接文件。這次盤點的範圍是整個富康菁英業務網，不只總務服務中心，也不只 inventory / maintenance。

目標狀態：

- Production 與 DEV 使用同一套 application codebase。
- Production 與 DEV 應維持相同的完整系統功能、Schema、API contract、RLS、grants、RBAC permission code 與 workflow。
- 環境差異只允許出現在 Supabase project、環境變數、Auth users、實際 Storage files、Production 營運資料、DEV 假資料 / 驗收資料。
- DEV 可以重建 Production 結構，但不得複製 Production 已寫入的資料。

禁止複製到 DEV 的 Production 資料：

- 正式員工個資、帳號、密碼、JWT、session、token、API key、service role key。
- 正式工單、任務、盤點、庫存、銷售、績效、獎金、附件、照片、audit logs。
- 任何可回推出正式人員、門市營運、交易或客戶狀態的資料。

允許在 DEV 建立：

- 與 Production 相同的 schema、functions、triggers、RLS、grants、permission reference。
- 非敏感 system reference seed。
- 使用假 Email / 假姓名 / 假門市 / 假料件 / 假工單 / 假庫存交易的 demo seed。

本輪只做盤點與文件，不建立 migration、不修改 DB schema、不操作 Production、不開始 Task 1C-3。

## 2. Environment And Migration State

| Item | Current State |
| --- | --- |
| Project | 富康菁英業務網 |
| Stack | Next.js 14 App Router, TypeScript, Supabase Auth/Postgres/Storage, RBAC |
| DEV Project Ref | `mjpd...mtqr` |
| Production candidate Ref | `odvksgucvfoaqrumpran` |
| App Guard | `scripts/verify-dev-supabase-environment.js` |
| CLI Guard | `scripts/verify-dev-supabase-cli-environment.js` |
| Required DEV flags | `ALLOW_DEV_DATABASE_OPERATIONS=true`, `ALLOW_SUPABASE_CLI_REMOTE_OPERATIONS=true` |
| DB password handling | only hidden terminal input or temporary PowerShell `SUPABASE_DB_PASSWORD`; clear immediately after command |

Current DEV migration history is local / remote aligned:

| Version | Purpose | State |
| --- | --- | --- |
| `20260722030244` | DEV schema baseline | Applied to DEV, aligned |
| `20260722032048` | Task 1C-1 inventory locations | Applied to DEV, aligned |
| `20260722055852` | Fix inventory location cascade deletion reason | Applied to DEV, aligned |
| `20260722065952` | Task 1C-2B inventory transactions foundation | Applied to DEV, aligned |
| `20260722091526` | Revoke inventory transaction sequence direct grants | Applied to DEV, aligned |
| `20260722092849` | Restrict inventory transaction function EXECUTE grants | Applied to DEV, aligned |
| `20260722094917` | Fix inventory balance UPSERT conflict ambiguity | Applied to DEV, aligned |

Rules:

- Do not modify any applied migration.
- DB fixes must be forward migrations.
- Do not run `migration repair`, `db reset`, rollback, or direct remote schema patches unless explicitly approved for that exact operation.
- `db push` must always be preceded by both DEV guards, `migration list`, and `db push --dry-run`.

## 3. Evidence Collected From Repository

Repository scan results:

| Evidence | Count / Result |
| --- | --- |
| `app/**/page.tsx` page routes | 65 |
| `app/**/layout.tsx` layout routes | 1 |
| `app/**/route.ts` API route files | 146 |
| `.from()` table / bucket references | 92 |
| `.rpc()` references | 15 |
| Supabase SQL files | 246 |
| Storage bucket references in app code | `clinic-selfpay-screenshots`; SQL / API also references maintenance and pharmacist proof buckets |
| Edge functions | no `supabase/functions` directory found in repository scan |
| Middleware | `middleware.ts` currently passes through; auth is handled in pages / actions / API |
| DEV active permissions | 20, all from General Affairs 1A-1C |
| Repo permission-like references | about 165 meaningful permission references; most non-General-Affairs references are not seeded in DEV |

Important caveat:

- This audit is repo-confirmed for code and checked DEV state, but cannot fully prove Production schema parity without a Production schema-only dump. No Production credentials or data are requested in chat.

## 4. Full Module Inventory

| Module | Actual Routes / Surfaces | Primary DB Dependencies | DEV Status |
| --- | --- | --- | --- |
| Auth / profile | `/login`, `/register`, `/forgot-password`, `/reset-password`, `/auth/callback`, `app/auth/actions.ts` | `auth.users`, `profiles`, RBAC tables | PARTIAL: DEV auth/profile works; full Production Auth metadata / provider settings need schema/config evidence |
| RBAC admin | `/admin/users`, `/admin/roles`, `/admin/roles/[id]`, `/api/roles/*`, `/api/admin/users/[id]/rbac`, `/api/permissions/*` | `roles`, `permissions`, `role_permissions`, `user_roles`, `profiles`, `store_managers`, optional `store_employees` | PARTIAL: core schema exists; DEV lacks most Production permission reference seed |
| Task / assignment | `/`, `/dashboard`, `/my-tasks`, `/assignment/[id]`, `/admin/create`, `/admin/edit/[id]`, `/admin/assign/[id]`, `/admin/templates`, `/admin/template/[id]`, `/admin/archived` | `templates`, `assignments`, `assignment_collaborators`, `logs` | DEV_MISSING / UNKNOWN: repo has SQL and code, not in current DEV baseline |
| Store / personnel | `/admin/stores*`, `/admin/store-managers`, `/admin/supervisors`, `/admin/employee-management`, `/admin/import-employees`, `/store/*` | `stores`, `store_managers`, `store_employees`, `employee_movement_history`, `store_relocation_history`, supervisor tables | PARTIAL: `stores` and `store_managers` exist; `store_employees` and broader personnel compatibility missing in DEV |
| Monthly / performance / bonus | `/monthly-status`, `/monthly-release`, `/admin/export-monthly-status`, `/admin/performance`, many export APIs | `monthly_*`, `meal_allowance_records`, `store_performance*`, `spring_festival_bonus`, `support_staff_bonus`, `talent_cultivation_bonus` | DEV_MISSING / UNKNOWN |
| Inspection / improvements | `/inspection*`, `/api/inspection*` | `inspection_*`, `inspection_improvements`, `inspection_bonus_config`, storage `inspection-photos` | DEV_MISSING / UNKNOWN; Production deletion FK issue proves Production has historical refs |
| Inventory result analysis | `/inventory`, `/api/inventory/result-analysis` | `inventory_result_batches`, `inventory_result_items`, `inventory_result_settings` | DEV_MISSING / UNKNOWN |
| General Affairs service center | `/general-affairs` | GA category/master/inventory tables; vendor/service/maintenance dependencies | PARTIAL: entry and completed modules guarded; unbuilt modules protected |
| GA categories / equipment / facilities / parts | `/general-affairs/equipment`, `/equipment/templates`, `/facilities`, `/parts` | `ga_equipment_categories`, `ga_facility_categories`, `ga_part_categories`, `ga_equipment_templates`, `ga_equipment`, `ga_facilities`, `ga_parts`, `ga_part_compatibilities` | MATCH for Task 1A and 1B DEV-completed structure |
| GA inventory 1C | `/general-affairs/inventory`, `/general-affairs/inventory/locations` | `ga_inventory_locations`, `ga_inventory_location_parts`, `ga_inventory_balances`, `ga_inventory_transactions`, RPC | MATCH for Task 1C-1 / 1C-2B / 1C-2C verified scope |
| Maintenance / cross-dept | `/cross-dept/maintenance`, `/api/maintenance-*` | `maintenance_*`, `maintenance-photos`, optional `ga_vendors` | DEV_MISSING / guarded |
| Activity / campaign | `/activity-management`, `/activity-view/[id]`, `/admin/activity-management*`, `/api/campaign*` | `campaign_*`, `activity.*` permissions | DEV_MISSING / UNKNOWN |
| Pharmacist | `/admin/pharmacist-management`, `/api/pharmacist-*` | `pharmacist_*`, storage `pharmacist-fee-proofs` | DEV_MISSING / UNKNOWN |
| Clinic self-pay | `/store/clinic-selfpay-margin`, `/api/clinic-selfpay/*` | `clinic_selfpay_*`, storage `clinic-selfpay-screenshots` | DEV_MISSING / UNKNOWN |
| Products / acquisition | `/cross-dept/products-master`, `/api/products-master` | `products_master`, `product_barcodes`, `acquisition_*` | DEV_MISSING / UNKNOWN |
| Relationship members / sales | `/store/relationship-members`, `/api/relationship-*` | `relationship_members`, `relationship_sales_*` | DEV_MISSING / UNKNOWN |
| Stockout / transfer | `/api/stockout-*`, `/api/store-transfer-requests*` | `stockout_*`, `store_transfer_requests` | DEV_MISSING / UNKNOWN |

## 5. Page Route Matrix

| Module | Page Route | Component | Permission | API Dependencies | DB Dependencies | DEV Status |
| --- | --- | --- | --- | --- | --- | --- |
| Home | `/` | `app/page.tsx` | mixed legacy + RBAC | task/user APIs | `profiles`, `assignments`, `templates`, `logs` | PARTIAL |
| Auth | `/login`, `/register`, `/forgot-password`, `/reset-password` | `app/*/page.tsx` | Auth state | auth actions | `auth.users`, `profiles` | PARTIAL |
| Dashboard / tasks | `/dashboard`, `/my-tasks`, `/assignment/[id]` | app pages | `task.*` / legacy role | task APIs/actions | `assignments`, `templates`, `logs` | DEV_MISSING |
| Admin task management | `/admin/create`, `/admin/edit/[id]`, `/admin/assign/[id]`, `/admin/templates`, `/admin/template/[id]`, `/admin/archived` | app/admin pages | `task.*` / legacy role | task actions | `assignments`, `templates`, `assignment_collaborators` | DEV_MISSING |
| RBAC admin | `/admin/users`, `/admin/roles`, `/admin/roles/[id]` | admin pages | `user.*`, `role.*` | `/api/roles/*`, `/api/admin/users/[id]/rbac` | RBAC + profiles | PARTIAL |
| Store admin | `/admin/stores`, `/admin/stores/create`, `/admin/stores/[id]/edit`, `/admin/stores/[id]/clone` | admin pages | `store.*` | store actions/APIs | `stores`, `store_employees`, relocation tables | PARTIAL |
| Employee / supervisor | `/admin/employee-management`, `/admin/store-managers`, `/admin/supervisors`, `/admin/import-employees` | admin pages | `employee.*`, `store.manager.*`, `supervisor.*` | employee/store-manager/supervisor APIs | `profiles`, `store_managers`, `store_employees`, movement tables | PARTIAL |
| Monthly / performance | `/monthly-status`, `/monthly-status/edit/[id]`, `/monthly-release`, `/admin/export-monthly-status`, `/admin/performance` | monthly/admin pages | `monthly.*`, `performance.*` | monthly/performance/export APIs | `monthly_*`, `store_performance*`, bonus tables | DEV_MISSING |
| Inspection | `/inspection`, `/inspection/[id]`, `/inspection/[id]/edit`, `/inspection/new`, `/inspection/compare`, `/inspection/improvements`, `/inspection/improvements/[id]`, `/inspection/debug`, `/inspection/diagnostic`, `/inspection/test-debug` | inspection pages | `inspection.*` | inspection APIs | `inspection_*` | DEV_MISSING |
| Inventory result analysis | `/inventory` | `app/inventory/page.tsx` | `inventory.result_analysis.*` | `/api/inventory/result-analysis` | `inventory_result_*` | DEV_MISSING |
| General Affairs | `/general-affairs` | GA home | `general_affairs.service_center.access` + module perms | GA APIs | GA master/inventory + guarded missing modules | PARTIAL |
| GA equipment | `/general-affairs/equipment`, `/general-affairs/equipment/templates` | GA pages | equipment/template perms | GA equipment/template APIs | `ga_equipment`, `ga_equipment_templates` | MATCH for completed DEV |
| GA facilities | `/general-affairs/facilities` | GA page | `general_affairs.facility.*` | facility APIs | `ga_facilities` | MATCH for completed DEV |
| GA parts | `/general-affairs/parts` | GA page | `general_affairs.part.*` | parts APIs | `ga_parts`, `ga_part_compatibilities` | MATCH for completed DEV |
| GA inventory | `/general-affairs/inventory`, `/general-affairs/inventory/locations` | GA inventory pages | inventory balance/transaction/location perms | inventory APIs | `ga_inventory_*` | MATCH for completed DEV |
| Cross-dept | `/cross-dept/maintenance`, `/cross-dept/merchandise`, `/cross-dept/products-master` | cross-dept pages | `cross_dept.*`, `store.products_master.manage` | maintenance/products/stockout APIs | `maintenance_*`, `products_master`, `stockout_*` | DEV_MISSING |
| Activity | `/activity-management`, `/activity-view/[id]`, `/admin/activity-management*` | activity pages | `activity.*` | campaign APIs | `campaign_*` | DEV_MISSING |
| Store-facing | `/store/clinic-selfpay-margin`, `/store/relationship-members` | store pages | `store.*`, `relationship_member.*` | clinic/relationship APIs | `clinic_selfpay_*`, `relationship_*` | DEV_MISSING |

## 6. API Route Matrix

| Module | API Route Pattern | Methods | Auth | Permission | Tables/RPC | DEV Status |
| --- | --- | --- | --- | --- | --- | --- |
| Auth callback | `/auth/callback` | GET | Supabase Auth | n/a | `auth.users` session | PARTIAL |
| User/profile | `/api/user/profile`, `/api/user/managed-stores`, `/api/users/search` | GET | authenticated | mixed | `profiles`, `store_managers` | PARTIAL |
| Admin/RBAC | `/api/admin/*`, `/api/roles*`, `/api/permissions/*` | GET/POST/PATCH/DELETE | authenticated | `role.*`, `user.*` | RBAC tables/functions | PARTIAL; DEV permission seed incomplete |
| Campaign/activity | `/api/campaign*` | GET/POST/PUT/PATCH/DELETE | authenticated | `activity.*` | `campaign_*` | DEV_MISSING |
| Clinic self-pay | `/api/clinic-selfpay/*` | GET/POST/DELETE | authenticated | `store.clinic_selfpay.*` | `clinic_selfpay_*`, storage | DEV_MISSING |
| Employees/promotions | `/api/employees/*`, `/api/employee-movements/*`, `/api/promotions/*` | GET/POST/DELETE | authenticated | `employee.*` | `profiles`, `store_employees`, movement/promotion tables | PARTIAL / DEV_MISSING |
| Monthly/export/performance | `/api/monthly-*`, `/api/export-monthly-status/*`, `/api/performance-*`, bonus APIs | GET/POST/DELETE | authenticated | `monthly.*`, `performance.*` | monthly/performance/bonus tables | DEV_MISSING |
| Inspection | `/api/inspection*`, `/api/inspection-templates*`, `/api/inspection-grade-mapping` | GET/POST/PUT/DELETE | authenticated | `inspection.*` | `inspection_*` | DEV_MISSING |
| Inventory result analysis | `/api/inventory/result-analysis` | GET/PATCH/POST/DELETE | authenticated | `inventory.result_analysis.*` | `inventory_result_*` | DEV_MISSING |
| General Affairs categories | `/api/general-affairs/categories*` | GET/POST/PATCH/DELETE | authenticated | category perms | GA category tables/RPC | MATCH |
| General Affairs master | `/api/general-affairs/equipment*`, `/facilities*`, `/parts*` | GET/POST/PATCH/DELETE | authenticated | GA master perms | GA master tables/RPC | MATCH |
| General Affairs inventory | `/api/general-affairs/inventory/*` | GET/POST/PATCH/DELETE | authenticated | inventory perms | `ga_inventory_*`, `ga_post_inventory_transaction` | MATCH |
| Maintenance | `/api/maintenance-*` | GET/POST/PATCH/DELETE | authenticated | `cross_dept.maintenance.*` | `maintenance_*`, storage | DEV_MISSING / guarded |
| Pharmacist | `/api/pharmacist-*` | GET/POST/PATCH/DELETE | authenticated | `pharmacist.*` | `pharmacist_*`, storage | DEV_MISSING |
| Products / stockout / transfer | `/api/products-master`, `/api/stockout-*`, `/api/store-transfer-requests*` | GET/POST/DELETE | authenticated | `store.products_master.*`, `cross_dept.stockout.*`, `employee.store_transfer.*` | products/stockout/transfer tables | DEV_MISSING |
| Store manager / supervisor | `/api/store-managers/*`, `/api/supervisors/*`, `/api/stores-with-supervisors` | GET/POST/DELETE | authenticated | store/supervisor perms or legacy role | `store_managers`, `stores`, `profiles` | PARTIAL |

## 7. Repository DB Usage Inventory

Programmatic `.from()` references include:

`acquisition_scans`, `acquisition_unmatched`, `assignment_collaborators`, `assignments`, `campaign_checklist_completions`, `campaign_checklist_items`, `campaign_department_publish`, `campaign_equipment_trips`, `campaign_schedules`, `campaign_store_details`, `campaign_store_headcount`, `campaign_store_own_staff`, `campaign_support_requests`, `campaign_support_staff`, `campaigns`, `clinic_selfpay_claim_batches`, `clinic_selfpay_claim_items`, `clinic_selfpay_price_entries`, `clinic_selfpay_price_month_closures`, `employee_movement_history`, `event_dates`, `ga_equipment`, `ga_equipment_templates`, `ga_facilities`, `ga_inventory_balances`, `ga_inventory_location_parts`, `ga_inventory_locations`, `ga_inventory_transactions`, `ga_part_compatibilities`, `ga_parts`, `ga_service_categories`, `ga_service_regions`, `ga_vendors`, `inspection_bonus_config`, `inspection_grade_mapping`, `inspection_improvements`, `inspection_masters`, `inspection_on_duty_staff`, `inspection_results`, `inspection_templates`, `inventory_result_batches`, `inventory_result_items`, `inventory_result_settings`, `logs`, `maintenance_categories`, `maintenance_photos`, `maintenance_progress_stages`, `maintenance_requests`, `maintenance_ticket_events`, `maintenance_update_photos`, `maintenance_updates`, `meal_allowance_records`, `monthly_bonus_records`, `monthly_performance_details`, `monthly_staff_status`, `monthly_store_summary`, `permissions`, `pharmacist_annual_fees`, `pharmacist_annual_master`, `pharmacist_annual_master_locks`, `pharmacist_annual_master_sync_log`, `pharmacist_monthly_snapshot`, `pharmacist_monthly_snapshot_sync_log`, `pharmacist_profiles`, `pharmacist_snapshot_locks`, `product_barcodes`, `products_master`, `profiles`, `relationship_members`, `relationship_sales_details`, `relationship_sales_imports`, `role_permissions`, `roles`, `spring_festival_bonus`, `stockout_product_response_history`, `stockout_product_responses`, `stockout_reports`, `store_activity_settings`, `store_employees`, `store_managers`, `store_performance`, `store_performance_thresholds`, `store_relocation_history`, `store_transfer_requests`, `stores`, `support_staff_bonus`, `talent_cultivation_bonus`, `templates`, `user_roles`.

RPC references:

`check_user_permission`, `current_user_has_permission`, `current_user_is_store_manager`, `ga_post_inventory_transaction`, `ga_soft_delete_category`, `ga_soft_delete_equipment`, `ga_soft_delete_equipment_template`, `ga_soft_delete_facility`, `ga_soft_delete_inventory_location`, `ga_soft_delete_inventory_location_part`, `ga_soft_delete_part`, `ga_soft_delete_part_compatibility`, `get_all_employees_for_rbac`, `get_user_permissions`, `has_permission`.

Auth Admin API usage:

- `createUser`
- `updateUserById`
- `deleteUser`
- `getUserById`
- `listUsers`

Storage usage found:

| Bucket / Path | Source | DEV Status |
| --- | --- | --- |
| `clinic-selfpay-screenshots` | clinic self-pay API | UNKNOWN_WITHOUT_STORAGE_SCHEMA |
| `maintenance-photos` | maintenance photo API / SQL | UNKNOWN_WITHOUT_STORAGE_SCHEMA |
| `pharmacist-fee-proofs` | pharmacist annual fees API | UNKNOWN_WITHOUT_STORAGE_SCHEMA |
| `inspection-photos` | inspection SQL comments/policies | UNKNOWN_WITHOUT_STORAGE_SCHEMA |
| campaign department publish assets | campaign SQL/API references | UNKNOWN_WITHOUT_STORAGE_SCHEMA |

## 8. DEV Actual Schema State

Confirmed DEV public schema from the current migration baseline and DEV tests contains:

| Object Group | Objects | Status |
| --- | --- | --- |
| RBAC/profile/store baseline | `profiles`, `roles`, `permissions`, `role_permissions`, `user_roles`, `stores`, `store_managers` | MATCH for DEV baseline |
| GA categories | `ga_equipment_categories`, `ga_facility_categories`, `ga_part_categories` | MATCH |
| GA equipment | `ga_equipment_templates`, `ga_equipment` | MATCH |
| GA facilities | `ga_facilities` | MATCH |
| GA parts | `ga_parts`, `ga_part_compatibilities` | MATCH |
| GA inventory locations | `ga_inventory_locations`, `ga_inventory_location_parts` | MATCH |
| GA inventory transactions | `ga_inventory_balances`, `ga_inventory_transactions`, `ga_inventory_transaction_no_seq`, `ga_post_inventory_transaction` | MATCH |

Confirmed gaps:

| Object | Type | Expected Source | DEV State | Risk | Proposed Action |
| --- | --- | --- | --- | --- | --- |
| `store_employees` | table | repo SQL / formal store-user logic | DEV_MISSING | user/role assignment and employee management parity gap | P1 compatibility schema design |
| `templates`, `assignments`, `assignment_collaborators`, `logs` | tables | task module SQL | DEV_MISSING | home/task/core app incomplete | P2 task core schema parity |
| `inspection_*` | tables/functions/storage policies | inspection SQL | DEV_MISSING | inspection pages/API unusable in DEV | P3 inspection schema parity |
| `inventory_result_*` | tables | inventory result analysis SQL | DEV_MISSING | formal report parity gap | P3/P7 inventory result schema parity |
| `maintenance_*` | tables/storage | maintenance SQL | DEV_MISSING | maintenance routes guarded | P4 maintenance schema parity |
| `ga_vendors`, `ga_service_categories`, `ga_service_regions` | tables | GA vendor SQL | DEV_MISSING | vendor/service setup guarded | P4 GA vendor/service reference |
| `monthly_*`, bonus tables, `store_performance*` | tables/functions | monthly/performance SQL | DEV_MISSING | monthly status/report/export incomplete | P3 operational/personnel |
| `campaign_*` | tables | activity campaign SQL | DEV_MISSING | activity module incomplete | P7 activity parity |
| `clinic_selfpay_*` | tables/storage | clinic self-pay SQL/API | DEV_MISSING | store self-pay module incomplete | P7 store finance parity |
| `pharmacist_*` | tables/storage | pharmacist SQL/API | DEV_MISSING | pharmacist management incomplete | P7 pharmacist parity |
| `products_master`, `product_barcodes`, `acquisition_*` | tables | product master SQL | DEV_MISSING | product/cross-dept incomplete | P7 products parity |
| `relationship_*` | tables | relationship SQL/API | DEV_MISSING | relationship member module incomplete | P7 relationship parity |
| `stockout_*`, `store_transfer_requests` | tables | stockout/transfer SQL/API | DEV_MISSING | stockout/transfer incomplete | P7 operations parity |

## 9. Permission Inventory

DEV currently has 20 active permissions, all from General Affairs 1A-1C:

| Permission Code | Module | UI Usage | API Usage | RLS Usage | DEV Exists | Orphan/Mismatch |
| --- | --- | --- | --- | --- | --- | --- |
| `general_affairs.service_center.access` | GA | GA entry | GA access/options | some GA reads | yes | ok |
| `general_affairs.equipment_category.view/manage` | GA categories | category UI | category API | yes | yes | ok |
| `general_affairs.facility_category.view/manage` | GA categories | category UI | category API | yes | yes | ok |
| `general_affairs.part_category.view/manage` | GA categories | category UI | category API | yes | yes | ok |
| `general_affairs.equipment_template.view/manage` | GA equipment | template UI | template API | yes | yes | ok |
| `general_affairs.equipment.view/manage` | GA equipment | equipment UI | equipment API | yes | yes | ok |
| `general_affairs.facility.view/manage` | GA facilities | facility UI | facility API | yes | yes | ok |
| `general_affairs.part.view/manage` | GA parts | parts UI | parts API | yes | yes | ok |
| `general_affairs.inventory_location.view/manage` | GA inventory locations | location UI | location API | yes | yes | ok |
| `general_affairs.inventory_balance.view` | GA inventory balances | inventory UI | balances API | yes | yes | ok |
| `general_affairs.inventory_transaction.view/manage` | GA inventory transactions | inventory UI | transaction API/RPC | yes | yes | ok |

Repo permission references missing from DEV are grouped below. These should be restored as formal system reference data, not DEV-only demo data.

| Permission Prefix | Approx Count In Repo | DEV Exists | Risk |
| --- | ---: | --- | --- |
| `role.*` | 9 | mostly missing | RBAC admin incomplete unless seeded |
| `user.*` | 5 | missing | user management incomplete unless seeded |
| `store.*`, `store.manager.*`, `supervisor.*` | 18+ | missing | store/personnel pages diverge |
| `task.*` | 14 | missing | task assignment flow diverges |
| `inventory.*` legacy result-analysis | 17 | missing | `/inventory` report parity gap |
| `monthly.*` | 24 | missing | monthly status/report/export gap |
| `inspection.*` / `inspection_type.*` | 18+ | missing | inspection module gap |
| `activity.*` | 19 | missing | activity/campaign gap |
| `employee.*` | 16 | missing | employee/promotion movement gap |
| `cross_dept.*` | 8 | missing | maintenance/products/stockout gap |
| `pharmacist.*` | 4 | missing | pharmacist module gap |
| `relationship_member.*` | 4 | missing | relationship member gap |
| `performance.*` | 2 | missing | performance gap |
| `home.*` / `dashboard.*` | 2 | missing | home/dashboard display gap |

Known authorization mismatch:

- Several legacy routes still check `profiles.role` directly. It may remain as compatibility/display, but new parity work must move guards toward `current_user_has_permission()`, `user_roles`, `role_permissions`, and RLS.
- Navbar and module availability must be based on effective permissions and module readiness, not email or role name guessing.

## 10. Auth Inventory

Known flows:

- Auth callback: `/auth/callback`.
- User registration/login/password reset pages exist.
- `handle_new_user()` in DEV baseline creates minimum `profiles` row from `auth.users`.
- Admin actions use Supabase Auth Admin APIs for create/update/delete/list/get.
- DEV full admin and test users are fake accounts and must remain separate from Production users.
- LINE login mapping / metadata must be confirmed from repository and Production config before parity is claimed.

Status:

- App-level Auth/profile flow is partially confirmed from repo.
- Auth schema/config cannot be fully restored from repo evidence alone. Need schema-only/config-only evidence that excludes `auth.users` data and secrets.

## 11. Storage Inventory

Storage parity requires bucket definitions and policies, but never object rows. Current repo references buckets or storage use for clinic self-pay, maintenance photos, pharmacist fee proofs, inspection photos and campaign assets.

DEV status is UNKNOWN_WITHOUT_STORAGE_SCHEMA for non-GA inventory storage. Future parity work should use schema/policy export or documented bucket setup, excluding files and signed URLs.

## 12. Environment Divergence Audit

Allowed environment differences:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EXPECTED_SUPABASE_PROJECT_REF`
- `ALLOW_DEV_DATABASE_OPERATIONS`
- `ALLOW_SUPABASE_CLI_REMOTE_OPERATIONS`
- sandbox email/SMS/payment settings
- DEV fake seed and diagnostics

Forbidden divergence:

- DEV-only business logic.
- Production-only UI component for the same route.
- Project-ref-based workflow differences.
- Different permission codes, table names, RLS, API contracts, validation rules, or core behavior.
- Test-only routes replacing real flows.

Current findings:

- Guard scripts intentionally branch by environment and are allowed.
- `ModuleUnavailablePage` guards are temporary UX safety, not parity completion.
- Legacy `profiles.role` checks are a parity/security debt where they replace RBAC guards.

## 13. Temporary Parity Guards

`components/general-affairs/ModuleUnavailablePage.tsx` is classified as `TEMPORARY_PARITY_GUARD`.

Guarded / unavailable features observed:

| Feature | Missing Schema/RPC/Reference | Current Purpose | Removal Plan |
| --- | --- | --- | --- |
| GA vendors | `ga_vendors`, vendor permissions/RLS | prevent schema cache raw errors | remove after GA vendor module schema/API/UI parity |
| GA service categories | `ga_service_categories` | prevent unsafe create/update against missing table | remove after service category parity |
| GA service regions | `ga_service_regions` | prevent unsafe create/update against missing table | remove after service region parity |
| Maintenance report / workflow | `maintenance_*`, storage policies, permissions | prevent maintenance migration raw error | remove after maintenance parity |
| Other unbuilt GA actions | feature-specific schemas not yet in DEV | prevent fake links | remove only when route/API/schema verified |

Availability guard is not parity complete. It only prevents users from hitting unbuilt modules while the schema parity roadmap is executed.

## 14. Functional Parity Table

| Module | Production Feature Expected | DEV Feature | Gap | Priority |
| --- | --- | --- | --- | --- |
| RBAC | full user/role/permission management | partial, improved but permission seed incomplete | missing full permission reference and effective-permission visibility | P1 |
| Stores/personnel | store, employee, supervisor, manager flows | stores/store_managers only | missing `store_employees` and personnel history | P1 |
| Tasks | create/edit/assign/my tasks/dashboard | UI exists | schema missing in DEV | P2 |
| Inspection | inspection, improvements, templates | UI/API exists | schema missing in DEV | P3 |
| Monthly/performance | monthly status, exports, bonus | UI/API exists | schema missing in DEV | P3 |
| General Affairs inventory | inventory locations, balances, transactions | completed through 1C-2C | none for verified scope | Completed |
| General Affairs vendor/service/maintenance | vendors, service categories/regions, maintenance | guarded | schema missing in DEV | P4 |
| Product/cross-dept/stockout | product master, stockout, transfers | UI/API exists | schema missing in DEV | P7 |
| Store business modules | clinic self-pay, relationship members | UI/API exists | schema/storage missing in DEV | P7 |
| Reporting/integrations | exports, uploads, storage artifacts | partial code | storage/platform/config unknown | P7 |

## 15. Security Parity Table

| Module | Permission | API Guard | RLS | DEV State | Gap |
| --- | --- | --- | --- | --- | --- |
| GA inventory | `general_affairs.inventory_*` | server-side guards + RPC | verified | MATCH | none for 1C scope |
| GA master | `general_affairs.*` master perms | server-side guards | verified | MATCH | none for 1A/1B scope |
| RBAC | `role.*`, `user.*` | partially implemented | table/RPC policy exists in baseline | PARTIAL | DEV permission seed incomplete |
| Legacy task/admin/store/monthly | `task.*`, `store.*`, `monthly.*`, etc. | mixed RBAC/legacy role | unknown in DEV | GAP | needs formal permission/RLS parity |
| Inspection | `inspection.*` | mixed | unknown in DEV | GAP | needs schema and RLS restore |
| Maintenance/cross-dept | `cross_dept.*` | guarded/partial | missing | GAP | needs module migration |

## 16. Data Strategy

| Object/Data | DEV Seed | Production Seed | Copy Allowed | Sanitization |
| --- | --- | --- | --- | --- |
| Permission reference codes | yes, system seed | yes | yes if non-sensitive | none; system metadata |
| System roles | yes | yes | yes if generic | avoid Production user mappings |
| Stores master | yes, fake or sanitized reference | yes | only with explicit sanitization decision | remove sensitive operational metadata |
| Profiles/users | fake users only | real users | no | create DEV Auth accounts separately |
| Store employee relationships | fake/sanitized | real | no direct copy | generate fake employee codes/names |
| Product/category/vendor reference | fake or sanitized | real | maybe only if non-sensitive and approved | remove prices/secrets/contracts |
| Work orders/tasks/inspection/inventory transactions | fake only | real | no | regenerate DEV demo data |
| Storage files | fake only | real | no | no signed URLs or object copy |
| Audit logs | fake only | real | no | do not copy |

## 17. Formal Source Confidence

| Level | Meaning | Current Use |
| --- | --- | --- |
| Level 1 | repo-confirmed SQL/code | routes, API, SQL files, permission references |
| Level 2 | UI/API inferred | module dependencies from `.from()`/`.rpc()` |
| Level 3 | user-observed Production behavior | role UI, inventory report behavior, user deletion FK |
| Level 4 | Production schema required | exact Production constraints/RLS/grants/buckets/Auth metadata not in repo |

## 18. Production Schema-Only Dump Recommendation

1. Can repo fully restore Production structure?
   - No. The repo contains many SQL files, but there are overlapping/legacy scripts and manual Production evidence. It cannot prove the exact Production schema state by itself.
2. Which objects cannot be fully confirmed?
   - Auth schema/config, Storage buckets/policies, exact Production RLS/grants, applied migration order, manually created functions/triggers, and whether legacy scripts match current Production.
3. Is a Production schema-only dump recommended?
   - Yes, for comparison only. It should not include data rows and should not be applied directly to DEV without review.
4. What must the dump exclude?
   - `auth.users` data, passwords, tokens, sessions, Storage object rows, business rows, audit logs, secrets, connection strings, service keys.
5. How to compare without applying/writing Production?
   - Use read-only `pg_dump --schema-only` or Supabase CLI equivalent against a read-only connection if available, store output outside Git or in a sanitized review artifact, then diff object definitions against repo/DEV. Do not run SQL against Production from Codex.

## 19. Full Parity Roadmap

Recommended order based on dependencies:

1. P0 Environment/security baseline and full-system parity audit. Completed by this document.
2. P1 Shared core master: RBAC permission reference seed, system roles, `store_employees` compatibility, store/supervisor/employee reference schema. Design first.
3. P2 Task/core workflow: templates, assignments, collaborators, logs, dashboard/my-tasks parity.
4. P3 Operational/personnel: monthly status, performance, bonus, inspection and improvements.
5. P4 General Affairs base: vendors, service categories, service regions, maintenance base schema, Storage policies.
6. P5 General Affairs inventory: keep 1C verified; extend only after P1/P4 dependencies are safe.
7. P6 Requests/transfers/stocktake: resume Task 1C-3 only after core parity blockers are cleared.
8. P7 Reporting/integration/attachments/automation: exports, uploads, cron/webhook/Storage/edge parity.

Task 1C-3 is paused because full-system parity gaps can otherwise create divergent schemas, permission codes, navigation and workflows that later become expensive to unwind.

## 20. Next Minimal Task

**P1 Core Reference / RBAC / Store Compatibility schema parity design.**

Do first:

- Design only; do not create migration yet.
- Reconcile formal `permissions` reference codes from repository SQL and UI/API usage.
- Define system role seed separate from DEV demo role/user seed.
- Define `store_employees` compatibility strategy for user management, employee code assignment and store scope.
- Confirm which reference data may be sanitized versus faked.

Do not:

- Copy Production data.
- Start Task 1C-3.
- Build ad hoc DEV-only behavior.

## 21. Required Final Report Items

| # | Item | Current Finding |
| ---: | --- | --- |
| 1 | Full module list | Listed in section 4 |
| 2 | Page route count/classification | 65 pages, grouped in section 5 |
| 3 | API route count/classification | 146 API routes, grouped in section 6 |
| 4 | Repository DB object count | `.from()` references 92; SQL files 246 |
| 5 | DEV actual DB object count | confirmed completed baseline + GA 1A-1C objects; exact count requires catalog query |
| 6 | Permission code count/mismatch | DEV active 20; repo references far more non-GA permissions |
| 7 | Full functional parity gaps | section 14 |
| 8 | Full schema parity gaps | section 8 |
| 9 | Full security parity gaps | section 15 |
| 10 | Temporary parity guards | section 13 |
| 11 | DEV/Production branch code | guard scripts allowed; business-flow branch must be removed/avoided |
| 12 | Formal features not restorable from repo alone | Auth config, Storage policies, exact Production RLS/grants/manual objects |
| 13 | Need Production schema-only dump? | yes, compare only, no data |
| 14 | Reference/business/secret categories | section 16 |
| 15 | Full parity roadmap | section 19 |
| 16 | First phase to execute | P1 Core Reference / RBAC / Store Compatibility design |
| 17 | Task 1C-3 resume conditions | after P1/P4 dependency blockers cleared and approved |
| 18 | Risks | schema drift, legacy role checks, incomplete permissions, optional tables missing, Storage/Auth unknowns |
| 19 | User decisions needed | whether to authorize schema-only Production comparison and sanitized reference seed policy |
| 20 | Document updates | this file plus handoff/current/copilot updates |

