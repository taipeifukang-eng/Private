# 督導管理日誌：今日管理工作台重構提案

最後更新：2026-08-13

## 0. 實作狀態更新

截至 2026-08-13：

- SML-UX-2B `supervisor_management_daily_plans` foundation 已正式推送 DEV 並通過 DB catalog test。
- SML-UX-2C daily plans API 與 today read model 已完成本機實作、靜態測試、TypeScript、build 與未登入 smoke test。
- SML-UX-2D `/supervisor-management-log` 今日工作台 UI 已完成本機實作、靜態測試、TypeScript 與 build。
- 今日頁面已實作為：
  - 今日管理規劃。
  - 今日待追蹤。
  - 快速新增管理紀錄。
  - 今日管理紀錄。
- 今日資料來源為 `GET /api/supervisor-management-log/today`，不使用假 KPI、假追蹤或假 AI 結果。
- 今日規劃新增 / 編輯 / 開始處理 / 完成 / soft delete 使用 daily-plans API。
- 目前仍等待使用者人工 UI 驗收，尚未開始 AI 語音整理草稿 / 人工確認流程。

## 1. 本輪判定

本輪檢查既有程式碼與 schema 後，確認目前督導管理日誌只有下列正式資料結構：

- `supervisor_management_categories`
- `supervisor_management_cases`
- `supervisor_management_records`
- `supervisor_management_followups`
- `supervisor_management_case_events`

目前沒有 `daily_plan`、`today_plan` 或 `management_plan` 類型的 table、API 或可寫入資料結構。

因此，「今日管理工作台」中的 **今日管理規劃** 不能用既有 `Management Case` 或 `Management Record` 假裝完成。若直接把案件或紀錄當作今日規劃，會混淆下列領域概念：

- Management Plan：今天預計做什麼。
- Management Record：今天實際做了什麼。
- Management Case：需要持續管理的問題。
- Follow-up：後續確認結果。

結論：本輪停止在 Architecture / Migration Proposal，不直接修改 UI、不建立 migration、不執行 db push。

## 2. 現有支援與缺口

### 可直接沿用

- 管理案件：`supervisor_management_cases`
- 實際管理紀錄：`supervisor_management_records`
- 追蹤結果：`supervisor_management_followups`
- 案件事件時間線：`supervisor_management_case_events`
- 權限 helper：
  - `supervisor.management_log.view_own`
  - `supervisor.management_log.view_team`
  - `supervisor.management_log.create`
  - `supervisor.management_log.update_own`
  - `supervisor.management_log.follow_up`
  - `supervisor.management_log.manage`

### 不足以正式支援

- 今日預計管理事項。
- 今日規劃狀態：待處理、處理中、已完成、取消。
- 規劃開始處理、完成並關聯實際紀錄。
- 今日規劃與管理紀錄之間的可追溯關聯。
- 今日工作台一次讀取 plans、due followups、today records、summary 的 read model API。

## 3. 最小資料模型提案

新增 table：

```sql
public.supervisor_management_daily_plans
```

建議欄位：

- `id uuid primary key default gen_random_uuid()`
- `plan_date date not null default current_date`
- `owner_user_id uuid not null references public.profiles(id) on delete restrict`
- `target_type text not null`
- `store_id uuid null references public.stores(id) on delete set null`
- `employee_id uuid null references public.store_employees(id) on delete set null`
- `target_name_snapshot text not null`
- `category_id uuid null references public.supervisor_management_categories(id)`
- `title text not null`
- `status text not null default 'PLANNED'`
- `started_at timestamptz null`
- `completed_at timestamptz null`
- `linked_case_id uuid null references public.supervisor_management_cases(id) on delete set null`
- `linked_record_id uuid null references public.supervisor_management_records(id) on delete set null`
- `notes text null`
- `metadata jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`
- `created_by uuid references public.profiles(id) on delete set null`
- `updated_at timestamptz not null default now()`
- `updated_by uuid references public.profiles(id) on delete set null`
- `deleted_at timestamptz null`
- `deleted_by uuid references public.profiles(id) on delete set null`
- `deletion_reason text null`

建議 enum / check：

- `target_type in ('STORE', 'EMPLOYEE', 'AREA', 'CROSS_DEPARTMENT', 'OTHER')`
- `status in ('PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELLED')`
- `STORE` 目標必填 `store_id`
- `EMPLOYEE` 目標必填 `employee_id`
- `target_name_snapshot` 不可空白
- `title` 不可空白
- `metadata` 必須是 JSON object
- soft delete 欄位需成組出現

建議索引：

- `(owner_user_id, plan_date)` where `deleted_at is null`
- `(plan_date, status)` where `deleted_at is null`
- `(store_id, plan_date)` where `deleted_at is null`
- `(employee_id, plan_date)` where `deleted_at is null`
- `(linked_case_id)` where `deleted_at is null`
- `(linked_record_id)` where `deleted_at is null`

## 4. RLS 與權限規劃

MVP 不新增過度細碎的 permission code，先沿用督導管理日誌既有權限：

