-- DEV only (M4 W17 Q17、Q19)：改善回補的「過了幾天」一律按台灣日期算；逾期回報一律回補 0。
-- 公式（扣分乘回補比例，四捨五入到小數一位）與規則挑選方式（啟用中、依 sort_order 取第一條符合者）完全不變。
--  Q17：days_taken = 回報當天（台灣日期）- 巡店日，最小 0。舊版正式區用 improved_at::date（UTC 日期）。
--  Q19：回報當天（台灣日期）超過改善期限 deadline 時，回補一律 0（狀態不論是 pending 或補跑程式標的 overdue 都可回報）。
BEGIN;
CREATE OR REPLACE FUNCTION public.calculate_improvement_bonus()
RETURNS TRIGGER AS $$
DECLARE
  v_inspection_date DATE;
  v_bonus_percent DECIMAL(5,2);
  v_deduction DECIMAL(10,2);
  v_report_date DATE;
BEGIN
  -- 只在狀態變為 improved 時計算（來源可以是 pending，也可以是補跑程式標成的 overdue）
  IF NEW.status = 'improved' AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'improved') THEN

    SELECT inspection_date INTO v_inspection_date
    FROM inspection_masters
    WHERE id = NEW.inspection_id;

    v_report_date := (NEW.improved_at AT TIME ZONE 'Asia/Taipei')::date;
    NEW.days_taken := GREATEST((v_report_date - v_inspection_date), 0);

    IF NEW.deadline IS NOT NULL AND v_report_date > NEW.deadline THEN
      v_bonus_percent := 0;
    ELSE
      SELECT COALESCE(bc.bonus_score, 0) INTO v_bonus_percent
      FROM inspection_bonus_config bc
      WHERE bc.is_active = true
        AND NEW.days_taken BETWEEN bc.day_from AND bc.day_to
      ORDER BY bc.sort_order
      LIMIT 1;
    END IF;

    v_deduction := COALESCE(NEW.deduction_amount, 0);
    NEW.bonus_score := ROUND((v_deduction * COALESCE(v_bonus_percent, 0) / 100.0)::numeric, 1);

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
NOTIFY pgrst, 'reload schema';
COMMIT;
