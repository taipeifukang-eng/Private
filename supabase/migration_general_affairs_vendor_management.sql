-- ============================================================
-- 總務服務中心 - 廠商管理
-- 說明：
--   建立新版總務服務中心使用的廠商、服務分類與服務區域資料表。
--   UI 入口與資料存取皆由 general_affairs.service_center.access 控制。
-- ============================================================

CREATE TABLE IF NOT EXISTS ga_service_categories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  code            TEXT NOT NULL UNIQUE,
  parent_id       UUID REFERENCES ga_service_categories(id) ON DELETE SET NULL,
  description     TEXT,
  icon_key        TEXT DEFAULT 'wrench',
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  sort_order      INTEGER NOT NULL DEFAULT 10,
  common_items    TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ga_service_regions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  code                TEXT NOT NULL UNIQUE,
  parent_id           UUID REFERENCES ga_service_regions(id) ON DELETE SET NULL,
  region_type         TEXT NOT NULL DEFAULT 'city' CHECK (region_type IN ('country', 'region', 'city', 'district')),
  description         TEXT,
  included_locations  TEXT[] NOT NULL DEFAULT '{}',
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  sort_order          INTEGER NOT NULL DEFAULT 10,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ga_vendors (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  vendor_type           TEXT NOT NULL DEFAULT 'company' CHECK (vendor_type IN ('company', 'studio', 'personal')),
  tax_id                TEXT,
  alias                 TEXT,
  founded_date          DATE,
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'inactive')),
  phone                 TEXT,
  fax                   TEXT,
  website               TEXT,
  city                  TEXT,
  district              TEXT,
  address               TEXT,
  service_city          TEXT,
  service_district      TEXT,
  service_address       TEXT,
  same_service_address  BOOLEAN NOT NULL DEFAULT true,
  contact_name          TEXT,
  contact_phone         TEXT,
  line_id               TEXT,
  email                 TEXT,
  description           TEXT,
  tags                  TEXT[] NOT NULL DEFAULT '{}',
  brands                TEXT[] NOT NULL DEFAULT '{}',
  equipment_types       TEXT[] NOT NULL DEFAULT '{}',
  service_category_ids  UUID[] NOT NULL DEFAULT '{}',
  service_region_ids    UUID[] NOT NULL DEFAULT '{}',
  rating                NUMERIC(3, 1) NOT NULL DEFAULT 0,
  review_count          INTEGER NOT NULL DEFAULT 0,
  work_order_count      INTEGER NOT NULL DEFAULT 0,
  monthly_order_count   INTEGER NOT NULL DEFAULT 0,
  total_amount          NUMERIC(12, 0) NOT NULL DEFAULT 0,
  avg_days              NUMERIC(4, 1) NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ga_service_categories_updated_at ON ga_service_categories;
CREATE TRIGGER trg_ga_service_categories_updated_at
  BEFORE UPDATE ON ga_service_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_ga_service_regions_updated_at ON ga_service_regions;
CREATE TRIGGER trg_ga_service_regions_updated_at
  BEFORE UPDATE ON ga_service_regions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_ga_vendors_updated_at ON ga_vendors;
CREATE TRIGGER trg_ga_vendors_updated_at
  BEFORE UPDATE ON ga_vendors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE ga_service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE ga_service_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ga_vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ga_service_categories_read" ON ga_service_categories;
CREATE POLICY "ga_service_categories_read" ON ga_service_categories
  FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'general_affairs.service_center.access'));
DROP POLICY IF EXISTS "ga_service_categories_write" ON ga_service_categories;
CREATE POLICY "ga_service_categories_write" ON ga_service_categories
  FOR ALL TO authenticated
  USING (has_permission(auth.uid(), 'general_affairs.service_center.access'))
  WITH CHECK (has_permission(auth.uid(), 'general_affairs.service_center.access'));

DROP POLICY IF EXISTS "ga_service_regions_read" ON ga_service_regions;
CREATE POLICY "ga_service_regions_read" ON ga_service_regions
  FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'general_affairs.service_center.access'));
DROP POLICY IF EXISTS "ga_service_regions_write" ON ga_service_regions;
CREATE POLICY "ga_service_regions_write" ON ga_service_regions
  FOR ALL TO authenticated
  USING (has_permission(auth.uid(), 'general_affairs.service_center.access'))
  WITH CHECK (has_permission(auth.uid(), 'general_affairs.service_center.access'));

DROP POLICY IF EXISTS "ga_vendors_read" ON ga_vendors;
CREATE POLICY "ga_vendors_read" ON ga_vendors
  FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'general_affairs.service_center.access'));
DROP POLICY IF EXISTS "ga_vendors_write" ON ga_vendors;
CREATE POLICY "ga_vendors_write" ON ga_vendors
  FOR ALL TO authenticated
  USING (has_permission(auth.uid(), 'general_affairs.service_center.access'))
  WITH CHECK (has_permission(auth.uid(), 'general_affairs.service_center.access'));

CREATE INDEX IF NOT EXISTS idx_ga_service_categories_status ON ga_service_categories(status);
CREATE INDEX IF NOT EXISTS idx_ga_service_categories_parent ON ga_service_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_ga_service_regions_status ON ga_service_regions(status);
CREATE INDEX IF NOT EXISTS idx_ga_service_regions_parent ON ga_service_regions(parent_id);
CREATE INDEX IF NOT EXISTS idx_ga_vendors_status ON ga_vendors(status);
CREATE INDEX IF NOT EXISTS idx_ga_vendors_name ON ga_vendors(name);

INSERT INTO ga_service_categories (name, code, parent_id, description, icon_key, sort_order, common_items)
VALUES
  ('冷氣空調', 'AC', NULL, '冷氣與空調相關維修保養', 'snowflake', 1, ARRAY['冷氣維修', '冷氣保養', '冷媒補充']),
  ('水電工程', 'EL', NULL, '水電維修與配置施工', 'zap', 2, ARRAY['水電維修', '線路配置']),
  ('招牌廣告', 'SG', NULL, '招牌製作、維修與廣告工程', 'signpost', 3, ARRAY['招牌製作', '招牌維修']),
  ('門窗玻璃', 'WD', NULL, '門窗玻璃維修與更換', 'building', 4, ARRAY['門窗維修', '玻璃更換'])
ON CONFLICT (code) DO NOTHING;

INSERT INTO ga_service_regions (name, code, parent_id, region_type, description, included_locations, sort_order)
VALUES
  ('台灣地區', 'TW', NULL, 'country', '台灣全區', ARRAY['全台灣'], 1),
  ('北部地區', 'TW-N', NULL, 'region', '北部主要服務區域', ARRAY['台北市', '新北市', '基隆市', '桃園市', '新竹縣市'], 2),
  ('中部地區', 'TW-C', NULL, 'region', '中部主要服務區域', ARRAY['苗栗縣', '台中市', '彰化縣', '南投縣', '雲林縣'], 3),
  ('南部地區', 'TW-S', NULL, 'region', '南部主要服務區域', ARRAY['嘉義縣市', '台南市', '高雄市', '屏東縣'], 4),
  ('東部地區', 'TW-E', NULL, 'region', '東部主要服務區域', ARRAY['宜蘭縣', '花蓮縣', '台東縣'], 5)
ON CONFLICT (code) DO NOTHING;
