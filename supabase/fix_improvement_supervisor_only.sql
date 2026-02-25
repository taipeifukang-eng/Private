-- =====================================================
-- 修復：改善紀錄只追蹤督導巡店，排除經理巡店
-- 日期: 2026-02-25
-- 
-- 問題：經理巡店是複檢模組，不應產生待改善紀錄
-- 修正：觸發器加入 inspection_type 過濾 + 清除已建的經理巡店改善紀錄
-- =====================================================

-- =====================================================
-- STEP 1: 更新 results trigger（主要觸發點）
-- 加入 inspection_type 過濾，只處理督導巡店
-- =====================================================

CREATE OR REPLACE FUNCTION generate_improvement_from_result()
RETURNS TRIGGER AS $$
DECLARE
  v_max_days INT;
  v_master RECORD;
  v_template RECORD;
BEGIN
  -- 只處理有扣分的項目
  IF NEW.is_improvement = true THEN
    
    -- 檢查父 inspection
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- STEP 2: 更新 masters trigger
-- 加入 inspection_type 過濾
-- =====================================================

CREATE OR REPLACE FUNCTION generate_inspection_improvements()
RETURNS TRIGGER AS $$
DECLARE
  v_max_days INT;
  r RECORD;
BEGIN
  -- 只在督導巡店狀態變為 'completed' 時觸發（經理巡店是複檢模組，不產生改善紀錄）
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed')
     AND (NEW.inspection_type IS NULL OR NEW.inspection_type = 'supervisor') THEN
    
    SELECT COALESCE(MAX(day_to), 7) INTO v_max_days
    FROM inspection_bonus_config
    WHERE is_active = true;
    
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- STEP 3: 更新 bonus total trigger
-- 改善加分後同步更新 total_score 和 grade
-- =====================================================

CREATE OR REPLACE FUNCTION update_inspection_bonus_total()
RETURNS TRIGGER AS $$
DECLARE
  v_new_bonus DECIMAL(5,1);
  v_old_bonus DECIMAL(5,1);
  v_base_score INT;
  v_new_total INT;
  v_new_grade TEXT;
BEGIN
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- STEP 4: 清除經理巡店產生的改善紀錄
-- =====================================================

DO $$
DECLARE
  v_count INT;
BEGIN
  DELETE FROM inspection_improvements
  WHERE inspection_id IN (
    SELECT id FROM inspection_masters
    WHERE inspection_type = 'manager'
  );
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '已刪除 % 筆經理巡店的改善紀錄', v_count;
END $$;

-- =====================================================
-- STEP 5: 為已有改善加分的巡店重新計算 total_score 和 grade
-- =====================================================

DO $$
DECLARE
  rec RECORD;
  v_base_score INT;
  v_new_total INT;
  v_new_grade TEXT;
BEGIN
  FOR rec IN
    SELECT im.id, im.total_score, COALESCE(im.improvement_bonus, 0) AS old_bonus,
           COALESCE(SUM(ii.bonus_score), 0) AS actual_bonus
    FROM inspection_masters im
    LEFT JOIN inspection_improvements ii ON ii.inspection_id = im.id AND ii.status = 'improved'
    WHERE im.improvement_bonus > 0 OR EXISTS (
      SELECT 1 FROM inspection_improvements WHERE inspection_id = im.id AND status = 'improved' AND bonus_score > 0
    )
    GROUP BY im.id, im.total_score, im.improvement_bonus
  LOOP
    -- 基礎分 = 目前總分 - 舊加分
    v_base_score := rec.total_score - rec.old_bonus;
    v_new_total := v_base_score + rec.actual_bonus;
    
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
    
    UPDATE inspection_masters
    SET improvement_bonus = rec.actual_bonus,
        total_score = v_new_total,
        grade = v_new_grade
    WHERE id = rec.id;
    
    RAISE NOTICE '巡店 % : 基礎分=%  加分=%  新總分=%  新等級=%', 
      rec.id, v_base_score, rec.actual_bonus, v_new_total, v_new_grade;
  END LOOP;
END $$;

-- =====================================================
-- STEP 6: 驗證
-- =====================================================

-- 確認剩餘的改善紀錄都來自督導巡店
SELECT 
  ii.id,
  ii.status,
  ii.section_name,
  ii.item_name,
  ii.bonus_score,
  im.inspection_type,
  im.inspection_date,
  im.total_score,
  im.improvement_bonus,
  im.grade,
  s.store_name
FROM inspection_improvements ii
JOIN inspection_masters im ON im.id = ii.inspection_id
JOIN stores s ON s.id = ii.store_id
ORDER BY im.inspection_date DESC;
