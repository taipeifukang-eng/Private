-- M4 W17 步驟 B：改善回補函式改按台灣日期算，逾期（回報日超過改善期限）一律回補 0。
-- 【重要】請只單獨執行本檔，本檔以 BEGIN; 開頭，不會自動提交：
--   執行完看過回傳，再另外執行 COMMIT;（確認）或 ROLLBACK;（放棄）。忘了的話連線結束會自動回滾。
--   請先執行並看過 w17_A_preview.sql。
-- 內容：
--   1. 備份：把目前的 calculate_improvement_bonus 函式內容存進 public.m4_w17_backup（步驟 C 依此還原）。
--   2. 函式改寫：days_taken = 回報當天（台灣日期）- 巡店日（最小 0）；回報日超過 deadline 則回補 0；
--      其餘（啟用中規則、依 sort_order 取第一條符合者、扣分乘比例四捨五入到小數一位）完全不變。
--   3. 狀態從 pending 或 overdue 變成 improved 時都會計算（Q19：被補跑程式標成已逾期的項目也可補報，回補 0）。
-- 不重算既有資料：已改善的歷史紀錄維持原本的天數與分數。
BEGIN;

CREATE TABLE IF NOT EXISTS public.m4_w17_backup (
  name text PRIMARY KEY,
  definition text NOT NULL,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.m4_w17_backup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.m4_w17_backup FROM anon, authenticated;
INSERT INTO public.m4_w17_backup (name, definition)
SELECT 'calculate_improvement_bonus', pg_get_functiondef(p.oid)
FROM pg_proc p WHERE p.proname = 'calculate_improvement_bonus'
ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.calculate_improvement_bonus()
RETURNS TRIGGER AS $$
DECLARE
  v_inspection_date DATE;
  v_bonus_percent DECIMAL(5,2);
  v_deduction DECIMAL(10,2);
  v_report_date DATE;
BEGIN
  IF NEW.status = 'improved' AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'improved') THEN
    SELECT inspection_date INTO v_inspection_date FROM inspection_masters WHERE id = NEW.inspection_id;
    v_report_date := (NEW.improved_at AT TIME ZONE 'Asia/Taipei')::date;
    NEW.days_taken := GREATEST((v_report_date - v_inspection_date), 0);
    IF NEW.deadline IS NOT NULL AND v_report_date > NEW.deadline THEN
      v_bonus_percent := 0;
    ELSE
      SELECT COALESCE(bc.bonus_score, 0) INTO v_bonus_percent
      FROM inspection_bonus_config bc
      WHERE bc.is_active = true AND NEW.days_taken BETWEEN bc.day_from AND bc.day_to
      ORDER BY bc.sort_order LIMIT 1;
    END IF;
    v_deduction := COALESCE(NEW.deduction_amount, 0);
    NEW.bonus_score := ROUND((v_deduction * COALESCE(v_bonus_percent, 0) / 100.0)::numeric, 1);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 核對（請看回傳）：函式已含台灣時區與期限保護、備份存在。
SELECT (SELECT prosrc LIKE '%Asia/Taipei%' AND prosrc LIKE '%deadline%' FROM pg_proc WHERE proname = 'calculate_improvement_bonus') AS function_updated,
       EXISTS (SELECT 1 FROM public.m4_w17_backup WHERE name = 'calculate_improvement_bonus') AS backup_saved;
-- 看過沒問題後，另外執行 COMMIT;  有疑慮則執行 ROLLBACK;
