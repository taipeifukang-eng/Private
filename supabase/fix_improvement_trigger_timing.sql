-- =====================================================
-- 修復待改善紀錄 Trigger 時序問題 + 補建既有巡店的改善紀錄
-- 日期: 2026-02-25
-- 
-- 問題: 新增巡店流程是先 INSERT masters 再 INSERT results
--       但 trigger 掛在 masters 上，觸發時 results 還不存在
-- 修正: 新增掛在 inspection_results 上的 trigger
-- =====================================================

-- =====================================================
-- STEP 1: 新增 inspection_results AFTER INSERT trigger
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_generate_improvement_from_result ON inspection_results;

CREATE TRIGGER trigger_generate_improvement_from_result
  AFTER INSERT ON inspection_results
  FOR EACH ROW
  EXECUTE FUNCTION generate_improvement_from_result();

-- =====================================================
-- STEP 2: 新增 inspection_results AFTER DELETE trigger
-- 編輯巡店時清理 pending 改善紀錄（已改善的保留）
-- =====================================================

CREATE OR REPLACE FUNCTION cleanup_improvements_on_result_delete()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM inspection_improvements
  WHERE inspection_id = OLD.inspection_id
    AND template_id = OLD.template_id
    AND status = 'pending';
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_cleanup_improvements ON inspection_results;

CREATE TRIGGER trigger_cleanup_improvements
  AFTER DELETE ON inspection_results
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_improvements_on_result_delete();

-- =====================================================
-- STEP 3: 為既有已完成巡店補建改善紀錄
-- =====================================================

DO $$
DECLARE
  v_max_days INT;
  v_count INT := 0;
BEGIN
  -- 取得最大改善天數
  SELECT COALESCE(MAX(day_to), 7) INTO v_max_days
  FROM inspection_bonus_config
  WHERE is_active = true;
  
  -- 為所有已完成巡店的扣分項目建立改善紀錄
  INSERT INTO inspection_improvements (
    inspection_id, inspection_result_id, template_id, store_id,
    section_name, item_name, deduction_amount,
    issue_description, issue_photo_urls, selected_items,
    deadline, status
  )
  SELECT
    im.id,
    ir.id,
    ir.template_id,
    im.store_id,
    it.section_name,
    it.item_name,
    ir.deduction_amount,
    ir.notes,
    COALESCE(ir.photo_urls, '[]'::jsonb),
    COALESCE(ir.selected_items, '[]'::jsonb),
    im.inspection_date + v_max_days,
    -- 如果已超過期限，設為 overdue
    CASE
      WHEN (im.inspection_date + v_max_days) < CURRENT_DATE THEN 'overdue'
      ELSE 'pending'
    END
  FROM inspection_results ir
  JOIN inspection_masters im ON im.id = ir.inspection_id
  JOIN inspection_templates it ON it.id = ir.template_id
  WHERE im.status = 'completed'
    AND ir.is_improvement = true
    AND (im.inspection_type IS NULL OR im.inspection_type = 'supervisor')
  ON CONFLICT (inspection_id, template_id) DO NOTHING;
  
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE '已補建 % 筆待改善紀錄', v_count;
END $$;

-- =====================================================
-- STEP 4: 驗證
-- =====================================================

-- 確認 trigger 都存在
SELECT tgname, tgrelid::regclass
FROM pg_trigger
WHERE tgname IN (
  'trigger_generate_improvements',
  'trigger_generate_improvement_from_result',
  'trigger_cleanup_improvements',
  'trigger_calculate_bonus',
  'trigger_update_bonus_total'
);

-- 確認改善紀錄
SELECT 
  ii.status,
  COUNT(*) AS count,
  s.store_name,
  im.inspection_date
FROM inspection_improvements ii
JOIN stores s ON s.id = ii.store_id
JOIN inspection_masters im ON im.id = ii.inspection_id
GROUP BY ii.status, s.store_name, im.inspection_date
ORDER BY im.inspection_date DESC;
