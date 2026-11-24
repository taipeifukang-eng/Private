-- M9 草稿 80 備份：套用 80_movement_batch_monthly_roster.sql 之前先執行（尚未套用到正式區）。
-- 為什麼要備份：套用後，異動登記／初始化月份／刪除或修改異動／到期升職會改寫每月人員名冊、員工主檔、異動歷史與調店申請；
--   套用本檔當下還會把異動類型檢查換成較寬的版本。這裡先把會被改寫的表整張複製一份，以及會被取代的函式原始碼。
-- 做法：CREATE TABLE IF NOT EXISTS ... AS SELECT（重跑不會覆蓋第一次的備份；要重做備份請先人工 DROP 舊備份表）。
--   備份表啟用 RLS 並收回 anon／authenticated／PUBLIC 權限，避免前端讀到人員資料。命名沿用草稿 30 的 backup_m9_<組號>_ 前綴。
-- 還原範例寫在檔尾註解（預設不執行，由人確認後手動執行）。
BEGIN;

CREATE TABLE IF NOT EXISTS public.backup_m9_80_monthly_staff_status AS SELECT now() AS backed_up_at, m.* FROM public.monthly_staff_status m;
CREATE TABLE IF NOT EXISTS public.backup_m9_80_store_employees AS SELECT now() AS backed_up_at, e.* FROM public.store_employees e;
CREATE TABLE IF NOT EXISTS public.backup_m9_80_employee_movement_history AS SELECT now() AS backed_up_at, h.* FROM public.employee_movement_history h;
CREATE TABLE IF NOT EXISTS public.backup_m9_80_store_transfer_requests AS SELECT now() AS backed_up_at, r.* FROM public.store_transfer_requests r;

-- 月份需重新確認清單（草稿 15 建立；若還沒有就略過）
DO $$
BEGIN
  IF to_regclass('public.monthly_staff_recheck') IS NOT NULL AND to_regclass('public.backup_m9_80_monthly_staff_recheck') IS NULL THEN
    EXECUTE 'CREATE TABLE public.backup_m9_80_monthly_staff_recheck AS SELECT now() AS backed_up_at, r.* FROM public.monthly_staff_recheck r';
  END IF;
END $$;

-- 會被取代／新增的函式現行原始碼，以及要被替換的約束定義（供還原時照抄）
CREATE TABLE IF NOT EXISTS public.backup_m9_80_definitions AS
SELECT now() AS backed_up_at, 'function'::text AS kind, p.oid::regprocedure::text AS name, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN (
  'workspace_save_monthly_allowance','workspace_save_monthly_summary','workspace_add_monthly_employee',
  'workspace_movement_snapshot','workspace_movement_save','workspace_movement_preview',
  'workspace_position_rank','workspace_effective_promotion','workspace_employee_master_position_sync',
  'workspace_acting_end_event','workspace_acting_active','workspace_roster_recompute','workspace_roster_apply_store_month',
  'workspace_apply_due_promotions','workspace_employee_master_resync','workspace_movement_update','workspace_movement_delete',
  'workspace_extract_store_code','workspace_monthly_roster_page','calculate_bonus_block','update_calculated_block')
UNION ALL
SELECT now(), 'constraint', c.conname, pg_get_constraintdef(c.oid)
FROM pg_constraint c WHERE c.conrelid = 'public.employee_movement_history'::regclass AND c.conname = 'valid_movement_type';

ALTER TABLE public.backup_m9_80_monthly_staff_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_m9_80_store_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_m9_80_employee_movement_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_m9_80_store_transfer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_m9_80_definitions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_m9_80_monthly_staff_status FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.backup_m9_80_store_employees FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.backup_m9_80_employee_movement_history FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.backup_m9_80_store_transfer_requests FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.backup_m9_80_definitions FROM PUBLIC,anon,authenticated;
DO $$
BEGIN
  IF to_regclass('public.backup_m9_80_monthly_staff_recheck') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.backup_m9_80_monthly_staff_recheck ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON public.backup_m9_80_monthly_staff_recheck FROM PUBLIC,anon,authenticated';
  END IF;
END $$;

