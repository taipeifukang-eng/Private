-- DEV only: restore existing improvement business triggers; no historical backfill.
BEGIN;
INSERT INTO inspection_bonus_config(day_from,day_to,bonus_score,description,sort_order)
SELECT * FROM (VALUES (0,3,20,'3天內改善，回補扣分 20%',1),(4,5,10,'4-5天改善，回補扣分 10%',2),(6,7,5,'6-7天改善，回補扣分 5%',3)) v
WHERE NOT EXISTS (SELECT 1 FROM inspection_bonus_config);
CREATE OR REPLACE FUNCTION generate_inspection_improvements()
RETURNS TRIGGER AS $$
DECLARE
  v_max_days INT;
  r RECORD;
BEGIN
  -- 只在督導巡店狀態變為 'completed' 時觸發（經理巡店是複檢模組，不產生改善紀錄）
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed')
     AND (NEW.inspection_type IS NULL OR NEW.inspection_type = 'supervisor') THEN
    
    -- 從加分設定取得最大改善天數（取最大的 day_to，預設 7 天）
    SELECT COALESCE(MAX(day_to), 7) INTO v_max_days
    FROM inspection_bonus_config
    WHERE is_active = true;
    
    -- 為每個 is_improvement = true 的項目建立改善紀錄
    FOR r IN
      SELECT
        ir.id AS result_id,
        ir.template_id,
        it.section_name,
        it.item_name,
        ir.deduction_amount,
        ir.notes,
        ir.photo_urls,
        ir.selected_items
      FROM inspection_results ir
      JOIN inspection_templates it ON it.id = ir.template_id
      WHERE ir.inspection_id = NEW.id
        AND ir.is_improvement = true
    LOOP
      INSERT INTO inspection_improvements (
        inspection_id, inspection_result_id, template_id, store_id,
        section_name, item_name, deduction_amount,
        issue_description, issue_photo_urls, selected_items,
        deadline, status
      ) VALUES (
        NEW.id, r.result_id, r.template_id, NEW.store_id,
        r.section_name, r.item_name, r.deduction_amount,
        r.notes,
        COALESCE(r.photo_urls, '[]'::jsonb),
        COALESCE(r.selected_items, '[]'::jsonb),
        NEW.inspection_date + v_max_days,
        'pending'
      )
      ON CONFLICT (inspection_id, template_id) DO NOTHING;
    END LOOP;
    
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trigger_generate_improvements ON inspection_masters;

CREATE TRIGGER trigger_generate_improvements
  AFTER INSERT OR UPDATE ON inspection_masters
  FOR EACH ROW
  EXECUTE FUNCTION generate_inspection_improvements();

-- === B) Results trigger: 每次插入扣分結果時，自動建立改善紀錄 ===★主要觸發點
CREATE OR REPLACE FUNCTION generate_improvement_from_result()
RETURNS TRIGGER AS $$
DECLARE
  v_max_days INT;
  v_master RECORD;
  v_template RECORD;
BEGIN
  -- 只處理有扣分的項目
  IF NEW.is_improvement = true THEN
    
    -- 檢查父 inspection 是否已 completed
    SELECT id, store_id, inspection_date, status, inspection_type
    INTO v_master
    FROM inspection_masters
    WHERE id = NEW.inspection_id;
    
    -- 只有督導巡店且 completed 狀態才產生改善紀錄（經理巡店是複檢模組，不需要改善）
    IF v_master.status = 'completed' AND (v_master.inspection_type IS NULL OR v_master.inspection_type = 'supervisor') THEN
      
      -- 取得模板資訊
      SELECT section_name, item_name
      INTO v_template
      FROM inspection_templates
      WHERE id = NEW.template_id;
      
      -- 取得最大改善天數
      SELECT COALESCE(MAX(day_to), 7) INTO v_max_days
      FROM inspection_bonus_config
      WHERE is_active = true;
      
      -- 建立改善紀錄
      INSERT INTO inspection_improvements (
        inspection_id, inspection_result_id, template_id, store_id,
        section_name, item_name, deduction_amount,
        issue_description, issue_photo_urls, selected_items,
        deadline, status
      ) VALUES (
        NEW.inspection_id, NEW.id, NEW.template_id, v_master.store_id,
        v_template.section_name, v_template.item_name, NEW.deduction_amount,
        NEW.notes,
        COALESCE(NEW.photo_urls, '[]'::jsonb),
        COALESCE(NEW.selected_items, '[]'::jsonb),
        v_master.inspection_date + v_max_days,
        'pending'
      )
      ON CONFLICT (inspection_id, template_id) DO NOTHING;
      
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trigger_generate_improvement_from_result ON inspection_results;

