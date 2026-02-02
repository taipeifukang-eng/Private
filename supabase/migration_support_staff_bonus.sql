-- ============================================================
-- 支援人員單品獎金管理功能
-- 說明: 新增支援人員單品獎金表，用於記錄跨門市支援人員的單品獎金
-- 執行日期: 2026-02-03
-- ============================================================

-- 1. 建立支援人員單品獎金表
CREATE TABLE IF NOT EXISTS support_staff_bonus (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- 期間資訊
  year_month VARCHAR(7) NOT NULL, -- 格式: YYYY-MM
  
  -- 員工資訊
  employee_code VARCHAR(20) NOT NULL,
  employee_name TEXT NOT NULL,
  
  -- 獎金資訊
  bonus_amount DECIMAL(10, 2) DEFAULT 0,
  
  -- 系統資訊
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  
  -- 唯一約束：同一個員工在同一個月份只能有一筆記錄
  UNIQUE(employee_code, year_month)
);

-- 建立索引
CREATE INDEX IF NOT EXISTS idx_support_bonus_year_month ON support_staff_bonus(year_month);
CREATE INDEX IF NOT EXISTS idx_support_bonus_employee_code ON support_staff_bonus(employee_code);
CREATE INDEX IF NOT EXISTS idx_support_bonus_year_month_employee ON support_staff_bonus(year_month, employee_code);

-- 註釋
COMMENT ON TABLE support_staff_bonus IS '支援人員單品獎金記錄表';
COMMENT ON COLUMN support_staff_bonus.year_month IS '年月 (YYYY-MM)';
COMMENT ON COLUMN support_staff_bonus.employee_code IS '員工代號';
COMMENT ON COLUMN support_staff_bonus.employee_name IS '員工姓名';
COMMENT ON COLUMN support_staff_bonus.bonus_amount IS '單品獎金金額';

-- 2. 啟用 RLS
ALTER TABLE support_staff_bonus ENABLE ROW LEVEL SECURITY;

-- 3. 建立 RLS 政策
-- 所有登入用戶可以查看
DROP POLICY IF EXISTS "Users can view support staff bonus" ON support_staff_bonus;
CREATE POLICY "Users can view support staff bonus" ON support_staff_bonus
  FOR SELECT USING (
    auth.uid() IS NOT NULL
  );

-- 店長以上權限可以管理
DROP POLICY IF EXISTS "Managers can manage support staff bonus" ON support_staff_bonus;
CREATE POLICY "Managers can manage support staff bonus" ON support_staff_bonus
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('admin', 'manager', 'supervisor', 'area_manager')
    )
  );

-- 4. 建立自動更新 updated_at 的觸發器
CREATE OR REPLACE FUNCTION update_support_bonus_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_support_bonus_updated_at ON support_staff_bonus;
CREATE TRIGGER trigger_update_support_bonus_updated_at
  BEFORE UPDATE ON support_staff_bonus
  FOR EACH ROW
  EXECUTE FUNCTION update_support_bonus_updated_at();
