-- 每月獎金匯入紀錄表
-- 執行日期: 2026-04-08

CREATE TABLE IF NOT EXISTS monthly_bonus_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id UUID REFERENCES stores(id) NOT NULL,
  year_month VARCHAR(7) NOT NULL,          -- 格式 'YYYY-MM', e.g. '2026-03'
  employee_code VARCHAR(50) NOT NULL,
  employee_name VARCHAR(100),

  -- 各式獎金欄位
  group_bonus              NUMERIC(12,2) DEFAULT 0,  -- 團體獎金
  hr_subsidy_bonus         NUMERIC(12,2) DEFAULT 0,  -- 人力補貼團體獎金
  single_item_bonus        NUMERIC(12,2) DEFAULT 0,  -- 單品獎金
  inventory_diff_penalty   NUMERIC(12,2) DEFAULT 0,  -- 盤點盤差承擔金額
  talent_bonus             NUMERIC(12,2) DEFAULT 0,  -- 育才獎金
  transport_fee            NUMERIC(12,2) DEFAULT 0,  -- 交通費
  inventory_bonus          NUMERIC(12,2) DEFAULT 0,  -- 盤點獎金
  rx_incentive_bonus       NUMERIC(12,2) DEFAULT 0,  -- 處方激勵獎金
  quarterly_makeup_bonus   NUMERIC(12,2) DEFAULT 0,  -- 季回補獎金
  meal_allowance           NUMERIC(12,2) DEFAULT 0,  -- 誤餐費
  spring_festival_bonus    NUMERIC(12,2) DEFAULT 0,  -- 春節出勤獎金
  pharmacist_guarantee     NUMERIC(12,2) DEFAULT 0,  -- 藥師保證金
  owner_rx_makeup          NUMERIC(12,2) DEFAULT 0,  -- 負責人處方回補獎金
  sales_competition_bonus  NUMERIC(12,2) DEFAULT 0,  -- 銷售競賽獎金
  owner_signing_bonus      NUMERIC(12,2) DEFAULT 0,  -- 負責人簽約金

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(store_id, year_month, employee_code)
);

-- 建立索引加速篩選
CREATE INDEX IF NOT EXISTS idx_mbr_store_yearmonth ON monthly_bonus_records(store_id, year_month);
CREATE INDEX IF NOT EXISTS idx_mbr_yearmonth ON monthly_bonus_records(year_month);

-- RLS
ALTER TABLE monthly_bonus_records ENABLE ROW LEVEL SECURITY;

-- admin / supervisor 可讀寫所有
DROP POLICY IF EXISTS "Admin supervisor full access" ON monthly_bonus_records;
CREATE POLICY "Admin supervisor full access" ON monthly_bonus_records
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'supervisor', 'area_manager')
    )
  );

-- 門市管理者可讀取自己門市的資料
DROP POLICY IF EXISTS "Store manager read own store" ON monthly_bonus_records;
CREATE POLICY "Store manager read own store" ON monthly_bonus_records
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM store_managers
      WHERE user_id = auth.uid()
        AND store_id = monthly_bonus_records.store_id
    )
  );

-- 自動更新 updated_at
CREATE OR REPLACE FUNCTION update_monthly_bonus_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mbr_updated_at ON monthly_bonus_records;
CREATE TRIGGER trg_mbr_updated_at
  BEFORE UPDATE ON monthly_bonus_records
  FOR EACH ROW EXECUTE FUNCTION update_monthly_bonus_records_updated_at();
