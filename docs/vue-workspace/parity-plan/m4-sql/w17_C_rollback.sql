-- M4 W17 步驟 C：撤回步驟 B。以 BEGIN; 開頭，不會自動提交，看過回傳再另外執行 COMMIT; 或 ROLLBACK;。
-- 依 public.m4_w17_backup 還原 calculate_improvement_bonus 原本的內容（UTC 日期、沒有逾期保護）。已寫入的資料不會被改動。
BEGIN;
DO $$
DECLARE d text;
BEGIN
  SELECT definition INTO d FROM public.m4_w17_backup WHERE name = 'calculate_improvement_bonus';
  IF d IS NULL THEN RAISE EXCEPTION '找不到備份（public.m4_w17_backup），請勿繼續'; END IF;
  EXECUTE d;
END $$;
SELECT (SELECT prosrc LIKE '%Asia/Taipei%' FROM pg_proc WHERE proname = 'calculate_improvement_bonus') AS still_taipei;
-- 備份表保留（確認撤回成功後可自行 DROP TABLE public.m4_w17_backup;）。
-- 看過沒問題後，另外執行 COMMIT;  有疑慮則執行 ROLLBACK;
