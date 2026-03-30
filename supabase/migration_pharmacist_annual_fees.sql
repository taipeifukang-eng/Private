-- =====================================================
-- 藥師常年會費申請記錄
-- =====================================================

-- Storage bucket for payment proof photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pharmacist-fee-proofs',
  'pharmacist-fee-proofs',
  false,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: service_role 才可上傳 / 刪除
DROP POLICY IF EXISTS "service_role_fee_proofs_all" ON storage.objects;
CREATE POLICY "service_role_fee_proofs_all"
  ON storage.objects FOR ALL
  TO service_role
  USING (bucket_id = 'pharmacist-fee-proofs')
  WITH CHECK (bucket_id = 'pharmacist-fee-proofs');

-- 主資料表
CREATE TABLE IF NOT EXISTS pharmacist_annual_fees (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code       VARCHAR(20) NOT NULL,
  association_city    TEXT NOT NULL,               -- 縣市公會
  fee_year            INTEGER NOT NULL,            -- 申請年度（西元年）
  fee_period_start    DATE,                        -- 繳費期間起
  fee_period_end      DATE,                        -- 繳費期間迄
  payment_proof_path  TEXT,                        -- Storage 路徑
  notes               TEXT,                        -- 備註
  created_by          TEXT,                        -- 登記人（email）
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_pharmacist_annual_fees_code
  ON pharmacist_annual_fees (employee_code);
CREATE INDEX IF NOT EXISTS idx_pharmacist_annual_fees_year
  ON pharmacist_annual_fees (employee_code, fee_year);

-- 自動更新 updated_at
CREATE OR REPLACE FUNCTION update_pharmacist_annual_fees_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pharmacist_annual_fees_updated_at ON pharmacist_annual_fees;
CREATE TRIGGER trg_pharmacist_annual_fees_updated_at
  BEFORE UPDATE ON pharmacist_annual_fees
  FOR EACH ROW EXECUTE FUNCTION update_pharmacist_annual_fees_updated_at();

-- RLS
ALTER TABLE pharmacist_annual_fees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_annual_fees" ON pharmacist_annual_fees;
CREATE POLICY "service_role_all_annual_fees"
  ON pharmacist_annual_fees FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated_read_annual_fees" ON pharmacist_annual_fees;
CREATE POLICY "authenticated_read_annual_fees"
  ON pharmacist_annual_fees FOR SELECT
  TO authenticated
  USING (true);
