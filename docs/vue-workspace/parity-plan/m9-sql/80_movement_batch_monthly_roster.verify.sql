-- M9 草稿 80 驗證：套用 80_movement_batch_monthly_roster.sql 之後執行。只有 SELECT，不改任何資料。
-- 第一部分：物件與權限。每列 ok 都應為 true。
-- 第二部分：逐月驗證（名冊與異動是否一致）。每個月份的「問題筆數」欄位預期為 0；已送審／已確認月份依規則不被重算改動，
--   差異會出現在 pending_recheck（需重新確認清單），不算問題。請從最舊的月份一個月一個月看。

-- ===== 第一部分：物件與權限 =====
WITH fn(sig, definer) AS (VALUES
  ('public.workspace_save_monthly_allowance(uuid,uuid,text,text,jsonb,jsonb)', true),
  ('public.workspace_save_monthly_summary(uuid,text,jsonb,timestamptz)', true),
  ('public.workspace_add_monthly_employee(uuid,text,uuid,jsonb)', true),
  ('public.workspace_movement_snapshot(jsonb)', true),
  ('public.workspace_movement_save(uuid,uuid,jsonb,text)', true),
  ('public.workspace_movement_preview(uuid,jsonb,text)', true),
  ('public.workspace_position_rank(text,text)', false),
  ('public.workspace_effective_promotion(text,date)', true),
  ('public.workspace_employee_master_position_sync(text)', true),
  ('public.workspace_acting_end_event(text,text)', false),
  ('public.workspace_acting_active(text,uuid,date)', true),
  ('public.workspace_roster_recompute(uuid,text,text,text,uuid,boolean,boolean,text,text,text)', true),
  ('public.workspace_roster_apply_store_month(uuid,uuid,text,boolean,boolean,text)', true),
  ('public.workspace_apply_due_promotions(date)', true),
  ('public.workspace_employee_master_resync(text)', true),
  ('public.workspace_movement_update(uuid,uuid,jsonb)', true),
  ('public.workspace_movement_delete(uuid,uuid)', true))
SELECT '函式存在、只給 service_role：' || sig AS item,
  to_regprocedure(sig) IS NOT NULL
  AND has_function_privilege('service_role', sig, 'EXECUTE')
  AND NOT has_function_privilege('anon', sig, 'EXECUTE')
  AND NOT has_function_privilege('authenticated', sig, 'EXECUTE')
  AND (NOT definer OR coalesce((SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(sig)), false)) AS ok
