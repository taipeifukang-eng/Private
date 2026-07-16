-- ============================================================
-- 總務服務中心 - 維修回報聯絡與資源欄位
-- 說明：
--   新版總務服務中心沿用 maintenance_requests / updates / photos，
--   但新增回報流程需要儲存資源類型、問題類型與門市指定聯絡人。
--   舊總務組管理頁面不傳這些欄位時仍維持原本運作。
-- ============================================================

ALTER TABLE maintenance_requests
  ADD COLUMN IF NOT EXISTS resource_type TEXT,
  ADD COLUMN IF NOT EXISTS issue_type TEXT,
  ADD COLUMN IF NOT EXISTS contact_name TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT;

COMMENT ON COLUMN maintenance_requests.resource_type IS '總務服務中心資源類型：equipment/facility/material';
COMMENT ON COLUMN maintenance_requests.issue_type IS '門市填寫的問題類型';
COMMENT ON COLUMN maintenance_requests.contact_name IS '門市指定的維修聯絡人姓名';
COMMENT ON COLUMN maintenance_requests.contact_phone IS '門市指定的維修聯絡人電話';

CREATE INDEX IF NOT EXISTS idx_maintenance_requests_resource_type
ON maintenance_requests (resource_type);
