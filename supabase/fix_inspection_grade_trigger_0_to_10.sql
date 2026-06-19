-- 修正巡店明細異動時，舊 trigger function 將 grade 寫回 S/A/B/F 的問題。
-- 同時支援 DELETE inspection_results 時重新計算主表分數。

ALTER TABLE inspection_masters
  DROP CONSTRAINT IF EXISTS inspection_masters_grade_check;

ALTER TABLE inspection_masters
  ADD CONSTRAINT inspection_masters_grade_check
  CHECK (grade IN ('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'));

CREATE OR REPLACE FUNCTION auto_calculate_total_score()
RETURNS TRIGGER AS $$
DECLARE
  v_inspection_id UUID;
  v_total_score DECIMAL(6,1);
  v_section_1 DECIMAL(5,1);
  v_section_2 DECIMAL(5,1);
  v_section_3 DECIMAL(5,1);
  v_section_4 DECIMAL(5,1);
  v_section_5 DECIMAL(5,1);
  v_grade VARCHAR(2);
  v_max_score DECIMAL(6,1);
BEGIN
  v_inspection_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.inspection_id ELSE NEW.inspection_id END;

  SELECT COALESCE(max_possible_score, 220)
  INTO v_max_score
  FROM inspection_masters
  WHERE id = v_inspection_id;

  SELECT
    COALESCE(SUM(CASE WHEN t.section = 'section_1' THEN r.given_score ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN t.section = 'section_2' THEN r.given_score ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN t.section = 'section_3' THEN r.given_score ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN t.section = 'section_4' THEN r.given_score ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN t.section = 'section_5' THEN r.given_score ELSE 0 END), 0)
  INTO v_section_1, v_section_2, v_section_3, v_section_4, v_section_5
  FROM inspection_results r
  JOIN inspection_templates t ON r.template_id = t.id
  WHERE r.inspection_id = v_inspection_id;

  v_total_score := v_section_1 + v_section_2 + v_section_3 + v_section_4 + v_section_5;

  IF v_total_score >= 220 THEN v_grade := '10';
  ELSIF v_total_score >= 215 THEN v_grade := '9';
  ELSIF v_total_score >= 191 THEN v_grade := '8';
  ELSIF v_total_score >= 181 THEN v_grade := '7';
  ELSIF v_total_score >= 171 THEN v_grade := '6';
  ELSIF v_total_score >= 161 THEN v_grade := '5';
  ELSIF v_total_score >= 151 THEN v_grade := '4';
  ELSIF v_total_score >= 141 THEN v_grade := '3';
  ELSIF v_total_score >= 131 THEN v_grade := '2';
  ELSIF v_total_score >= 121 THEN v_grade := '1';
  ELSE v_grade := '0';
  END IF;

  UPDATE inspection_masters
  SET
    section_1_score = v_section_1,
    section_2_score = v_section_2,
    section_3_score = v_section_3,
    section_4_score = v_section_4,
    section_5_score = v_section_5,
    total_score = v_total_score,
    score_percentage = CASE
      WHEN COALESCE(v_max_score, 0) > 0 THEN ROUND((v_total_score / v_max_score) * 100, 2)
      ELSE 0
    END,
    grade = v_grade
  WHERE id = v_inspection_id;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_auto_calculate_total_score ON inspection_results;
CREATE TRIGGER trigger_auto_calculate_total_score
  AFTER INSERT OR UPDATE OR DELETE ON inspection_results
  FOR EACH ROW EXECUTE FUNCTION auto_calculate_total_score();

COMMENT ON COLUMN inspection_masters.grade IS '評級 (0-10分制)';

