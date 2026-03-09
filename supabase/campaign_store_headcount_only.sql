-- =====================================================
-- 新增 supervisor_count 欄位到 campaign_store_headcount
-- （資料表與 Policy 已存在，僅補欄位）
-- =====================================================
ALTER TABLE campaign_store_headcount
  ADD COLUMN IF NOT EXISTS supervisor_count INT DEFAULT 0 CHECK (supervisor_count >= 0);
