-- =====================================================
-- 活動門市細節資料表
-- 記錄每間門市在特定活動的人員安排細節
-- =====================================================

CREATE TABLE IF NOT EXISTS campaign_store_details (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  store_id    UUID NOT NULL REFERENCES stores(id) ON DELETE CASCADE,

  -- 活動人員欄位
  outdoor_vendor  TEXT,   -- 外場廠商
  red_bean_cake   TEXT,   -- 紅豆餅/雞蛋糕
  circulation     TEXT,   -- 循環
  quantum         TEXT,   -- 量子
  bone_density    TEXT,   -- 骨密
  supervisor      TEXT,   -- 督導
  manager         TEXT,   -- 經理
  tasting         TEXT,   -- 試飲
  activity_team   TEXT,   -- 活動組
  sales1          TEXT,   -- 業務1
  sales2          TEXT,   -- 業務2
  sales3          TEXT,   -- 業務3
  sales4          TEXT,   -- 業務4
  sales5          TEXT,   -- 業務5
  sales6          TEXT,   -- 業務6
  indoor_pt1      TEXT,   -- 內場工讀1（時間09~13）
  indoor_pt2      TEXT,   -- 內場工讀2（時間09~13）
  notes           TEXT,   -- 備註

  -- 盤點活動欄位（campaign_type = 'inventory'）
  has_external_inventory_company TEXT,  -- 是否有外盤公司（是/否或公司名稱）
  planned_inventory_time         TEXT,  -- 預計盤點時間
  inventory_staff                TEXT,  -- 盤點組人員

  -- 稽核欄位
  created_by  UUID REFERENCES auth.users(id),
  updated_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- 每間門市在同一個活動只有一筆細節
  UNIQUE (campaign_id, store_id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_campaign_store_details_campaign_id ON campaign_store_details(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_store_details_store_id ON campaign_store_details(store_id);

-- RLS
ALTER TABLE campaign_store_details ENABLE ROW LEVEL SECURITY;

-- 先移除舊 policy（若存在）
DROP POLICY IF EXISTS "campaign_store_details_select" ON campaign_store_details;
DROP POLICY IF EXISTS "campaign_store_details_insert" ON campaign_store_details;
DROP POLICY IF EXISTS "campaign_store_details_update" ON campaign_store_details;
DROP POLICY IF EXISTS "campaign_store_details_delete" ON campaign_store_details;

-- 登入用戶皆可讀取
CREATE POLICY "campaign_store_details_select"
  ON campaign_store_details FOR SELECT
  TO authenticated
  USING (true);

-- 管理員、督導可新增/修改
CREATE POLICY "campaign_store_details_insert"
  ON campaign_store_details FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "campaign_store_details_update"
  ON campaign_store_details FOR UPDATE
  TO authenticated
  USING (true);

CREATE POLICY "campaign_store_details_delete"
  ON campaign_store_details FOR DELETE
  TO authenticated
  USING (true);

-- 自動更新 updated_at
CREATE OR REPLACE FUNCTION update_campaign_store_details_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_campaign_store_details_updated_at ON campaign_store_details;

CREATE TRIGGER trg_campaign_store_details_updated_at
  BEFORE UPDATE ON campaign_store_details
  FOR EACH ROW
  EXECUTE FUNCTION update_campaign_store_details_updated_at();