-- 備份筆數對照（備份當下應與原表相同；重跑時若原表已被改動，兩者不同是正常的，代表備份保留了第一次的狀態）
SELECT 'monthly_staff_status' AS t, (SELECT count(*) FROM public.monthly_staff_status) AS live, (SELECT count(*) FROM public.backup_m9_80_monthly_staff_status) AS backup
UNION ALL SELECT 'store_employees', (SELECT count(*) FROM public.store_employees), (SELECT count(*) FROM public.backup_m9_80_store_employees)
UNION ALL SELECT 'employee_movement_history', (SELECT count(*) FROM public.employee_movement_history), (SELECT count(*) FROM public.backup_m9_80_employee_movement_history)
UNION ALL SELECT 'store_transfer_requests', (SELECT count(*) FROM public.store_transfer_requests), (SELECT count(*) FROM public.backup_m9_80_store_transfer_requests)
UNION ALL SELECT 'definitions（函式與約束原始碼）', NULL, (SELECT count(*) FROM public.backup_m9_80_definitions);
COMMIT;

-- ===== 還原範例（預設不執行；請先確認要還原哪些月份／員工，且只還原名冊與異動回寫會改的欄位）=====
-- 1) 還原每月人員名冊（只還原重算會改的欄位；備份裡存在的列。重算新增的列不在備份內，需另行判斷是否刪除）
-- BEGIN;
-- UPDATE public.monthly_staff_status m SET position=b.position, newbie_level=b.newbie_level, is_acting_manager=b.is_acting_manager,
--   is_pharmacist=b.is_pharmacist, monthly_status=b.monthly_status, work_days=b.work_days, partial_month_reason=b.partial_month_reason,
--   partial_month_notes=b.partial_month_notes, total_days_in_month=b.total_days_in_month, employment_type=b.employment_type,
--   start_date=b.start_date, is_manually_added=b.is_manually_added, updated_at=b.updated_at
--   FROM public.backup_m9_80_monthly_staff_status b WHERE b.id=m.id AND m.year_month = '2026-10';  -- 改成要還原的月份
-- 重算新增的列（不在備份內）：
-- DELETE FROM public.monthly_staff_status m WHERE m.year_month='2026-10' AND NOT EXISTS (SELECT 1 FROM public.backup_m9_80_monthly_staff_status b WHERE b.id=m.id);
-- 重算移出的列（備份有、現在沒有）：備份表第一欄是 backed_up_at，不能直接 SELECT *；
--   請先用下面查詢找出缺少的列，再依欄位清單逐欄 INSERT 補回（欄位清單見 schema-intake 的 monthly_staff_status）。
-- SELECT b.* FROM public.backup_m9_80_monthly_staff_status b WHERE b.year_month='2026-10' AND NOT EXISTS (SELECT 1 FROM public.monthly_staff_status m WHERE m.id=b.id);
-- COMMIT;
-- 2) 還原員工主檔（職位、狀態）
-- UPDATE public.store_employees e SET position=b.position, current_position=b.current_position, last_promotion_date=b.last_promotion_date,
--   is_active=b.is_active, employment_status=b.employment_status, last_movement_date=b.last_movement_date, last_movement_type=b.last_movement_type, updated_at=b.updated_at
--   FROM public.backup_m9_80_store_employees b WHERE b.id=e.id;
-- 3) 還原被刪除的異動歷史（只補回備份有、現在沒有的列）
-- INSERT INTO public.employee_movement_history (id,employee_code,employee_name,store_id,movement_date,new_value,old_value,notes,created_by,created_at,updated_at,movement_type,onboarding_is_pharmacist)
--   SELECT b.id,b.employee_code,b.employee_name,b.store_id,b.movement_date,b.new_value,b.old_value,b.notes,b.created_by,b.created_at,b.updated_at,b.movement_type,b.onboarding_is_pharmacist
--   FROM public.backup_m9_80_employee_movement_history b WHERE NOT EXISTS (SELECT 1 FROM public.employee_movement_history h WHERE h.id=b.id);
-- 4) 還原被撤銷的調店申請（刪除調店異動會把申請標為 rejected 並清掉 movement_history_id）
-- UPDATE public.store_transfer_requests r SET status=b.status, movement_history_id=b.movement_history_id, notes=b.notes
--   FROM public.backup_m9_80_store_transfer_requests b WHERE b.id=r.id AND (r.status IS DISTINCT FROM b.status OR r.movement_history_id IS DISTINCT FROM b.movement_history_id);
