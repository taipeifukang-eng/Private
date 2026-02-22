-- =========================================
-- 春節出勤獎金表
-- =========================================
-- 記錄春節期間(初一~初三)員工出勤獎金

CREATE TABLE IF NOT EXISTS spring_festival_bonus (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  year_month TEXT NOT NULL,                           -- 所屬月份 (e.g., '2025-01')
  store_id UUID NOT NULL REFERENCES stores(id),       -- 門市
  employee_code TEXT NOT NULL,                         -- 員編
  employee_name TEXT NOT NULL,                         -- 姓名
  attendance_date DATE NOT NULL,                       -- 出勤日期
  category TEXT NOT NULL CHECK (category IN ('藥師', '主管', '專員')),  -- 對象分類
  bonus_amount INTEGER NOT NULL DEFAULT 0,             -- 獎金金額
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  
  -- 每人每日只能有一筆記錄
  UNIQUE(year_month, store_id, employee_code, attendance_date)
);

-- 建立索引
CREATE INDEX IF NOT EXISTS idx_spring_festival_bonus_year_month 
  ON spring_festival_bonus(year_month);
CREATE INDEX IF NOT EXISTS idx_spring_festival_bonus_store_id 
  ON spring_festival_bonus(store_id);
CREATE INDEX IF NOT EXISTS idx_spring_festival_bonus_employee 
  ON spring_festival_bonus(employee_code);

-- RLS 策略
ALTER TABLE spring_festival_bonus ENABLE ROW LEVEL SECURITY;

-- 管理者可以完整操作
CREATE POLICY "管理者可以管理春節獎金"
  ON spring_festival_bonus
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('admin', 'manager', 'supervisor', 'area_manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles 
      WHERE profiles.id = auth.uid() 
      AND profiles.role IN ('admin', 'manager', 'supervisor', 'area_manager')
    )
  );

-- 店長可以管理自己門市的記錄
CREATE POLICY "店長可以管理門市春節獎金"
  ON spring_festival_bonus
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM store_managers sm
      JOIN profiles p ON p.id = sm.user_id
      WHERE sm.user_id = auth.uid()
      AND sm.store_id = spring_festival_bonus.store_id
      AND p.job_title IN ('店長', '代理店長', '督導', '督導(代理店長)')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM store_managers sm
      JOIN profiles p ON p.id = sm.user_id
      WHERE sm.user_id = auth.uid()
      AND sm.store_id = spring_festival_bonus.store_id
      AND p.job_title IN ('店長', '代理店長', '督導', '督導(代理店長)')
    )
  );

-- 一般員工可以查看自己的記錄
CREATE POLICY "員工可以查看自己的春節獎金"
  ON spring_festival_bonus
  FOR SELECT
  TO authenticated
  USING (
    employee_code IN (
      SELECT employee_code FROM profiles WHERE id = auth.uid()
    )
  );
