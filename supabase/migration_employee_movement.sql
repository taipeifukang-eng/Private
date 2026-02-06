-- ============================================================
-- 人員異動管理功能（取代升遷管理）
-- 說明: 將員工升遷歷程表改造為人員異動表，支援多種異動類型
-- 執行日期: 2026-02-06
-- ============================================================

-- 1. 重新命名表格
ALTER TABLE IF EXISTS employee_promotion_history 
RENAME TO employee_movement_history;

-- 2. 新增異動類型欄位
ALTER TABLE employee_movement_history 
ADD COLUMN IF NOT EXISTS movement_type VARCHAR(20) NOT NULL DEFAULT 'promotion';

-- 3. 重新命名相關欄位
ALTER TABLE employee_movement_history 
RENAME COLUMN promotion_date TO movement_date;

ALTER TABLE employee_movement_history 
RENAME COLUMN new_position TO new_value;

ALTER TABLE employee_movement_history 
RENAME COLUMN old_position TO old_value;

-- 4. 移除預設值（因為異動類型需要明確指定）
ALTER TABLE employee_movement_history 
ALTER COLUMN movement_type DROP DEFAULT;

-- 5. 新增檢查約束，確保異動類型正確
ALTER TABLE employee_movement_history
DROP CONSTRAINT IF EXISTS valid_movement_type;

ALTER TABLE employee_movement_history
ADD CONSTRAINT valid_movement_type 
CHECK (movement_type IN ('promotion', 'leave_without_pay', 'return_to_work', 'pass_probation', 'resignation'));

-- 6. 更新索引
DROP INDEX IF EXISTS idx_promotion_employee_code;
DROP INDEX IF EXISTS idx_promotion_store_id;
DROP INDEX IF EXISTS idx_promotion_date;
DROP INDEX IF EXISTS idx_promotion_employee_date;

CREATE INDEX IF NOT EXISTS idx_movement_employee_code ON employee_movement_history(employee_code);
CREATE INDEX IF NOT EXISTS idx_movement_store_id ON employee_movement_history(store_id);
CREATE INDEX IF NOT EXISTS idx_movement_date ON employee_movement_history(movement_date);
CREATE INDEX IF NOT EXISTS idx_movement_type ON employee_movement_history(movement_type);
CREATE INDEX IF NOT EXISTS idx_movement_employee_date ON employee_movement_history(employee_code, movement_date);

-- 7. 更新註釋
COMMENT ON TABLE employee_movement_history IS '員工異動歷程記錄表（包含升職、留職停薪、復職、過試用期、離職）';
COMMENT ON COLUMN employee_movement_history.employee_code IS '員工代號';
COMMENT ON COLUMN employee_movement_history.employee_name IS '員工姓名';
COMMENT ON COLUMN employee_movement_history.store_id IS '所屬門市';
COMMENT ON COLUMN employee_movement_history.movement_type IS '異動類型: promotion(升職), leave_without_pay(留職停薪), return_to_work(復職), pass_probation(過試用期), resignation(離職)';
COMMENT ON COLUMN employee_movement_history.movement_date IS '異動生效日期';
COMMENT ON COLUMN employee_movement_history.new_value IS '新值（升職時為新職位名稱，其他類型可能為空）';
COMMENT ON COLUMN employee_movement_history.old_value IS '舊值（升職時為原職位，其他類型可能為空）';
COMMENT ON COLUMN employee_movement_history.notes IS '備註';

-- 8. 更新 store_employees 表，新增異動相關欄位
ALTER TABLE store_employees ADD COLUMN IF NOT EXISTS employment_status VARCHAR(20) DEFAULT 'active';
ALTER TABLE store_employees ADD COLUMN IF NOT EXISTS last_movement_date DATE;
ALTER TABLE store_employees ADD COLUMN IF NOT EXISTS last_movement_type VARCHAR(20);

COMMENT ON COLUMN store_employees.employment_status IS '在職狀態: active(在職), leave_without_pay(留職停薪), resigned(已離職)';
COMMENT ON COLUMN store_employees.last_movement_date IS '最後異動日期';
COMMENT ON COLUMN store_employees.last_movement_type IS '最後異動類型';

-- 9. 更新 RLS 政策名稱
DROP POLICY IF EXISTS "Users can view promotion history" ON employee_movement_history;
DROP POLICY IF EXISTS "Admins and managers can manage promotion history" ON employee_movement_history;

CREATE POLICY "Users can view movement history" ON employee_movement_history
  FOR SELECT USING (
    auth.uid() IS NOT NULL
  );

