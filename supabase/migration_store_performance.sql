-- =========================================================
-- 門市業績資料表
-- 每間門市每月的目標與達成數據
-- =========================================================

CREATE TABLE IF NOT EXISTS store_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  year INT NOT NULL CHECK (year >= 2020 AND year <= 2099),
  month INT NOT NULL CHECK (month >= 1 AND month <= 12),
  
  -- 基本資料
  business_days INT NOT NULL DEFAULT 30 CHECK (business_days > 0 AND business_days <= 31),

  -- 月目標 (targets)
  monthly_gross_profit_target   BIGINT,  -- 月毛利目標
  monthly_revenue_target        BIGINT,  -- 月營業額目標
  monthly_customer_count_target INT,     -- 月來客數目標
  last_month_rx_target          INT,     -- 上個月處方箋目標

  -- 月實際 (actuals)
  monthly_gross_profit_actual   BIGINT,  -- 月毛利實際
  monthly_revenue_actual        BIGINT,  -- 月營業額實際
  monthly_customer_count_actual INT,     -- 月來客數實際
  last_month_rx_actual          INT,     -- 上個月處方箋實際

  -- 系統欄位
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  UNIQUE(store_id, year, month)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_store_performance_store ON store_performance(store_id);
CREATE INDEX IF NOT EXISTS idx_store_performance_year_month ON store_performance(year, month);

-- RLS
ALTER TABLE store_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated select" ON store_performance
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow managers to insert" ON store_performance
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'manager', 'supervisor', 'area_manager')
    )
  );

CREATE POLICY "Allow managers to update" ON store_performance
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Allow managers to delete" ON store_performance
  FOR DELETE TO authenticated USING (true);

COMMENT ON TABLE store_performance IS '門市業績資料表：含月目標與達成實績';
COMMENT ON COLUMN store_performance.business_days IS '當月營業天數';
COMMENT ON COLUMN store_performance.monthly_gross_profit_target IS '月毛利目標（元）';
COMMENT ON COLUMN store_performance.monthly_revenue_target IS '月營業額目標（元）';
COMMENT ON COLUMN store_performance.monthly_customer_count_target IS '月來客數目標（人次）';
COMMENT ON COLUMN store_performance.last_month_rx_target IS '上個月處方箋目標（張）';
