-- ============================================================
-- 跨部門管理 - 缺貨商品回報模組
-- 說明：
--   stockout_reports        : 各門市店長回報缺貨品項
--   stockout_product_responses : 商品部針對「商品編號」統一回覆
--     (同一商品編號由多間門市回報時，商品部只需回覆一次)
-- ============================================================

-- 1. 缺貨回報表
CREATE TABLE IF NOT EXISTS stockout_reports (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_code   TEXT NOT NULL,
  product_name   TEXT NOT NULL,
  required_qty   INTEGER NOT NULL DEFAULT 1 CHECK (required_qty > 0),
  reported_by    UUID NOT NULL REFERENCES auth.users(id),
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'responded')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. 商品部統一回覆表（以商品編號為 key，跨門市共享）
CREATE TABLE IF NOT EXISTS stockout_product_responses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code      TEXT NOT NULL UNIQUE,   -- 與 stockout_reports.product_code 對應
  product_name      TEXT NOT NULL,          -- 商品名稱（供顯示用，取最後更新的）
  response_content  TEXT NOT NULL,          -- 回覆內容（原因 / 預計到貨時間等）
  responded_by      UUID NOT NULL REFERENCES auth.users(id),
  responded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. 自動更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_stockout_reports_updated_at
  BEFORE UPDATE ON stockout_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_stockout_product_responses_updated_at
  BEFORE UPDATE ON stockout_product_responses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4. 當 stockout_product_responses 有對應 product_code 時，
--    自動把相關 stockout_reports 的 status 更新為 'responded'
CREATE OR REPLACE FUNCTION sync_stockout_report_status()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE stockout_reports
  SET status = 'responded', updated_at = NOW()
  WHERE product_code = NEW.product_code
    AND status = 'pending';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_stockout_status
  AFTER INSERT OR UPDATE ON stockout_product_responses
  FOR EACH ROW EXECUTE FUNCTION sync_stockout_report_status();

-- 5. RLS（Row Level Security）
ALTER TABLE stockout_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE stockout_product_responses ENABLE ROW LEVEL SECURITY;

-- 已登入使用者可讀（API 層再做細部 RBAC 過濾）
CREATE POLICY "stockout_reports_read" ON stockout_reports
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "stockout_reports_write" ON stockout_reports
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "stockout_responses_read" ON stockout_product_responses
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "stockout_responses_write" ON stockout_product_responses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 6. 新增 RBAC 權限代碼
-- cross_dept.stockout.view_all : 商品部人員 - 查看所有門市回報
-- cross_dept.stockout.respond  : 商品部人員 - 回覆缺貨商品
-- cross_dept.stockout.submit   : 店長 - 提交缺貨回報（目前由 admin 統一給予）

INSERT INTO permissions (code, name, description, category) VALUES
  ('cross_dept.stockout.view_all', '查看全部缺貨回報', '可查看所有門市的缺貨商品回報', '跨部門管理'),
  ('cross_dept.stockout.respond',  '回覆缺貨商品',     '可針對商品編號統一回覆缺貨狀況', '跨部門管理'),
  ('cross_dept.stockout.submit',   '提交缺貨回報',     '可提交本門市的缺貨商品回報',     '跨部門管理')
ON CONFLICT (code) DO NOTHING;

-- 7. 將三項權限全部授予 system_admin 角色
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'system_admin'
  AND p.code IN (
    'cross_dept.stockout.view_all',
    'cross_dept.stockout.respond',
    'cross_dept.stockout.submit'
  )
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;
