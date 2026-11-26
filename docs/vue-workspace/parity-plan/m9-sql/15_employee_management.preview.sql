-- 15_employee_management 套用前預覽（唯讀，只有 SELECT；不依賴 15_employee_management.sql 已套用，規則直接寫在查詢裡）。
-- 目的：員編規則觸發器上線後，舊版「入職異動」與「每月人員狀態手動新增」遇到不合規員編會被擋；先看現況再決定是否上線。
-- 合規規則：^(FK[0-9]{4}|FKF[0-9]{5}|FKPT[0-9]{3})$（FKI 一律不合規）。既有資料不會被改動，這裡只是看「哪些既有員編不合規」。
-- 請逐段執行（每段一個結果表）。

-- 1. 前置條件：必須都是 true（newbie_level 缺少時請先跑 m2-sql/backfill_employee_stage_A_add_column.sql）
SELECT
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='store_employees' AND column_name='newbie_level') AS has_newbie_level,
  EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='monthly_staff_status' AND column_name='is_manually_added') AS has_is_manually_added,
  to_regclass('public.monthly_store_summary') IS NOT NULL AS has_monthly_store_summary;

-- 2. 三張資料表的員編合規統計（依前綴分組；既有不合規員編不會被改動，只是日後新增同類員編會被擋）
SELECT 'store_employees' AS source,
  CASE WHEN employee_code IS NULL OR btrim(employee_code)='' THEN '空白'
       WHEN employee_code ~ '^(FK[0-9]{4}|FKF[0-9]{5}|FKPT[0-9]{3})$' THEN '合規'
       WHEN upper(btrim(employee_code)) LIKE 'FKI%' THEN 'FKI（實習生）'
       WHEN employee_code <> upper(btrim(employee_code)) THEN '大小寫或空白不一致'
       ELSE '其他不合規' END AS code_class,
  count(*) AS rows_count
FROM public.store_employees GROUP BY 1,2
UNION ALL
SELECT 'employee_movement_history',
  CASE WHEN employee_code IS NULL OR btrim(employee_code)='' THEN '空白'
       WHEN employee_code ~ '^(FK[0-9]{4}|FKF[0-9]{5}|FKPT[0-9]{3})$' THEN '合規'
       WHEN upper(btrim(employee_code)) LIKE 'FKI%' THEN 'FKI（實習生）'
       WHEN employee_code <> upper(btrim(employee_code)) THEN '大小寫或空白不一致'
       ELSE '其他不合規' END,
  count(*)
FROM public.employee_movement_history GROUP BY 1,2
UNION ALL
SELECT 'monthly_staff_status',
  CASE WHEN employee_code IS NULL OR btrim(employee_code)='' THEN '空白'
       WHEN employee_code ~ '^(FK[0-9]{4}|FKF[0-9]{5}|FKPT[0-9]{3})$' THEN '合規'
       WHEN upper(btrim(employee_code)) LIKE 'FKI%' THEN 'FKI（實習生）'
       WHEN employee_code <> upper(btrim(employee_code)) THEN '大小寫或空白不一致'
       ELSE '其他不合規' END,
  count(*)
FROM public.monthly_staff_status GROUP BY 1,2
ORDER BY 1,2;

-- 3. 員工主檔中不合規員編的明細（最多 200 筆）
SELECT id, employee_code, employee_name, position, employment_type, is_active, employment_status, start_date
FROM public.store_employees
WHERE employee_code IS NULL OR employee_code !~ '^(FK[0-9]{4}|FKF[0-9]{5}|FKPT[0-9]{3})$'
ORDER BY employee_code NULLS FIRST, id
LIMIT 200;

-- 4. 觸發器影響面一：每月人員狀態「手動新增」的列，員編不合規或留空者（新增同類資料日後會被擋；既有列不受影響）
SELECT year_month, count(*) AS manual_rows,
  count(*) FILTER (WHERE employee_code IS NULL OR btrim(employee_code)='') AS blank_code,
  count(*) FILTER (WHERE employee_code IS NOT NULL AND btrim(employee_code)<>'' AND employee_code !~ '^(FK[0-9]{4}|FKF[0-9]{5}|FKPT[0-9]{3})$') AS invalid_code
FROM public.monthly_staff_status
WHERE coalesce(is_manually_added,false)
GROUP BY year_month ORDER BY year_month DESC LIMIT 24;

-- 5. 觸發器影響面二：最近 180 天「入職異動」員編不合規的筆數（代表舊版入職流程近期有多常用到不合規員編）
SELECT date_trunc('month', movement_date)::date AS month, count(*) AS onboarding_rows,
  count(*) FILTER (WHERE employee_code !~ '^(FK[0-9]{4}|FKF[0-9]{5}|FKPT[0-9]{3})$') AS invalid_code
FROM public.employee_movement_history
WHERE movement_type='onboarding' AND movement_date >= (now() AT TIME ZONE 'Asia/Taipei')::date - 180
GROUP BY 1 ORDER BY 1 DESC;

-- 6. 員工主檔中以去除空白、轉大寫後重複的員編（員工新增／匯入以此判斷重複；既有重複請先處理）
SELECT upper(btrim(employee_code)) AS code, count(*) AS rows_count
FROM public.store_employees
WHERE employee_code IS NOT NULL
GROUP BY 1 HAVING count(*)>1
ORDER BY rows_count DESC, code LIMIT 100;

-- 7. 目前正式區是否已有同名物件（應全為 0 列；有列代表曾套用過或名稱衝突，請先確認）
SELECT 'function' AS kind, p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('workspace_birthday_snapshot','workspace_birthday_save','workspace_employee_create','workspace_employee_edit_state','workspace_employee_edit','workspace_employee_import_check','workspace_employee_import_save','workspace_employee_id_valid','workspace_employee_id_type','workspace_monthly_recheck_add','workspace_staff_month_locked','workspace_guard_onboarding_code','workspace_guard_manual_staff_code')
UNION ALL
SELECT 'table', c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN ('workspace_birthday_requests','workspace_employee_create_requests','workspace_employee_edit_requests','workspace_employee_import_receipts','monthly_staff_recheck')
UNION ALL
SELECT 'trigger', t.tgname FROM pg_trigger t WHERE NOT t.tgisinternal AND t.tgname IN ('workspace_guard_onboarding_code','workspace_guard_manual_staff_code');
