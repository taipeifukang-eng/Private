-- =====================================================
-- 僅新增 campaign_store_headcount 資料表
-- （用於已執行過 campaign_support_tables.sql 的環境）
-- =====================================================
CREATE TABLE IF NOT EXISTS campaign_store_headcount (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  extra_support_count INT DEFAULT 0 CHECK (extra_support_count >= 0),
  supervisor_count INT DEFAULT 0 CHECK (supervisor_count >= 0),
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id),
  UNIQUE(campaign_id, store_id)
);

-- 若資料表已存在但缺少 supervisor_count 欄位，補上
ALTER TABLE campaign_store_headcount
  ADD COLUMN IF NOT EXISTS supervisor_count INT DEFAULT 0 CHECK (supervisor_count >= 0);

ALTER TABLE campaign_store_headcount ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read for authenticated users" ON campaign_store_headcount
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow write for authenticated users" ON campaign_store_headcount
  FOR ALL USING (auth.role() = 'authenticated');

CREATE INDEX IF NOT EXISTS idx_campaign_store_headcount
  ON campaign_store_headcount(campaign_id, store_id);
