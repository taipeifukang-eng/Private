-- Rollback of 20261108100000_m4_w17_improvement_taipei_overdue.sql (DEV only)：還原成 20261028020000_vue_improvements.sql 的版本（台灣日期、沒有逾期保護）。
BEGIN;
CREATE OR REPLACE FUNCTION public.calculate_improvement_bonus()
RETURNS TRIGGER AS $$
DECLARE
  v_inspection_date DATE;
  v_bonus_percent DECIMAL(5,2);
  v_deduction DECIMAL(10,2);
BEGIN
  IF NEW.status = 'improved' AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'improved') THEN
    SELECT inspection_date INTO v_inspection_date
    FROM inspection_masters
    WHERE id = NEW.inspection_id;
    NEW.days_taken := GREATEST(((NEW.improved_at AT TIME ZONE 'Asia/Taipei')::date - v_inspection_date), 0);
    SELECT COALESCE(bc.bonus_score, 0) INTO v_bonus_percent
    FROM inspection_bonus_config bc
    WHERE bc.is_active = true
      AND NEW.days_taken BETWEEN bc.day_from AND bc.day_to
    ORDER BY bc.sort_order
    LIMIT 1;
    v_deduction := COALESCE(NEW.deduction_amount, 0);
    NEW.bonus_score := ROUND((v_deduction * COALESCE(v_bonus_percent, 0) / 100.0)::numeric, 1);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
NOTIFY pgrst, 'reload schema';
COMMIT;
