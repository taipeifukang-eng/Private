-- ========================================================
-- 藥師年度主檔表結構 migration
-- 建立日期：2026-03-31
-- 用途：儲存每年度的藥師主檔快照，支援關帳與歷史追蹤
-- ========================================================

-- 1. 建立年度主檔表
CREATE TABLE IF NOT EXISTS pharmacist_annual_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 年度（如 2026）
  year INT NOT NULL,
  
  -- 員工基本資訊
  employee_code VARCHAR(20) NOT NULL,
  employee_name VARCHAR(100),
  
  -- 狀態：active（在職）、resigned（離職）、suspended（留職停薪）
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  status_date DATE,  -- 狀態變更日期
  
  -- 到職/離職日期
  join_date DATE,
  resignation_date DATE,
  
  -- 門市與職級
  current_store_id UUID REFERENCES stores(id),
  current_position VARCHAR(50),
  
  -- 資料來源：initial（初始化）、onboarding（入職新增）、movement（異動更新）
  source VARCHAR(20) DEFAULT 'initial',
  
  -- 備註（如：3/15升遷藥師主任）
  notes TEXT,
  
  -- 時間戳記
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- 唯一約束：同一年度同一員編只有一筆
  CONSTRAINT pharmacist_annual_master_year_employee_unique UNIQUE (year, employee_code)
);

-- 2. 建立年度關帳鎖表
CREATE TABLE IF NOT EXISTS pharmacist_annual_master_locks (
  year INT PRIMARY KEY,
  locked_at TIMESTAMPTZ DEFAULT NOW(),
  locked_by VARCHAR(100)
);

-- 3. 建立索引加速查詢
CREATE INDEX IF NOT EXISTS idx_pharmacist_annual_master_year 
  ON pharmacist_annual_master(year);
  
CREATE INDEX IF NOT EXISTS idx_pharmacist_annual_master_employee_code 
  ON pharmacist_annual_master(employee_code);
  
CREATE INDEX IF NOT EXISTS idx_pharmacist_annual_master_status 
  ON pharmacist_annual_master(status);
  
CREATE INDEX IF NOT EXISTS idx_pharmacist_annual_master_year_status 
  ON pharmacist_annual_master(year, status);

-- 4. 建立更新觸發器
CREATE OR REPLACE FUNCTION update_pharmacist_annual_master_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_pharmacist_annual_master_updated_at ON pharmacist_annual_master;
CREATE TRIGGER trigger_pharmacist_annual_master_updated_at
  BEFORE UPDATE ON pharmacist_annual_master
  FOR EACH ROW
  EXECUTE FUNCTION update_pharmacist_annual_master_updated_at();

-- 5. 設定 RLS（Row Level Security）
ALTER TABLE pharmacist_annual_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmacist_annual_master_locks ENABLE ROW LEVEL SECURITY;

-- 允許已驗證用戶讀取
DROP POLICY IF EXISTS "Authenticated users can read pharmacist_annual_master" ON pharmacist_annual_master;
CREATE POLICY "Authenticated users can read pharmacist_annual_master" 
  ON pharmacist_annual_master 
  FOR SELECT 
  TO authenticated 
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can read pharmacist_annual_master_locks" ON pharmacist_annual_master_locks;
CREATE POLICY "Authenticated users can read pharmacist_annual_master_locks" 
  ON pharmacist_annual_master_locks 
  FOR SELECT 
  TO authenticated 
  USING (true);

-- 允許 service_role 完整操作
DROP POLICY IF EXISTS "Service role full access on pharmacist_annual_master" ON pharmacist_annual_master;
CREATE POLICY "Service role full access on pharmacist_annual_master" 
  ON pharmacist_annual_master 
  FOR ALL 
  TO service_role 
  USING (true) 
  WITH CHECK (true);

DROP POLICY IF EXISTS "Service role full access on pharmacist_annual_master_locks" ON pharmacist_annual_master_locks;
CREATE POLICY "Service role full access on pharmacist_annual_master_locks" 
  ON pharmacist_annual_master_locks 
  FOR ALL 
  TO service_role 
  USING (true) 
  WITH CHECK (true);

-- 6. 註解說明
COMMENT ON TABLE pharmacist_annual_master IS '藥師年度主檔：儲存每年度的藥師名單與狀態變化';
COMMENT ON COLUMN pharmacist_annual_master.year IS '年度（如 2026）';
COMMENT ON COLUMN pharmacist_annual_master.status IS '狀態：active（在職）、resigned（離職）、suspended（留職停薪）';
COMMENT ON COLUMN pharmacist_annual_master.source IS '資料來源：initial（初始化）、onboarding（入職新增）、movement（異動更新）';

COMMENT ON TABLE pharmacist_annual_master_locks IS '藥師年度主檔關帳鎖：記錄已關帳的年度';

SELECT '✓ pharmacist_annual_master 與 pharmacist_annual_master_locks 表建立完成' AS result;
