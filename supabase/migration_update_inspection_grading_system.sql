-- =====================================================
-- 更新巡店評級系統：從 S/A/B/F 改為 0-10 分制
-- =====================================================

-- 1. 修改 grade 欄位類型，允許 0-10 的字符串值
ALTER TABLE inspection_masters
  DROP CONSTRAINT IF EXISTS inspection_masters_grade_check;

ALTER TABLE inspection_masters
  ADD CONSTRAINT inspection_masters_grade_check 
  CHECK (grade IN ('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'));

-- 2. 更新註解說明新的評級系統
COMMENT ON COLUMN inspection_masters.grade IS '評級 (0-10分制): 10-8分(優秀), 7-6分(良好), 5-4分(尚可), 3-0分(需改善)';

-- 3. 更新自動計算觸發器以使用新的 0-10 分制
CREATE OR REPLACE FUNCTION auto_calculate_total_score()
RETURNS TRIGGER AS $$
DECLARE
  v_section_1 DECIMAL(5,1);
  v_section_2 DECIMAL(5,1);
  v_section_3 DECIMAL(5,1);
  v_section_4 DECIMAL(5,1);
  v_section_5 DECIMAL(5,1);
  v_total_score DECIMAL(6,1);
  v_grade VARCHAR(2);
  v_max_score DECIMAL(6,1);
BEGIN
  -- 獲取最大分數
  SELECT max_possible_score INTO v_max_score
  FROM inspection_masters
  WHERE id = NEW.inspection_id;
  
  -- 如果沒有 max_possible_score，使用預設值 220
  IF v_max_score IS NULL THEN
    v_max_score := 220;
  END IF;
  
  -- 計算各區塊得分（從 inspection_results 匯總）
  SELECT 
    COALESCE(SUM(CASE WHEN t.section = 'section_1' THEN r.given_score ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN t.section = 'section_2' THEN r.given_score ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN t.section = 'section_3' THEN r.given_score ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN t.section = 'section_4' THEN r.given_score ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN t.section = 'section_5' THEN r.given_score ELSE 0 END), 0)
  INTO v_section_1, v_section_2, v_section_3, v_section_4, v_section_5
  FROM inspection_results r
  JOIN inspection_templates t ON r.template_id = t.id
  WHERE r.inspection_id = NEW.inspection_id;
  
  -- 計算總分
  v_total_score := v_section_1 + v_section_2 + v_section_3 + v_section_4 + v_section_5;
  
  -- 判定等級（0-10 分制）
  -- 220分滿分的分數區間：
  -- 10: 220 (100%)
  -- 9: 215-219 (97.7%-99.5%)
  -- 8: 191-214 (86.8%-97.3%)
  -- 7: 181-190 (82.3%-86.4%)
  -- 6: 171-180 (77.7%-81.8%)
  -- 5: 161-170 (73.2%-77.3%)
  -- 4: 151-160 (68.6%-72.7%)
  -- 3: 141-150 (64.1%-68.2%)
  -- 2: 131-140 (59.5%-63.6%)
  -- 1: 121-130 (55.0%-59.1%)
  -- 0: 0-120 (<54.5%)
  
  IF v_total_score >= 220 THEN
    v_grade := '10';
  ELSIF v_total_score >= 215 THEN
    v_grade := '9';
  ELSIF v_total_score >= 191 THEN
    v_grade := '8';
  ELSIF v_total_score >= 181 THEN
    v_grade := '7';
  ELSIF v_total_score >= 171 THEN
    v_grade := '6';
  ELSIF v_total_score >= 161 THEN
    v_grade := '5';
  ELSIF v_total_score >= 151 THEN
    v_grade := '4';
  ELSIF v_total_score >= 141 THEN
    v_grade := '3';
  ELSIF v_total_score >= 131 THEN
    v_grade := '2';
  ELSIF v_total_score >= 121 THEN
    v_grade := '1';
  ELSE
    v_grade := '0';
  END IF;
  
  -- 更新 inspection_masters
  UPDATE inspection_masters
  SET 
    section_1_score = v_section_1,
    section_2_score = v_section_2,
    section_3_score = v_section_3,
    section_4_score = v_section_4,
    section_5_score = v_section_5,
    total_score = v_total_score,
    score_percentage = ROUND((v_total_score / v_max_score) * 100, 2),
    grade = v_grade
  WHERE id = NEW.inspection_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. 確保觸發器存在（如果已存在則不會重複創建）
DROP TRIGGER IF EXISTS trigger_auto_calculate_total_score ON inspection_results;
CREATE TRIGGER trigger_auto_calculate_total_score
  AFTER INSERT OR UPDATE OR DELETE
  ON inspection_results
  FOR EACH ROW
  EXECUTE FUNCTION auto_calculate_total_score();

-- 5. 遷移現有數據（如果有的話）- 將舊的 S/A/B/F 轉換為 0-10 分制
UPDATE inspection_masters
SET grade = CASE 
  WHEN grade = 'S' THEN '10'  -- S 級 (≥208分, 94.5%) → 10分
  WHEN grade = 'A' THEN '8'   -- A 級 (196-207分, 89.1%-94.1%) → 8分
  WHEN grade = 'B' THEN '6'   -- B 級 (188-195分, 85.5%-88.6%) → 6分
  WHEN grade = 'F' THEN '3'   -- F 級 (<188分) → 3分
  ELSE grade  -- 保持已是數字的評級不變
END
WHERE grade IN ('S', 'A', 'B', 'F');

-- 查詢驗證
SELECT 
  id,
  inspection_date,
  total_score,
  max_possible_score,
  score_percentage,
  grade,
  status
FROM inspection_masters
ORDER BY inspection_date DESC
LIMIT 10;