CREATE POLICY "Admins and managers can manage movement history" ON employee_movement_history
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager', 'supervisor', 'area_manager')
    )
  );

-- 10. 更新觸發器函數名稱和邏輯
DROP TRIGGER IF EXISTS trigger_update_promotion_updated_at ON employee_movement_history;
DROP TRIGGER IF EXISTS trigger_auto_update_position ON employee_movement_history;
DROP FUNCTION IF EXISTS update_promotion_updated_at();
DROP FUNCTION IF EXISTS auto_update_position_on_promotion();

-- 自動更新 updated_at
CREATE OR REPLACE FUNCTION update_movement_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_movement_updated_at
  BEFORE UPDATE ON employee_movement_history
  FOR EACH ROW
  EXECUTE FUNCTION update_movement_updated_at();

-- 自動處理異動記錄
CREATE OR REPLACE FUNCTION auto_handle_employee_movement()
RETURNS TRIGGER AS $$
DECLARE
  year_month TEXT;
BEGIN
  -- 計算異動生效的年月 (YYYY-MM 格式)
  year_month := TO_CHAR(NEW.movement_date, 'YYYY-MM');
  
  -- 根據異動類型執行不同操作
  CASE NEW.movement_type
    WHEN 'promotion' THEN
      -- 升職：更新該員工在該年月及之後所有月份的職位
      UPDATE monthly_staff_status
      SET 
        position = NEW.new_value,
        updated_at = TIMEZONE('utc', NOW())
      WHERE 
        employee_code = NEW.employee_code
        AND year_month >= TO_CHAR(NEW.movement_date, 'YYYY-MM');
      
      -- 更新 store_employees 的當前職位
      UPDATE store_employees
      SET 
        current_position = NEW.new_value,
        position = NEW.new_value,
        last_promotion_date = NEW.movement_date,
        last_movement_date = NEW.movement_date,
        last_movement_type = 'promotion'
      WHERE 
        employee_code = NEW.employee_code;
      
      RAISE NOTICE '已更新員工 % 從 % 起的職位為 %', NEW.employee_code, year_month, NEW.new_value;
    
    WHEN 'leave_without_pay' THEN
      -- 留職停薪：更新員工狀態
      UPDATE store_employees
      SET 
        employment_status = 'leave_without_pay',
        last_movement_date = NEW.movement_date,
        last_movement_type = 'leave_without_pay'
      WHERE 
        employee_code = NEW.employee_code;
      
      RAISE NOTICE '員工 % 自 % 起留職停薪', NEW.employee_code, NEW.movement_date;
    
    WHEN 'return_to_work' THEN
      -- 復職：恢復員工狀態為在職
      UPDATE store_employees
      SET 
        employment_status = 'active',
        last_movement_date = NEW.movement_date,
        last_movement_type = 'return_to_work'
      WHERE 
        employee_code = NEW.employee_code;
      
      RAISE NOTICE '員工 % 自 % 起復職', NEW.employee_code, NEW.movement_date;
    
    WHEN 'pass_probation' THEN
      -- 過試用期：記錄異動
      UPDATE store_employees
      SET 
        last_movement_date = NEW.movement_date,
        last_movement_type = 'pass_probation'
      WHERE 
        employee_code = NEW.employee_code;
      
      RAISE NOTICE '員工 % 於 % 過試用期', NEW.employee_code, NEW.movement_date;
    
    WHEN 'resignation' THEN
      -- 離職：更新員工狀態
      UPDATE store_employees
      SET 
        employment_status = 'resigned',
        is_active = false,
        last_movement_date = NEW.movement_date,
        last_movement_type = 'resignation'
      WHERE 
        employee_code = NEW.employee_code;
      
      RAISE NOTICE '員工 % 於 % 離職', NEW.employee_code, NEW.movement_date;
    
    ELSE
      RAISE NOTICE '未知的異動類型: %', NEW.movement_type;
  END CASE;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_auto_handle_movement
  AFTER INSERT ON employee_movement_history
  FOR EACH ROW
  EXECUTE FUNCTION auto_handle_employee_movement();

-- 11. 將現有的升遷記錄更新為新格式（如果有的話）
UPDATE employee_movement_history
SET movement_type = 'promotion'
WHERE movement_type IS NULL OR movement_type = '';

-- 完成訊息
DO $$
BEGIN
  RAISE NOTICE '員工異動管理系統遷移完成！';
END $$;
