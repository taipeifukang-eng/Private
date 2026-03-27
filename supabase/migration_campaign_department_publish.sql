-- 活動跨部門公告（行銷部 / 商品部）
CREATE TABLE IF NOT EXISTS campaign_department_publish (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL UNIQUE REFERENCES campaigns(id) ON DELETE CASCADE,

  marketing_content TEXT,
  marketing_rules TEXT,
  marketing_image_name TEXT,
  marketing_image_data TEXT,

  merchandise_gift_rules_name TEXT,
  merchandise_gift_rules_data TEXT,
  merchandise_supply_content TEXT,
  merchandise_allocation_file_name TEXT,
  merchandise_allocation_file_data TEXT,

  created_by UUID,
  updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_department_publish_campaign
  ON campaign_department_publish(campaign_id);

-- RBAC 權限
INSERT INTO permissions (module, feature, code, action, description) VALUES
  ('activity', 'department_marketing', 'activity.marketing.publish', 'publish', '行銷部可發布活動行銷內容'),
  ('activity', 'department_merchandise', 'activity.merchandise.publish', 'publish', '商品部可發布活動商品規則')
ON CONFLICT (module, feature, action)
DO UPDATE SET
  code = EXCLUDED.code,
  description = EXCLUDED.description;
