-- M9 草稿 30 套用前預覽：只有 SELECT，不改資料。回答「套用後會碰到什麼」。
-- 1) 現況：這些物件目前是否已存在（預期前三欄為 false）
SELECT to_regclass('public.workspace_promotion_requests') IS NOT NULL AS requests_exists,
       to_regclass('public.workspace_promotion_activation') IS NOT NULL AS activation_exists,
       to_regprocedure('public.workspace_apply_due_promotions(date)') IS NOT NULL AS apply_fn_exists,
       EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') AS pg_cron_installed;
-- 2) 回補預期筆數：收據表一開始是空的，所以預期回補 0 筆（表尚未建立時不用跑這句）
-- SELECT count(*) FROM public.workspace_promotion_requests;
-- 3) 日後會被函式更新的人員資料規模
SELECT (SELECT count(*) FROM public.store_employees) AS store_employees_rows,
       (SELECT count(*) FROM public.monthly_staff_status) AS monthly_rows,
       (SELECT count(*) FROM public.employee_movement_history WHERE movement_type='promotion') AS promotion_history_rows,
       (SELECT count(*) FROM public.employee_movement_history WHERE movement_type='promotion' AND movement_date>(now() AT TIME ZONE 'Asia/Taipei')::date) AS future_promotion_rows;
-- 4) 儲存函式要求「同店同員編恰好一列」：違反者無法用新版儲存升遷（預期 0 列）
SELECT store_id, employee_code, count(*) AS n FROM public.store_employees GROUP BY store_id, employee_code HAVING count(*)>1 ORDER BY n DESC LIMIT 50;
-- 5) 員編需為大寫、去空白、長度 20 以內（不符者無法儲存升遷；預期 0 列）
SELECT id, employee_code FROM public.store_employees WHERE employee_code IS NOT NULL AND (employee_code<>upper(btrim(employee_code)) OR length(employee_code)>20) LIMIT 50;
-- 6) 目前職位值不在儲存函式允許清單者（供人工確認，不影響套用）
SELECT position, count(*) FROM public.store_employees
 WHERE position NOT IN ('總經理','副總經理','資深經理','經理','督導','店長','副店長','主任','資深副理','副理','組長','資深專員','高級專員','專員','出納專員','助理','新人','行政','兼職專員','兼職藥師','兼職藥師專員','兼職助理','代理店長')
 GROUP BY position ORDER BY 2 DESC;