- 可讀：
  - `supervisor.management_log.view_own`
  - `supervisor.management_log.view_team`
  - `supervisor.management_log.create`
  - `supervisor.management_log.update_own`
  - `supervisor.management_log.follow_up`
  - `supervisor.management_log.manage`
- 可新增：
  - `supervisor.management_log.create`
  - `supervisor.management_log.manage`
- 可更新自己的 plan：
  - `supervisor.management_log.update_own`
  - `supervisor.management_log.follow_up`
  - `supervisor.management_log.manage`
- 可管理全部：
  - `supervisor.management_log.manage`

RLS 原則：

- `view_own`：只能讀自己的 daily plans。
- `view_team`：只能讀自己管理範圍內門市 / 人員的 daily plans，範圍必須由既有 helper / RLS 控制。
- `manage`：可讀寫全部未刪除 daily plans。
- 不建立 hard DELETE policy。
- soft delete 透過 SECURITY DEFINER RPC，並檢查權限與 deletion reason。

## 5. API 規劃

新增 API：

- `GET /api/supervisor-management-log/daily-plans`
  - 支援 `date`、`status`、`targetType`、`storeId`、`employeeId`
  - 回傳目前授權範圍內的 daily plans。
- `POST /api/supervisor-management-log/daily-plans`
  - 建立今日或指定日期規劃。
- `PATCH /api/supervisor-management-log/daily-plans/[id]`
  - 更新規劃狀態、目標、分類、備註。
- `DELETE /api/supervisor-management-log/daily-plans/[id]`
  - soft delete，必須附 deletion reason。
- `POST /api/supervisor-management-log/daily-plans/[id]/start`
  - 將狀態改為 `IN_PROGRESS`，填入 `started_at`。
- `POST /api/supervisor-management-log/daily-plans/[id]/complete`
  - 將狀態改為 `DONE`，可關聯 `linked_case_id` / `linked_record_id`。

建議新增今日 read model：

- `GET /api/supervisor-management-log/today?date=YYYY-MM-DD`

回傳：

- `plans`
- `followUpQueue`
  - 已逾期
  - 今日到期
  - 即將追蹤
- `todayRecords`
- `summary`

此 API 只彙整既有授權可見資料，不擴大 RLS scope。

## 6. 今日工作台 UI 規劃

正式 UI 應移除開發語言，不顯示：

- `Management Case`
- `Management Record`
- `Follow-up`
- `SML-UX-2A`
- `today/history API`
- `server API / RLS`

今日頁面應由四個區塊組成：

1. 今日管理規劃
2. 今日待追蹤
3. 快速新增管理紀錄
4. 今日管理紀錄

### 今日管理規劃

- 顯示今日 plans。
- 支援新增 plan。
- 每筆 plan 顯示目標、事項一句話、分類、狀態。
- CTA：
  - 開始處理
  - 新增管理結果

### 今日待追蹤

- 分組：
  - 已逾期
  - 今日到期
  - 即將追蹤
- 每張卡顯示：
  - 目標
  - 案件名稱
  - 上次要求 / 管理動作
  - 原追蹤日期
  - 立即追蹤

### 快速新增管理紀錄

- Primary：快速口述。
- Secondary：新增管理紀錄。
- 快速口述可以先是 disabled 或 safe boundary，但不得假裝 AI 完成。
- 不在 Today 主要操作顯示「建立管理案件」。

### 今日管理紀錄

- 只顯示今日實際 records。
- 不混合「今日 / 近期」。
- 若要顯示近期紀錄，應另放在管理歷程，不放今日主區塊。

## 7. 後續 Migration / Test 規劃

下一步若批准，建議建立：

- `supabase/migration_supervisor_management_daily_plans.sql`
- 標準 migration：
  - `supabase/migrations/<timestamp>_supervisor_management_daily_plans.sql`
- rollback：
  - `supabase/rollback_supervisor_management_daily_plans.sql`
- test SQL：
  - `supabase/test_supervisor_management_daily_plans.sql`
- static test：
  - `scripts/test-supervisor-management-daily-plans.js`

測試至少包含：

- 權限碼沿用確認。
- daily plans table / indexes / constraints。
- target type 與 store / employee 欄位配對。
- system fields 防偽。
- soft delete RPC。
- RLS role matrix。
- no DELETE policy。
- API 401 / 403 / 404 / 409。
- 今日 read model 不擴大 scope。
- start / complete status transition。
- linked case / record 保留追溯。

## 8. 本輪未做項目

- 未修改 DB。
- 未建立 migration。
- 未執行 db push。
- 未修改 RLS / RPC。
- 未修改 API contract。
- 未修改 `/supervisor-management-log` UI。
- 未操作 Production。

## 9. 建議下一個最小任務

**SML-UX-2B：今日管理規劃 Foundation 設計與 migration 建立。**

批准後先做：

1. 建立 daily plans migration / rollback / test SQL。
2. 建立 RLS、validation trigger、soft delete RPC。
3. 建立 static test。
4. Guard / migration list / dry-run。
5. 等使用者批准正式 DEV db push。
6. DB test SQL 通過後，才進入 today API 與 UI 重構。