CREATE TRIGGER trigger_generate_improvement_from_result
  AFTER INSERT ON inspection_results
  FOR EACH ROW
  EXECUTE FUNCTION generate_improvement_from_result();

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


DROP TRIGGER IF EXISTS trigger_calculate_bonus ON inspection_improvements;
CREATE TRIGGER trigger_calculate_bonus BEFORE UPDATE ON inspection_improvements FOR EACH ROW EXECUTE FUNCTION calculate_improvement_bonus();
CREATE OR REPLACE FUNCTION update_inspection_bonus_total()
RETURNS TRIGGER AS $$
DECLARE
  v_new_bonus DECIMAL(5,1);
  v_old_bonus DECIMAL(5,1);
  v_base_score NUMERIC;
  v_new_total NUMERIC;
  v_new_grade TEXT;
BEGIN
  PERFORM 1 FROM inspection_masters WHERE id = NEW.inspection_id FOR UPDATE;
  -- 計算新的總加分
  SELECT COALESCE(SUM(bonus_score), 0) INTO v_new_bonus
  FROM inspection_improvements
  WHERE inspection_id = NEW.inspection_id
    AND status = 'improved';
  
  -- 取得目前的 improvement_bonus 和 total_score
  SELECT COALESCE(improvement_bonus, 0), COALESCE(total_score, 0)
  INTO v_old_bonus, v_base_score
  FROM inspection_masters
  WHERE id = NEW.inspection_id;
  
  -- 計算基礎分數（扣除舊的加分）
  v_base_score := v_base_score - v_old_bonus;
  -- 新總分 = 基礎分 + 新加分
  v_new_total := v_base_score + v_new_bonus;
  
  -- 重新計算 grade（與前端邏輯一致）
  IF v_new_total >= 220 THEN v_new_grade := '10';
  ELSIF v_new_total >= 215 THEN v_new_grade := '9';
  ELSIF v_new_total >= 191 THEN v_new_grade := '8';
  ELSIF v_new_total >= 181 THEN v_new_grade := '7';
  ELSIF v_new_total >= 171 THEN v_new_grade := '6';
  ELSIF v_new_total >= 161 THEN v_new_grade := '5';
  ELSIF v_new_total >= 151 THEN v_new_grade := '4';
  ELSIF v_new_total >= 141 THEN v_new_grade := '3';
  ELSIF v_new_total >= 131 THEN v_new_grade := '2';
  ELSIF v_new_total >= 121 THEN v_new_grade := '1';
  ELSE v_new_grade := '0';
  END IF;
  
  -- 更新 masters
  UPDATE inspection_masters
  SET improvement_bonus = v_new_bonus,
      total_score = v_new_total,
      grade = v_new_grade
  WHERE id = NEW.inspection_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trigger_update_bonus_total ON inspection_improvements;

CREATE TRIGGER trigger_update_bonus_total
  AFTER UPDATE ON inspection_improvements
  FOR EACH ROW
  WHEN (NEW.status = 'improved' AND (OLD.status IS DISTINCT FROM 'improved'))
  EXECUTE FUNCTION update_inspection_bonus_total();

CREATE OR REPLACE FUNCTION cleanup_improvements_on_result_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- 只刪除 pending 狀態的改善紀錄（已改善的保留）
  DELETE FROM inspection_improvements
  WHERE inspection_id = OLD.inspection_id
    AND template_id = OLD.template_id
    AND status = 'pending';
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trigger_cleanup_improvements ON inspection_results;

CREATE TRIGGER trigger_cleanup_improvements
  AFTER DELETE ON inspection_results
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_improvements_on_result_delete();


NOTIFY pgrst, 'reload schema';
COMMIT;
