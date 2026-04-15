-- =====================================================
-- 改善加分改為「扣分回補比例」
-- 日期: 2026-04-15
-- 說明:
--   1) inspection_bonus_config.bonus_score 改為儲存百分比（%）
--   2) calculate_improvement_bonus 以 deduction_amount * 百分比 計算回補分數
--   3) 重新計算既有 improved 資料與 inspection_masters 總加分
-- =====================================================

-- STEP 1: 更新預設規則為百分比
UPDATE inspection_bonus_config
SET
  bonus_score = CASE
    WHEN day_from = 0 AND day_to = 3 THEN 20
    WHEN day_from = 4 AND day_to = 5 THEN 10
    WHEN day_from = 6 AND day_to = 7 THEN 5
    ELSE bonus_score
  END,
  description = CASE
    WHEN day_from = 0 AND day_to = 3 THEN '3天內改善，回補扣分 20%'
    WHEN day_from = 4 AND day_to = 5 THEN '4-5天改善，回補扣分 10%'
    WHEN day_from = 6 AND day_to = 7 THEN '6-7天改善，回補扣分 5%'
    ELSE description
  END,
  updated_at = NOW()
WHERE is_active = true;

-- STEP 2: 改寫計算函數（改為百分比回補）
CREATE OR REPLACE FUNCTION calculate_improvement_bonus()
RETURNS TRIGGER AS $$
DECLARE
  v_inspection_date DATE;
  v_bonus_percent DECIMAL(5,2);
  v_deduction DECIMAL(10,2);
BEGIN
  -- 只在狀態變為 improved 時計算
  IF NEW.status = 'improved' AND (OLD IS NULL OR OLD.status IS DISTINCT FROM 'improved') THEN

    SELECT inspection_date INTO v_inspection_date
    FROM inspection_masters
    WHERE id = NEW.inspection_id;

    NEW.days_taken := GREATEST((NEW.improved_at::date - v_inspection_date), 0);

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- STEP 3: 重新計算既有 improved 的回補分數
UPDATE inspection_improvements ii
SET
  days_taken = GREATEST((COALESCE(ii.improved_at, NOW())::date - im.inspection_date), 0),
  bonus_score = ROUND(
    (
      COALESCE(ii.deduction_amount, 0)
      * COALESCE((
        SELECT bc.bonus_score
        FROM inspection_bonus_config bc
        WHERE bc.is_active = true
          AND GREATEST((COALESCE(ii.improved_at, NOW())::date - im.inspection_date), 0)
            BETWEEN bc.day_from AND bc.day_to
        ORDER BY bc.sort_order
        LIMIT 1
      ), 0)
      / 100.0
    )::numeric,
    1
  ),
  updated_at = NOW()
FROM inspection_masters im
WHERE ii.inspection_id = im.id
  AND ii.status = 'improved';

-- STEP 4: 同步重算 inspection_masters 的 improvement_bonus/total_score/grade
UPDATE inspection_masters im
SET
  improvement_bonus = COALESCE(calc.total_bonus, 0),
  total_score = (COALESCE(im.total_score, 0) - COALESCE(im.improvement_bonus, 0)) + COALESCE(calc.total_bonus, 0),
  grade = CASE
    WHEN ((COALESCE(im.total_score, 0) - COALESCE(im.improvement_bonus, 0)) + COALESCE(calc.total_bonus, 0)) >= 220 THEN '10'
    WHEN ((COALESCE(im.total_score, 0) - COALESCE(im.improvement_bonus, 0)) + COALESCE(calc.total_bonus, 0)) >= 215 THEN '9'
    WHEN ((COALESCE(im.total_score, 0) - COALESCE(im.improvement_bonus, 0)) + COALESCE(calc.total_bonus, 0)) >= 191 THEN '8'
    WHEN ((COALESCE(im.total_score, 0) - COALESCE(im.improvement_bonus, 0)) + COALESCE(calc.total_bonus, 0)) >= 181 THEN '7'
    WHEN ((COALESCE(im.total_score, 0) - COALESCE(im.improvement_bonus, 0)) + COALESCE(calc.total_bonus, 0)) >= 171 THEN '6'
    WHEN ((COALESCE(im.total_score, 0) - COALESCE(im.improvement_bonus, 0)) + COALESCE(calc.total_bonus, 0)) >= 161 THEN '5'
    WHEN ((COALESCE(im.total_score, 0) - COALESCE(im.improvement_bonus, 0)) + COALESCE(calc.total_bonus, 0)) >= 151 THEN '4'
    WHEN ((COALESCE(im.total_score, 0) - COALESCE(im.improvement_bonus, 0)) + COALESCE(calc.total_bonus, 0)) >= 141 THEN '3'
    WHEN ((COALESCE(im.total_score, 0) - COALESCE(im.improvement_bonus, 0)) + COALESCE(calc.total_bonus, 0)) >= 131 THEN '2'
    WHEN ((COALESCE(im.total_score, 0) - COALESCE(im.improvement_bonus, 0)) + COALESCE(calc.total_bonus, 0)) >= 121 THEN '1'
    ELSE '0'
  END
FROM (
  SELECT inspection_id, COALESCE(SUM(bonus_score), 0) AS total_bonus
  FROM inspection_improvements
  WHERE status = 'improved'
  GROUP BY inspection_id
) calc
WHERE calc.inspection_id = im.id;
