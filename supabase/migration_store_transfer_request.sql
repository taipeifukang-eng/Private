-- ============================================================
-- 調店登記確認模組 - 資料表建立
-- 說明：行政主管登記調店申請，督導確認後寫入異動歷程
-- ============================================================

-- 建立調店申請資料表
CREATE TABLE IF NOT EXISTS store_transfer_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_code VARCHAR(20) NOT NULL,
  employee_name VARCHAR(100) NOT NULL,
  from_store_id UUID NOT NULL REFERENCES stores(id),
  to_store_id UUID NOT NULL REFERENCES stores(id),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  effective_date DATE,
  movement_history_id UUID REFERENCES employee_movement_history(id) ON DELETE SET NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_store_transfer_requests_status ON store_transfer_requests(status);
CREATE INDEX IF NOT EXISTS idx_store_transfer_requests_employee_code ON store_transfer_requests(employee_code);
CREATE INDEX IF NOT EXISTS idx_store_transfer_requests_created_at ON store_transfer_requests(created_at DESC);

-- RLS
ALTER TABLE store_transfer_requests ENABLE ROW LEVEL SECURITY;

-- 允許登入用戶讀取
CREATE POLICY "authenticated_read_store_transfer_requests"
  ON store_transfer_requests FOR SELECT
  TO authenticated
  USING (true);

-- 允許登入用戶新增（前端 API 會做權限控管）
CREATE POLICY "authenticated_insert_store_transfer_requests"
  ON store_transfer_requests FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- 允許登入用戶更新（前端 API 會做權限控管）
CREATE POLICY "authenticated_update_store_transfer_requests"
  ON store_transfer_requests FOR UPDATE
  TO authenticated
  USING (true);

COMMENT ON TABLE store_transfer_requests IS '調店登記申請表：行政主管登記，督導確認後寫入異動歷程';
COMMENT ON COLUMN store_transfer_requests.status IS 'pending=待確認, confirmed=已確認, rejected=已拒絕';
COMMENT ON COLUMN store_transfer_requests.movement_history_id IS '確認後對應的異動歷程記錄ID';
