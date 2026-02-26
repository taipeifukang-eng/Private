-- =====================================================
-- 新增活動類型欄位
-- 支援多種活動類型：促銷活動、盤點活動、未來擴充
-- =====================================================

-- 1. campaigns 表加入 campaign_type
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS campaign_type TEXT NOT NULL DEFAULT 'promotion';

-- 加入 CHECK 約束（只允許已知類型，未來新增類型時再 ALTER）
-- 目前支援: promotion（母親節/周年慶）、inventory（盤點）
ALTER TABLE campaigns
  DROP CONSTRAINT IF EXISTS campaigns_campaign_type_check;

ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_campaign_type_check
  CHECK (campaign_type IN ('promotion', 'inventory'));

COMMENT ON COLUMN campaigns.campaign_type IS '活動類型: promotion=母親節/周年慶; inventory=盤點活動';

-- 2. campaign_store_details 加入盤點活動欄位
ALTER TABLE campaign_store_details
  ADD COLUMN IF NOT EXISTS has_external_inventory_company TEXT,  -- 是否有外盤公司（是/否/公司名稱）
  ADD COLUMN IF NOT EXISTS planned_inventory_time         TEXT,  -- 預計盤點時間（例：18:00）
  ADD COLUMN IF NOT EXISTS inventory_staff                TEXT;  -- 盤點組人員名單

COMMENT ON COLUMN campaign_store_details.has_external_inventory_company IS '盤點：是否有外盤公司（是/否 或填入公司名稱）';
COMMENT ON COLUMN campaign_store_details.planned_inventory_time         IS '盤點：預計盤點時間';
COMMENT ON COLUMN campaign_store_details.inventory_staff                IS '盤點：盤點組人員';

-- 驗證
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'campaigns' AND column_name = 'campaign_type'
UNION ALL
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'campaign_store_details'
  AND column_name IN ('has_external_inventory_company', 'planned_inventory_time', 'inventory_staff')
ORDER BY column_name;
