-- =========================================================
-- 建立育才獎金獨立表（仿照 support_staff_bonus 模式）
-- 解決跨分店員工無法儲存至 monthly_staff_status 的問題
-- =========================================================

-- 建立表
CREATE TABLE IF NOT EXISTS talent_cultivation_bonus (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  year_month VARCHAR(7) NOT NULL,
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  employee_code VARCHAR(20) NOT NULL,
  employee_name VARCHAR(100) NOT NULL,
  cultivation_bonus INTEGER NOT NULL DEFAULT 0,
  cultivation_target VARCHAR(500) NOT NULL DEFAULT '',
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(year_month, store_id, employee_code)
);

-- 建立索引
CREATE INDEX IF NOT EXISTS idx_talent_cultivation_bonus_year_month
  ON talent_cultivation_bonus(year_month);

CREATE INDEX IF NOT EXISTS idx_talent_cultivation_bonus_store
  ON talent_cultivation_bonus(store_id);

CREATE INDEX IF NOT EXISTS idx_talent_cultivation_bonus_employee
  ON talent_cultivation_bonus(employee_code);

-- 開放 RLS
ALTER TABLE talent_cultivation_bonus ENABLE ROW LEVEL SECURITY;

-- 允許有登入的人查詢（可依需求收緊）
CREATE POLICY "Allow authenticated select"
  ON talent_cultivation_bonus FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow managers to insert"
  ON talent_cultivation_bonus FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND (
          role IN ('admin', 'manager', 'supervisor', 'area_manager')
          OR job_title IN ('店長', '代理店長', '督導', '督導(代理店長)')
        )
    )
  );

CREATE POLICY "Allow managers to update"
  ON talent_cultivation_bonus FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "Allow managers to delete"
  ON talent_cultivation_bonus FOR DELETE
  TO authenticated
  USING (true);

-- 說明
COMMENT ON TABLE talent_cultivation_bonus IS '育才獎金登記表（獨立儲存，支援跨分店員工）';
COMMENT ON COLUMN talent_cultivation_bonus.year_month IS '年月，格式 2026-02';
COMMENT ON COLUMN talent_cultivation_bonus.store_id IS '登記此育才獎金的門市';
COMMENT ON COLUMN talent_cultivation_bonus.employee_code IS '獲得育才獎金的員工員編';
COMMENT ON COLUMN talent_cultivation_bonus.cultivation_target IS '育才對象（被培育的員工名稱）';
