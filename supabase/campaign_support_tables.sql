-- =====================================================
-- 分店支援功能相關資料表
-- =====================================================

-- 1. 本店確認人員表（每間門市在活動月的本店人員確認）
CREATE TABLE IF NOT EXISTS campaign_store_own_staff (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
  store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  employee_code VARCHAR(20) NOT NULL,
  employee_name VARCHAR(100) NOT NULL,
  position VARCHAR(50),
  is_manually_added BOOLEAN DEFAULT false,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE(campaign_id, store_id, employee_code)
);

-- 2. 支援需求表（A 門市請求 B 門市支援 N 人）
CREATE TABLE IF NOT EXISTS campaign_support_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
  requesting_store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  supporting_store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  requested_count INT DEFAULT 1 NOT NULL CHECK (requested_count > 0),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE(campaign_id, requesting_store_id, supporting_store_id)
);

-- 3. 實際支援人員指派表（指派哪位員工去哪間門市支援）
CREATE TABLE IF NOT EXISTS campaign_support_staff (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  support_request_id UUID REFERENCES campaign_support_requests(id) ON DELETE CASCADE NOT NULL,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
  supporting_store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  requesting_store_id UUID REFERENCES stores(id) ON DELETE CASCADE NOT NULL,
  employee_code VARCHAR(20) NOT NULL,
  employee_name VARCHAR(100) NOT NULL,
  position VARCHAR(50),
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- RLS Policies
ALTER TABLE campaign_store_own_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_support_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_support_staff ENABLE ROW LEVEL SECURITY;

-- Allow read for authenticated users
CREATE POLICY "Allow read for authenticated users" ON campaign_store_own_staff
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow read for authenticated users" ON campaign_support_requests
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Allow read for authenticated users" ON campaign_support_staff
  FOR SELECT USING (auth.role() = 'authenticated');

-- Allow write for authenticated users (permission check done in application layer)
CREATE POLICY "Allow write for authenticated users" ON campaign_store_own_staff
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow write for authenticated users" ON campaign_support_requests
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "Allow write for authenticated users" ON campaign_support_staff
  FOR ALL USING (auth.role() = 'authenticated');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_campaign_store_own_staff_campaign_store
  ON campaign_store_own_staff(campaign_id, store_id);

CREATE INDEX IF NOT EXISTS idx_campaign_support_requests_campaign
  ON campaign_support_requests(campaign_id);

CREATE INDEX IF NOT EXISTS idx_campaign_support_requests_requesting
  ON campaign_support_requests(campaign_id, requesting_store_id);

CREATE INDEX IF NOT EXISTS idx_campaign_support_staff_request
  ON campaign_support_staff(support_request_id);
