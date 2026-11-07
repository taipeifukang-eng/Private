-- M4 W18 步驟 C：撤回步驟 B。以 BEGIN; 開頭，不會自動提交，看過回傳再另外執行 COMMIT; 或 ROLLBACK;。
-- 依 public.m4_w18_backup 還原 update_inspection_bonus_total 原本的內容，移除 snapshot 觸發器與函式、grade_thresholds 欄位。
-- 注意：撤回後，已完成單的評級恢復「加分時依函式原本邏輯」重算；單子上已存的 total_score／grade／improvement_bonus 不會被改動。
BEGIN;
DO $$
DECLARE d text;
BEGIN
  SELECT definition INTO d FROM public.m4_w18_backup WHERE name = 'update_inspection_bonus_total';
  IF d IS NULL THEN RAISE EXCEPTION '找不到備份（public.m4_w18_backup），請勿繼續'; END IF;
  EXECUTE d;
END $$;
DROP TRIGGER IF EXISTS workspace_01_grade_snapshot ON public.inspection_masters;
DROP FUNCTION IF EXISTS public.workspace_snapshot_grade_thresholds();
DROP FUNCTION IF EXISTS public.workspace_grade_for_score(numeric, jsonb);
ALTER TABLE public.inspection_masters DROP COLUMN IF EXISTS grade_thresholds;
-- 備份表保留（內容很小，確認撤回成功後可自行 DROP TABLE public.m4_w18_backup;）。
SELECT (SELECT prosrc LIKE '%215%' FROM pg_proc WHERE proname = 'update_inspection_bonus_total') AS bonus_fn_restored_hardcoded,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'inspection_masters' AND column_name = 'grade_thresholds') AS column_still_exists;
-- 看過沒問題後，另外執行 COMMIT;  有疑慮則執行 ROLLBACK;
