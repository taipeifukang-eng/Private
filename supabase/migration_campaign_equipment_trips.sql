-- =====================================================
-- 活動用品車次記錄表
-- 用途：記錄母親節/周年慶活動的 5 套活動用品
--       在哪一天從哪裡搬到哪裡
-- 地點分類：林森街倉庫 | 車上 | 各門市名稱
-- =====================================================

CREATE TABLE IF NOT EXISTS campaign_equipment_trips (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id     UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  set_number      INTEGER NOT NULL CHECK (set_number BETWEEN 1 AND 5),
  trip_date       DATE NOT NULL,
  from_location   TEXT NOT NULL,   -- 林森街倉庫 | 車上 | 門市名稱
  to_location     TEXT NOT NULL,   -- 林森街倉庫 | 車上 | 門市名稱
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  created_by      UUID REFERENCES auth.users(id)
);

-- 索引：常依活動查詢
CREATE INDEX IF NOT EXISTS idx_equipment_trips_campaign
  ON campaign_equipment_trips(campaign_id, trip_date);

-- updated_at 觸發器
CREATE OR REPLACE FUNCTION update_equipment_trips_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_equipment_trips_updated_at ON campaign_equipment_trips;
CREATE TRIGGER trg_equipment_trips_updated_at
  BEFORE UPDATE ON campaign_equipment_trips
  FOR EACH ROW EXECUTE FUNCTION update_equipment_trips_updated_at();

-- RLS
ALTER TABLE campaign_equipment_trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "campaign_equipment_trips_select" ON campaign_equipment_trips;
DROP POLICY IF EXISTS "campaign_equipment_trips_insert" ON campaign_equipment_trips;
DROP POLICY IF EXISTS "campaign_equipment_trips_update" ON campaign_equipment_trips;
DROP POLICY IF EXISTS "campaign_equipment_trips_delete" ON campaign_equipment_trips;

-- 登入用戶皆可查看
CREATE POLICY "campaign_equipment_trips_select"
  ON campaign_equipment_trips FOR SELECT
  TO authenticated USING (true);

-- 需通過 API Server-Side 驗證後才能寫入（API 用 service_role 或驗證權限）
CREATE POLICY "campaign_equipment_trips_insert"
  ON campaign_equipment_trips FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = created_by OR created_by IS NULL);

CREATE POLICY "campaign_equipment_trips_update"
  ON campaign_equipment_trips FOR UPDATE
  TO authenticated USING (true);

CREATE POLICY "campaign_equipment_trips_delete"
  ON campaign_equipment_trips FOR DELETE
  TO authenticated USING (true);
