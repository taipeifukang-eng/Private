-- =====================================================
-- 藥師主檔擴充資料表
-- 儲存 monthly_staff_status / store_employees 沒有的藥師專屬欄位
-- =====================================================

CREATE TABLE IF NOT EXISTS pharmacist_profiles (
  employee_code        VARCHAR(20) PRIMARY KEY,          -- 員工編號 (FK with store_employees)
  school               TEXT,                              -- 畢業學校
  is_responsible_pharmacist BOOLEAN DEFAULT false,        -- 是否為負責藥師
  license_renewal_date DATE,                              -- 執業執照更新日期
  notes                TEXT,                              -- 備註
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- 自動更新 updated_at
CREATE OR REPLACE FUNCTION update_pharmacist_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pharmacist_profiles_updated_at ON pharmacist_profiles;
CREATE TRIGGER trg_pharmacist_profiles_updated_at
  BEFORE UPDATE ON pharmacist_profiles
  FOR EACH ROW EXECUTE FUNCTION update_pharmacist_profiles_updated_at();

-- RLS
ALTER TABLE pharmacist_profiles ENABLE ROW LEVEL SECURITY;

-- 有 pharmacist.management.view 或 edit 權限的人才能讀取
-- (透過 API server-side 用 service role 操作，RLS 以 service role bypass 為主)
-- 開放 authenticated 讀取，寫入由 API 控管
CREATE POLICY "authenticated_read_pharmacist_profiles"
  ON pharmacist_profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service_role_all_pharmacist_profiles"
  ON pharmacist_profiles FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
