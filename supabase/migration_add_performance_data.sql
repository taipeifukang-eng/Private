-- 新增業績資料欄位到 monthly_staff_status
-- 執行日期: 2026-01-XX

-- 添加業績相關欄位
ALTER TABLE monthly_staff_status
  ADD COLUMN IF NOT EXISTS transaction_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sales_amount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_profit NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gross_profit_rate NUMERIC(5,2) DEFAULT 0;

-- 註解說明
COMMENT ON COLUMN monthly_staff_status.transaction_count IS '交易次數';
COMMENT ON COLUMN monthly_staff_status.sales_amount IS '銷售金額';
COMMENT ON COLUMN monthly_staff_status.gross_profit IS '毛利';
COMMENT ON COLUMN monthly_staff_status.gross_profit_rate IS '毛利率（%）';

-- 創建業績門市明細表（用於存儲跨門市員工的各門市業績）
CREATE TABLE IF NOT EXISTS monthly_performance_details (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_status_id UUID REFERENCES monthly_staff_status(id) ON DELETE CASCADE,
  store_code VARCHAR(50) NOT NULL,
  store_name VARCHAR(255),
  transaction_count INTEGER DEFAULT 0,
  sales_amount NUMERIC(12,2) DEFAULT 0,
  gross_profit NUMERIC(12,2) DEFAULT 0,
  gross_profit_rate NUMERIC(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- 註解
COMMENT ON TABLE monthly_performance_details IS '員工業績門市明細（跨門市員工的各門市業績分項）';

-- 索引
CREATE INDEX IF NOT EXISTS idx_performance_details_staff_status 
  ON monthly_performance_details(staff_status_id);

-- RLS 政策
ALTER TABLE monthly_performance_details ENABLE ROW LEVEL SECURITY;

-- Admin 可以查看所有
DROP POLICY IF EXISTS "Admin can view all performance details" ON monthly_performance_details;
CREATE POLICY "Admin can view all performance details" ON monthly_performance_details FOR SELECT USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Admin 可以插入
DROP POLICY IF EXISTS "Admin can insert performance details" ON monthly_performance_details;
CREATE POLICY "Admin can insert performance details" ON monthly_performance_details FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Admin 可以更新
DROP POLICY IF EXISTS "Admin can update performance details" ON monthly_performance_details;
CREATE POLICY "Admin can update performance details" ON monthly_performance_details FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Admin 可以刪除
DROP POLICY IF EXISTS "Admin can delete performance details" ON monthly_performance_details;
CREATE POLICY "Admin can delete performance details" ON monthly_performance_details FOR DELETE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
);

-- Manager 可以查看自己管理門市的業績明細
DROP POLICY IF EXISTS "Managers can view their stores performance details" ON monthly_performance_details;
CREATE POLICY "Managers can view their stores performance details" ON monthly_performance_details FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM monthly_staff_status mss
    JOIN store_managers sm ON sm.store_id = mss.store_id
    WHERE mss.id = monthly_performance_details.staff_status_id
    AND sm.user_id = auth.uid()
  )
);
