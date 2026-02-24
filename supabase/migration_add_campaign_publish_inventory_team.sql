-- ============================================
-- 新增「發布給盤點組」欄位
-- 控制活動排程是否對營業部-盤點組人員可見
-- ============================================

-- 新增欄位
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS published_to_inventory_team BOOLEAN DEFAULT false;

-- 更新索引（包含新欄位）
DROP INDEX IF EXISTS idx_campaigns_published;
CREATE INDEX idx_campaigns_published ON campaigns(published_to_supervisors, published_to_store_managers, published_to_inventory_team);

COMMENT ON COLUMN campaigns.published_to_inventory_team IS '是否已發布給盤點組人員';
