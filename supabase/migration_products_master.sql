-- ============================================================
-- 商品資料主檔
-- 說明：供缺貨回報模組搜尋用，由商品部定期匯入 Excel 維護
-- ============================================================

CREATE TABLE IF NOT EXISTS products_master (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code TEXT NOT NULL UNIQUE,  -- 商品編號
  product_name TEXT NOT NULL,         -- 商品名稱
  unit         TEXT NOT NULL DEFAULT '',  -- 單位（例：瓶、盒、條）
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_master_code ON products_master(product_code);
CREATE INDEX IF NOT EXISTS idx_products_master_name ON products_master(product_name);

-- 自動更新 updated_at
CREATE TRIGGER trg_products_master_updated_at
  BEFORE UPDATE ON products_master
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE products_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "products_master_read" ON products_master
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "products_master_write" ON products_master
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 新增 RBAC 權限
INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('store', 'products_master', 'store.products_master.manage', 'manage', '可匯入及管理商品資料主檔')
ON CONFLICT (code) DO NOTHING;

-- 授予 system_admin
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT r.id, p.id, true
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'system_admin'
  AND p.code = 'store.products_master.manage'
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;
