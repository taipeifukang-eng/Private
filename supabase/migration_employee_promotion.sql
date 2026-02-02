-- ============================================================
-- 員工升遷管理功能
-- 說明: 新增員工升遷歷程表，記錄員工職位變動
-- 執行日期: 2026-02-03
-- ============================================================

-- 1. 建立員工升遷歷程表
CREATE TABLE IF NOT EXISTS employee_promotion_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- 員工資訊
  employee_code VARCHAR(20) NOT NULL,
  employee_name TEXT NOT NULL,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE,
  
  -- 升遷資訊
  promotion_date DATE NOT NULL,
  new_position TEXT NOT NULL,
  old_position TEXT,
  
  -- 備註
  notes TEXT,
  
  -- 系統資訊
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- 建立索引
CREATE INDEX IF NOT EXISTS idx_promotion_employee_code ON employee_promotion_history(employee_code);
CREATE INDEX IF NOT EXISTS idx_promotion_store_id ON employee_promotion_history(store_id);
CREATE INDEX IF NOT EXISTS idx_promotion_date ON employee_promotion_history(promotion_date);
CREATE INDEX IF NOT EXISTS idx_promotion_employee_date ON employee_promotion_history(employee_code, promotion_date);

-- 註釋
COMMENT ON TABLE employee_promotion_history IS '員工升遷歷程記錄表';
COMMENT ON COLUMN employee_promotion_history.employee_code IS '員工代號';
COMMENT ON COLUMN employee_promotion_history.employee_name IS '員工姓名';
COMMENT ON COLUMN employee_promotion_history.store_id IS '所屬門市';
COMMENT ON COLUMN employee_promotion_history.promotion_date IS '升遷生效日期';
COMMENT ON COLUMN employee_promotion_history.new_position IS '新職位';
COMMENT ON COLUMN employee_promotion_history.old_position IS '原職位';
COMMENT ON COLUMN employee_promotion_history.notes IS '備註';

-- 2. 更新 store_employees 表，新增升遷相關欄位（如果還沒有）
ALTER TABLE store_employees ADD COLUMN IF NOT EXISTS current_position TEXT;
ALTER TABLE store_employees ADD COLUMN IF NOT EXISTS last_promotion_date DATE;

COMMENT ON COLUMN store_employees.current_position IS '當前職位';
COMMENT ON COLUMN store_employees.last_promotion_date IS '最後升遷日期';

-- 3. 啟用 RLS
ALTER TABLE employee_promotion_history ENABLE ROW LEVEL SECURITY;

-- 4. 建立 RLS 政策
-- 所有登入用戶可以查看升遷記錄
DROP POLICY IF EXISTS "Users can view promotion history" ON employee_promotion_history;
CREATE POLICY "Users can view promotion history" ON employee_promotion_history
  FOR SELECT USING (
    auth.uid() IS NOT NULL
  );

-- Admin 和 Manager 可以管理升遷記錄
DROP POLICY IF EXISTS "Admins and managers can manage promotion history" ON employee_promotion_history;
CREATE POLICY "Admins and managers can manage promotion history" ON employee_promotion_history
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager', 'supervisor', 'area_manager')
    )
  );

-- 5. 建立自動更新 updated_at 的觸發器
CREATE OR REPLACE FUNCTION update_promotion_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_promotion_updated_at ON employee_promotion_history;
CREATE TRIGGER trigger_update_promotion_updated_at
  BEFORE UPDATE ON employee_promotion_history
  FOR EACH ROW
  EXECUTE FUNCTION update_promotion_updated_at();

-- 6. 建立自動回寫函數：當新增升遷記錄時，自動更新對應月份的職位
CREATE OR REPLACE FUNCTION auto_update_position_on_promotion()
RETURNS TRIGGER AS $$
DECLARE
  year_month TEXT;
BEGIN
  -- 計算升遷生效的年月 (YYYY-MM 格式)
  year_month := TO_CHAR(NEW.promotion_date, 'YYYY-MM');
  
  -- 更新該員工在該年月及之後所有月份的職位
  UPDATE monthly_staff_status
  SET 
    position = NEW.new_position,
    updated_at = TIMEZONE('utc', NOW())
  WHERE 
    employee_code = NEW.employee_code
    AND year_month >= TO_CHAR(NEW.promotion_date, 'YYYY-MM');
  
  -- 記錄更新結果
  RAISE NOTICE '已更新員工 % 從 % 起的職位為 %', NEW.employee_code, year_month, NEW.new_position;
  
  -- 更新 store_employees 的當前職位
  UPDATE store_employees
  SET 
    current_position = NEW.new_position,
    last_promotion_date = NEW.promotion_date,
    position = NEW.new_position
  WHERE 
    employee_code = NEW.employee_code;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_auto_update_position ON employee_promotion_history;
CREATE TRIGGER trigger_auto_update_position
  AFTER INSERT ON employee_promotion_history
  FOR EACH ROW
  EXECUTE FUNCTION auto_update_position_on_promotion();