FROM fn
UNION ALL SELECT '名冊頁 RPC 存在、SECURITY INVOKER、authenticated 可執行、anon 不可',
  to_regprocedure('public.workspace_monthly_roster_page(uuid,text)') IS NOT NULL
  AND NOT coalesce((SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.workspace_monthly_roster_page(uuid,text)')), true)
  AND has_function_privilege('authenticated', 'public.workspace_monthly_roster_page(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.workspace_monthly_roster_page(uuid,text)', 'EXECUTE')
UNION ALL SELECT 'workspace_extract_store_code 存在、authenticated 可執行、anon 不可',
  to_regprocedure('public.workspace_extract_store_code(text)') IS NOT NULL
  AND has_function_privilege('authenticated', 'public.workspace_extract_store_code(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.workspace_extract_store_code(text)', 'EXECUTE')
UNION ALL SELECT '舊版 timestamptz 三參數 roster_page 已不存在', to_regprocedure('public.workspace_monthly_roster_page(uuid,text,timestamptz)') IS NULL
UNION ALL SELECT 'workspace_movement_requests 存在且啟用 RLS、anon／authenticated 無權限',
  coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.workspace_movement_requests')), false)
  AND NOT has_table_privilege('anon', 'public.workspace_movement_requests', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.workspace_movement_requests', 'SELECT')
UNION ALL SELECT 'monthly_staff_adjustment_log 存在且啟用 RLS、anon／authenticated 無權限',
  coalesce((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.monthly_staff_adjustment_log')), false)
  AND NOT has_table_privilege('anon', 'public.monthly_staff_adjustment_log', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.monthly_staff_adjustment_log', 'SELECT')
UNION ALL SELECT 'monthly_staff_status.movement_hint 欄位存在',
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='monthly_staff_status' AND column_name='movement_hint')
UNION ALL SELECT 'store_employees.newbie_level 欄位存在',
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='store_employees' AND column_name='newbie_level')
UNION ALL SELECT 'valid_movement_type 已含 acting_manager',
  coalesce((SELECT pg_get_constraintdef(oid) LIKE '%acting_manager%' FROM pg_constraint WHERE conrelid='public.employee_movement_history'::regclass AND conname='valid_movement_type'), false)
UNION ALL SELECT '區塊計算（9 參數）與觸發器仍在，且含代理店長判斷（本檔未替換）',
  to_regprocedure('public.calculate_bonus_block(character varying,character varying,boolean,character varying,boolean,boolean,numeric,text[],boolean)') IS NOT NULL
  AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='trigger_update_calculated_block' AND tgrelid='public.monthly_staff_status'::regclass AND NOT tgisinternal AND tgenabled <> 'D')
  AND coalesce((SELECT prosrc LIKE '%p_is_acting_manager%' FROM pg_proc WHERE oid = to_regprocedure('public.calculate_bonus_block(character varying,character varying,boolean,character varying,boolean,boolean,numeric,text[],boolean)')), false)
UNION ALL SELECT '本檔沒有新增權限碼（permissions 不含 workspace 名冊／異動相關新碼）',
  NOT EXISTS (SELECT 1 FROM public.permissions WHERE code ILIKE 'workspace.roster%' OR code ILIKE 'workspace.movement%')
UNION ALL SELECT '前置：monthly_staff_recheck 與 workspace_monthly_recheck_add 存在（草稿 15）',
  to_regclass('public.monthly_staff_recheck') IS NOT NULL
  AND to_regprocedure('public.workspace_monthly_recheck_add(uuid,text,text,uuid,text,uuid,text,text,text,text,text,text,text)') IS NOT NULL;

-- ===== 第二部分：逐月驗證 =====
-- A) 每月總覽：列數、重複列、區塊沒算出的列（預期 0）、區塊與現算不一致（預期 0）、待確認清單
SELECT m.year_month,
  count(*) AS rows,
  count(*) FILTER (WHERE m.status = 'draft') AS draft_rows,
  count(*) FILTER (WHERE m.status IN ('submitted','confirmed')) AS locked_rows,
  (SELECT count(*) FROM (SELECT 1 FROM public.monthly_staff_status d WHERE d.year_month = m.year_month AND d.employee_code IS NOT NULL
     GROUP BY d.store_id, d.employee_code HAVING count(*) > 1) x) AS 重複列問題,
  count(*) FILTER (WHERE m.calculated_block IS NULL) AS 區塊空值問題,
  count(*) FILTER (WHERE m.calculated_block IS DISTINCT FROM public.calculate_bonus_block(m.employment_type, m.monthly_status, m.is_pharmacist, m."position",
     m.is_dual_position, m.is_supervisor_rotation, m.work_days, m.extra_tasks, m.is_acting_manager)) AS 區塊不一致問題,
  (SELECT count(*) FROM public.monthly_staff_recheck r WHERE r.year_month = m.year_month AND r.status = 'pending') AS pending_recheck
FROM public.monthly_staff_status m
GROUP BY m.year_month ORDER BY m.year_month DESC;

-- B) 離職／留停後仍列在名冊（草稿月份；預期 0。已送審／已確認月份不列入，因為依規則不會被改）
--    判斷：員工在該店「最新的狀態類異動」是離職或留停，且生效日早於該月 1 日，但該月該店仍有非手動新增的草稿列。
SELECT s.year_month, count(*) AS 離職或留停後仍列名冊問題
FROM public.monthly_staff_status s
JOIN LATERAL (
  SELECT h.movement_type, h.movement_date FROM public.employee_movement_history h
  WHERE h.employee_code = s.employee_code AND h.store_id = s.store_id
    AND h.movement_type IN ('onboarding','return_to_work','store_transfer','leave_without_pay','resignation')
    AND h.movement_date < (s.year_month || '-01')::date
  ORDER BY h.movement_date DESC, h.created_at DESC, h.id DESC LIMIT 1) last_ev ON true
WHERE s.status = 'draft' AND NOT coalesce(s.is_manually_added, false)
  AND last_ev.movement_type IN ('resignation','leave_without_pay')
GROUP BY s.year_month ORDER BY s.year_month DESC;

-- C) 當月入職但名冊沒有那一列（只看該店該月「已初始化」者；草稿月份預期 0）
SELECT h.store_id, to_char(h.movement_date, 'YYYY-MM') AS year_month, count(*) AS 入職缺列問題
FROM public.employee_movement_history h
WHERE h.movement_type = 'onboarding' AND h.store_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.monthly_staff_status i WHERE i.store_id = h.store_id AND i.year_month = to_char(h.movement_date, 'YYYY-MM') AND i.status = 'draft')
  AND NOT EXISTS (SELECT 1 FROM public.monthly_staff_status s WHERE s.store_id = h.store_id AND s.year_month = to_char(h.movement_date, 'YYYY-MM') AND s.employee_code = h.employee_code)
GROUP BY h.store_id, to_char(h.movement_date, 'YYYY-MM') ORDER BY year_month DESC, 入職缺列問題 DESC;

-- D) 名冊職位與「該月底有效升職」不一致（草稿月份預期 0；已送審／已確認月份不一致應已進 pending_recheck）
SELECT s.year_month, s.status,
  count(*) AS 職位不一致筆數,
  count(*) FILTER (WHERE s.status IN ('submitted','confirmed') AND EXISTS (
    SELECT 1 FROM public.monthly_staff_recheck r WHERE r.employee_code = s.employee_code AND r.store_id = s.store_id AND r.year_month = s.year_month
      AND r.field = 'position' AND r.status = 'pending')) AS 其中已在需重新確認清單
FROM public.monthly_staff_status s
JOIN LATERAL public.workspace_effective_promotion(s.employee_code, ((s.year_month || '-01')::date + interval '1 month - 1 day')::date) e ON true
WHERE s.employee_code IS NOT NULL AND e.pos IS NOT NULL AND s."position" IS DISTINCT FROM e.pos
GROUP BY s.year_month, s.status ORDER BY s.year_month DESC, s.status;

-- E) 員工主檔職位與「今天以前最新有效升職」不一致（預期 0；有則代表主檔職位同步沒跑到）
SELECT count(*) AS 主檔職位不一致人數
FROM (SELECT DISTINCT employee_code FROM public.employee_movement_history WHERE movement_type = 'promotion') c
JOIN LATERAL public.workspace_effective_promotion(c.employee_code, (now() AT TIME ZONE 'Asia/Taipei')::date) e ON true
JOIN public.store_employees se ON se.employee_code = c.employee_code AND se.is_active
WHERE se.current_position IS DISTINCT FROM e.pos;

-- F) 異動重算留下的調整紀錄與需重新確認，依月份統計（供對帳；不是問題清單）
SELECT year_month, count(*) AS adjustment_rows, count(DISTINCT employee_code) AS employees
FROM public.monthly_staff_adjustment_log GROUP BY year_month ORDER BY year_month DESC LIMIT 24;
