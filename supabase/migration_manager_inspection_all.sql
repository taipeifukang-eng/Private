-- =====================================================
-- 經理巡店功能整合遷移腳本
-- 日期: 2025-02-24
-- 說明: 一次性執行所有需要的欄位新增與 RLS 修正
--       請在 Supabase SQL Editor 中執行本腳本
-- =====================================================

-- =====================================================
-- 1. 新增 inspection_type 欄位（如果還沒有）
-- =====================================================
ALTER TABLE inspection_masters 
ADD COLUMN IF NOT EXISTS inspection_type VARCHAR(20) DEFAULT 'supervisor';

-- 將所有現有紀錄設定為督導巡店
UPDATE inspection_masters SET inspection_type = 'supervisor' WHERE inspection_type IS NULL;

-- 建立索引
CREATE INDEX IF NOT EXISTS idx_inspection_masters_type ON inspection_masters(inspection_type);

COMMENT ON COLUMN inspection_masters.inspection_type IS '巡店類型：supervisor=督導巡店, manager=經理巡店';

-- =====================================================
-- 2. 新增 supervisor_signature_url 欄位（如果還沒有）
-- =====================================================
ALTER TABLE inspection_masters
  ADD COLUMN IF NOT EXISTS supervisor_signature_url TEXT;

COMMENT ON COLUMN inspection_masters.supervisor_signature_url IS '督導簽名 base64 圖片';

-- =====================================================
-- 3. 新增 indoor_temperature 欄位（如果還沒有）
-- =====================================================
ALTER TABLE inspection_masters
  ADD COLUMN IF NOT EXISTS indoor_temperature DECIMAL(4,1);

COMMENT ON COLUMN inspection_masters.indoor_temperature IS '室內溫度（攝氏）';

-- =====================================================
-- 4. 修復 inspection_masters INSERT RLS 策略
--    確保已認證用戶可以新增自己的記錄
-- =====================================================
DROP POLICY IF EXISTS "督導可以建立巡店記錄" ON inspection_masters;
CREATE POLICY "督導可以建立巡店記錄"
ON inspection_masters
FOR INSERT
TO authenticated
WITH CHECK (
  inspector_id = auth.uid()
);

-- =====================================================
-- 5. 修復 inspection_masters UPDATE RLS 策略
--    允許 status 從 draft → completed
-- =====================================================
DROP POLICY IF EXISTS "督導可以更新自己的巡店記錄" ON inspection_masters;
CREATE POLICY "督導可以更新自己的巡店記錄"
ON inspection_masters
FOR UPDATE
TO authenticated
USING (
  inspector_id = auth.uid()
  AND status IN ('draft', 'in_progress')
)
WITH CHECK (
  inspector_id = auth.uid()
);

-- =====================================================
-- 6. 修復 inspection_results 的 RLS 策略
--    允許在 completed 狀態下插入明細
-- =====================================================
DROP POLICY IF EXISTS "督導可以管理自己巡店記錄的結果明細" ON inspection_results;
CREATE POLICY "督導可以管理自己巡店記錄的結果明細"
ON inspection_results
FOR ALL
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM inspection_masters im
    WHERE im.id = inspection_results.inspection_id
    AND im.inspector_id = auth.uid()
    AND im.status != 'closed'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM inspection_masters im
    WHERE im.id = inspection_results.inspection_id
    AND im.inspector_id = auth.uid()
  )
);

-- =====================================================
-- 7. 確保 inspection_on_duty_staff 表存在
-- =====================================================
CREATE TABLE IF NOT EXISTS inspection_on_duty_staff (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inspection_id UUID NOT NULL REFERENCES inspection_masters(id) ON DELETE CASCADE,
  employee_code VARCHAR(20),
  employee_name VARCHAR(100) NOT NULL,
  position VARCHAR(100),
  is_duty_supervisor BOOLEAN DEFAULT FALSE,
  is_manually_added BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inspection_on_duty_staff_inspection_id 
  ON inspection_on_duty_staff(inspection_id);

-- RLS for inspection_on_duty_staff
ALTER TABLE inspection_on_duty_staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inspection_on_duty_staff_select" ON inspection_on_duty_staff;
CREATE POLICY "inspection_on_duty_staff_select" ON inspection_on_duty_staff
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "inspection_on_duty_staff_insert" ON inspection_on_duty_staff;
CREATE POLICY "inspection_on_duty_staff_insert" ON inspection_on_duty_staff
FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "inspection_on_duty_staff_delete" ON inspection_on_duty_staff;
CREATE POLICY "inspection_on_duty_staff_delete" ON inspection_on_duty_staff
FOR DELETE TO authenticated
USING (true);

-- =====================================================
-- 8. 驗證：確認欄位存在
-- =====================================================
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'inspection_masters'
  AND column_name IN ('inspection_type', 'supervisor_signature_url', 'indoor_temperature', 'supervisor_notes', 'gps_latitude', 'gps_longitude', 'signature_photo_url')
ORDER BY column_name;

-- =====================================================
-- 9. 驗證：確認 RLS 策略
-- =====================================================
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('inspection_masters', 'inspection_results', 'inspection_on_duty_staff')
ORDER BY tablename, cmd;
