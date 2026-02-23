-- ============================================================
-- 新增「調店」異動類型
-- 說明: 在人員異動管理中新增調店功能
-- ============================================================

-- 1. 更新 CHECK 約束，加入 store_transfer
ALTER TABLE employee_movement_history
DROP CONSTRAINT IF EXISTS valid_movement_type;

ALTER TABLE employee_movement_history
ADD CONSTRAINT valid_movement_type 
CHECK (movement_type IN ('promotion', 'leave_without_pay', 'return_to_work', 'pass_probation', 'resignation', 'store_transfer'));

-- 2. 更新觸發器函數，加入調店處理邏輯
CREATE OR REPLACE FUNCTION auto_handle_employee_movement()
RETURNS TRIGGER AS $$
DECLARE
  target_year_month TEXT;
  from_store_name TEXT;
  to_store_name TEXT;
  to_store_id UUID;
BEGIN
  -- 計算異動生效的年月 (YYYY-MM 格式)
  target_year_month := TO_CHAR(NEW.movement_date, 'YYYY-MM');
  
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
        AND monthly_staff_status.year_month >= target_year_month;
      
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
      
      RAISE NOTICE '已更新員工 % 從 % 起的職位為 %', NEW.employee_code, target_year_month, NEW.new_value;
    
    WHEN 'store_transfer' THEN
      -- 調店：將員工從原門市移到新門市
      -- new_value = 新門市名稱, old_value = 原門市名稱
      -- store_id 已設為新門市ID（由 API 處理）
      
      -- 在原門市將員工設為不在職
      UPDATE store_employees
      SET 
        is_active = false,
        employment_status = 'resigned',
        last_movement_date = NEW.movement_date,
        last_movement_type = 'store_transfer'
      WHERE 
        employee_code = NEW.employee_code
        AND store_id != NEW.store_id
        AND is_active = true;
      
      -- 檢查新門市是否已有該員工記錄
      IF EXISTS (
        SELECT 1 FROM store_employees 
        WHERE employee_code = NEW.employee_code 
        AND store_id = NEW.store_id
      ) THEN
        -- 更新現有記錄為在職
        UPDATE store_employees
        SET 
          is_active = true,
          employment_status = 'active',
          last_movement_date = NEW.movement_date,
          last_movement_type = 'store_transfer'
        WHERE 
          employee_code = NEW.employee_code
          AND store_id = NEW.store_id;
      ELSE
        -- 複製原門市的員工資料到新門市
        INSERT INTO store_employees (
          employee_code, employee_name, store_id, position, current_position,
          is_pharmacist, is_active, employment_status, employment_type,
          last_movement_date, last_movement_type
        )
        SELECT 
          employee_code, employee_name, NEW.store_id, position, current_position,
          is_pharmacist, true, 'active', COALESCE(employment_type, 'full_time'),
          NEW.movement_date, 'store_transfer'
        FROM store_employees
        WHERE employee_code = NEW.employee_code
          AND is_active = false
        ORDER BY last_movement_date DESC NULLS LAST
        LIMIT 1;
      END IF;
      
      RAISE NOTICE '員工 % 自 % 起從 % 調至 %', NEW.employee_code, NEW.movement_date, NEW.old_value, NEW.new_value;
    
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

-- 3. 更新註釋
COMMENT ON COLUMN employee_movement_history.movement_type IS '異動類型: promotion(升職), store_transfer(調店), leave_without_pay(留職停薪), return_to_work(復職), pass_probation(過試用期), resignation(離職)';

-- 完成訊息
DO $$
BEGIN
  RAISE NOTICE '已新增「調店」異動類型！';
END $$;
