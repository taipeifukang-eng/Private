-- M9 草稿 30 備份：套用 30_store_promotions_queue.sql 之前先執行。
-- 把三張人員表整張複製到 backup_m9_30_* 表（CREATE TABLE IF NOT EXISTS：重跑不會覆蓋第一次的備份；要重做備份請先人工 DROP 舊備份）。
-- 備份表啟用 RLS 且收回 anon / authenticated 權限，避免被前端讀到人員資料。
-- 還原範例（預設不執行，由人確認後手動執行）寫在檔尾註解。
BEGIN;
CREATE TABLE IF NOT EXISTS public.backup_m9_30_store_employees AS SELECT now() AS backed_up_at, e.* FROM public.store_employees e;
CREATE TABLE IF NOT EXISTS public.backup_m9_30_monthly_staff_status AS SELECT now() AS backed_up_at, m.* FROM public.monthly_staff_status m;
CREATE TABLE IF NOT EXISTS public.backup_m9_30_employee_movement_history AS SELECT now() AS backed_up_at, h.* FROM public.employee_movement_history h;
ALTER TABLE public.backup_m9_30_store_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_m9_30_monthly_staff_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_m9_30_employee_movement_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_m9_30_store_employees FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.backup_m9_30_monthly_staff_status FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.backup_m9_30_employee_movement_history FROM PUBLIC,anon,authenticated;
-- 備份筆數對照（備份當下應與原表相同）
SELECT 'store_employees' AS t,(SELECT count(*) FROM public.store_employees) AS live,(SELECT count(*) FROM public.backup_m9_30_store_employees) AS backup
UNION ALL SELECT 'monthly_staff_status',(SELECT count(*) FROM public.monthly_staff_status),(SELECT count(*) FROM public.backup_m9_30_monthly_staff_status)
UNION ALL SELECT 'employee_movement_history',(SELECT count(*) FROM public.employee_movement_history),(SELECT count(*) FROM public.backup_m9_30_employee_movement_history);
COMMIT;

-- ===== 還原範例（預設不執行；只還原升遷功能會改的欄位，且只還原備份裡存在的列）=====
-- BEGIN;
-- UPDATE public.store_employees e SET position=b.position, current_position=b.current_position, last_promotion_date=b.last_promotion_date, updated_at=b.updated_at
--   FROM public.backup_m9_30_store_employees b WHERE b.id=e.id;
-- UPDATE public.monthly_staff_status m SET position=b.position, newbie_level=b.newbie_level, is_acting_manager=b.is_acting_manager, updated_at=b.updated_at
--   FROM public.backup_m9_30_monthly_staff_status b WHERE b.id=m.id;
-- -- 備份之後由新版工作台新增的升遷歷史：確認後再刪
-- -- DELETE FROM public.employee_movement_history h WHERE h.movement_type='promotion' AND NOT EXISTS (SELECT 1 FROM public.backup_m9_30_employee_movement_history b WHERE b.id=h.id);
-- COMMIT;
