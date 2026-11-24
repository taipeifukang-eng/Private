-- M9 上線前唯讀檢查 05：「DEV 有、但不需要新草稿」的那幾份，正式區是否已經由舊版 migration 涵蓋。
-- 只有 SELECT，不改任何資料、不建任何物件，可隨時重複執行。除最後兩列（has_permission 語意，預期 false）外，每列 ok 應為 true；有 false 的列代表正式區少了對應的舊版 migration，要先補那一支（不是補 m9 草稿）。
-- 對應關係（DEV 檔 -> 正式區由哪支舊 migration 提供）：
--   20261027150000_vue_inventory_compatibility      -> 20260817093000_inventory_result_analysis_recount_versions（盤點再次報表版本欄位）
--   20261028100000_vue_prescription_reports         -> 20261012120000_create_independent_monthly_prescription_reports（處方箋月報表）
--   20261028101000_vue_bonus_compatibility          -> 20260724025452（長照／季獎金等欄位）、20261006100000（brand_bonus）、20261019120000_allow_zero_bonus_import（拿掉 trg_preserve_monthly_bonus_nonzero_values）
--   20261109110000／110100_m5_w23／w24 年度行事曆   -> 20261008100000_organization_annual_calendar、20261010120000_organization_calendar_google_sync（八張表）
--   20261109110200_m5_w23_personal_event_owner_read -> m5-sql/w23_personal_event_owner_read_fix.sql（2026-11-09 已在正式區套用；本檢查只確認讀取政策存在）
--   20261116100000_vue_prescription_store_aliases   -> w03-rx-sql/01-prescription-aliases.sql（要執行，見總表）
--   20260820090000／20260821110000 組織與部門職掌   -> 供 10_organization_department 當前置（組織四表、work_* 三表、權限碼）
-- 不需要上正式區的 DEV 專用檔：20261028011000_vue_inspection_templates（題庫種子，檔內遇到非空表就拒絕）、20261028110000_snapshot_staging（DEV 快照匯入暫存表）、
--   *_dev_test_cleanup、*_dev_roles、*_dev_seed、*_dev_storage_and_seed、employee-purchases.sql、pharmacist-storage.sql。
WITH c(item, ok) AS (VALUES
  ('盤點報表版本欄位 inventory_result_batches.report_round／parent_batch_id／report_kind／report_label 都在',
     (SELECT count(*) = 4 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'inventory_result_batches'
        AND column_name IN ('report_round', 'parent_batch_id', 'report_kind', 'report_label'))),
  ('處方箋月報表 monthly_prescription_reports 存在',
     to_regclass('public.monthly_prescription_reports') IS NOT NULL),
  ('每月獎金 monthly_bonus_records 的 7 個相容欄位都在',
     (SELECT count(*) = 7 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'monthly_bonus_records'
        AND column_name IN ('brand_bonus', 'long_term_care_bonus', 'manager_supervisor_quarterly_bonus', 'opening_abnormal_responsibility_amount',
                            'bonus_difference_adjustment', 'other_bonus', 'other_bonus_note'))),
  ('舊版「非零獎金不可被覆蓋」觸發器 trg_preserve_monthly_bonus_nonzero_values 已移除（20261019120000）',
     NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_preserve_monthly_bonus_nonzero_values' AND NOT tgisinternal)),
  ('年度行事曆八張表都在',
     (SELECT count(*) = 8 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN (
         'organization_calendar_events', 'organization_calendar_event_audit', 'organization_personal_calendar_events',
         'organization_personal_calendar_event_shares', 'organization_calendar_holiday_imports', 'organization_calendar_holidays',
         'organization_calendar_google_connections', 'organization_calendar_google_event_links'))),
  ('個人行程讀取政策 organization_personal_calendar_events_read 存在',
     EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'organization_personal_calendar_events'
               AND policyname = 'organization_personal_calendar_events_read')),
  ('個人行程讀取政策含「建立者本人可讀」（owner_id = auth.uid()；m5 w23 修正已套用）',
     coalesce((SELECT qual ILIKE '%owner_id%auth.uid()%' FROM pg_policies WHERE schemaname = 'public'
                 AND tablename = 'organization_personal_calendar_events' AND policyname = 'organization_personal_calendar_events_read'), false)),
  ('組織四表與 work_* 三表都在（10_organization_department 的前置）',
     (SELECT count(*) = 7 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN (
         'organization_units', 'organization_memberships', 'organization_manager_assignments',
         'work_categories', 'work_items', 'work_assignments', 'profiles'))),
  ('組織與部門職掌的 10 個權限碼都在（只看存在，不看有沒有授權）',
     (SELECT count(*) = 10 FROM public.permissions WHERE code IN (
        'organization.organization.view', 'organization.department.view', 'organization.department.create', 'organization.department.edit',
        'organization.member.view', 'organization.member.manage', 'organization.manager.view', 'organization.manager.manage',
        'organization.department_workspace.view', 'organization.department_workspace.manage'))),
  ('調店確認權限碼 employee.store_transfer.confirm 存在（65 不建立它）',
     EXISTS (SELECT 1 FROM public.permissions WHERE code = 'employee.store_transfer.confirm')),
  ('門市管理權限碼 store.manage 存在（70 的停用門市讀取會用到）',
     EXISTS (SELECT 1 FROM public.permissions WHERE code = 'store.manage')),
  ('正式區 has_permission 沒有 admin 繞過（草稿依這個語意寫；預期 false）',
     coalesce((SELECT pg_get_functiondef(p.oid) ILIKE '%''admin''%' FROM pg_proc p WHERE p.oid = to_regprocedure('public.has_permission(uuid,character varying)')), false)),
  ('正式區 has_permission 不檢查 roles.is_active（草稿依這個語意寫；預期 false）',
     coalesce((SELECT pg_get_functiondef(p.oid) ILIKE '%r.is_active%' FROM pg_proc p WHERE p.oid = to_regprocedure('public.has_permission(uuid,character varying)')), false))
)
SELECT item,
       ok,
       CASE WHEN item LIKE '%預期 false%' THEN '此兩列的「ok = false」才是符合預期；若為 true，代表正式區 has_permission 與草稿假設不同，請先回報' ELSE NULL END AS note
FROM c;
