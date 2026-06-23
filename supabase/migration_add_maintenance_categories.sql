-- ============================================================
-- 跨部門管理 - 總務組維修分類
-- 說明：
--   maintenance_categories          : 維修分類主檔
--   maintenance_requests.category_id: 維修回報目前分類
--   maintenance_updates.category_id : 每次進度更新當下分類快照
-- ============================================================

CREATE TABLE IF NOT EXISTS maintenance_categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  UUID REFERENCES auth.users(id),
  updated_by  UUID REFERENCES auth.users(id)
);

INSERT INTO maintenance_categories (name, sort_order, is_active) VALUES
  ('電動門', 10, true),
  ('監視系統', 20, true),
  ('鼠患除蟲', 30, true),
  ('招牌', 40, true),
  ('保全', 50, true),
  ('燈具', 60, true),
  ('木工', 70, true),
  ('鐵工', 80, true),
  ('水電', 90, true),
  ('冷氣', 100, true)
ON CONFLICT (name) DO UPDATE
SET sort_order = EXCLUDED.sort_order,
    is_active = true,
    updated_at = NOW();

ALTER TABLE maintenance_requests
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES maintenance_categories(id) ON DELETE SET NULL;

ALTER TABLE maintenance_updates
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES maintenance_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS progress_date DATE NOT NULL DEFAULT CURRENT_DATE;

DROP TRIGGER IF EXISTS trg_maintenance_categories_updated_at ON maintenance_categories;
CREATE TRIGGER trg_maintenance_categories_updated_at
  BEFORE UPDATE ON maintenance_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE maintenance_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "maintenance_categories_read" ON maintenance_categories;
CREATE POLICY "maintenance_categories_read" ON maintenance_categories
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "maintenance_categories_write" ON maintenance_categories;
CREATE POLICY "maintenance_categories_write" ON maintenance_categories
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('cross_dept', 'maintenance', 'cross_dept.maintenance.category.edit', 'category_edit', '可編輯總務維修分類')
ON CONFLICT (code) DO NOTHING;

-- 將目前已可管理維修進度/總覽的角色，同步授予分類編輯權限。
INSERT INTO role_permissions (role_id, permission_id, is_allowed)
SELECT DISTINCT rp.role_id, p_new.id, true
FROM role_permissions rp
JOIN permissions p_old ON p_old.id = rp.permission_id
JOIN permissions p_new ON p_new.code = 'cross_dept.maintenance.category.edit'
WHERE p_old.code IN (
  'cross_dept.maintenance.update',
  'cross_dept.maintenance.view_all'
)
  AND COALESCE(rp.is_allowed, true) = true
ON CONFLICT (role_id, permission_id) DO UPDATE SET is_allowed = true;

CREATE INDEX IF NOT EXISTS idx_maintenance_categories_active_order
ON maintenance_categories (is_active, sort_order, name);

CREATE INDEX IF NOT EXISTS idx_maintenance_requests_category_id
ON maintenance_requests (category_id);

CREATE INDEX IF NOT EXISTS idx_maintenance_updates_category_id
ON maintenance_updates (category_id);
