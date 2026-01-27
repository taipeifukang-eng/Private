-- 新增門市每月統計資料欄位
-- 執行日期: 2026-01-27

-- 添加門市基本資訊欄位（若不存在）
ALTER TABLE monthly_store_summary
  ADD COLUMN IF NOT EXISTS store_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS store_code VARCHAR(20);

-- 添加應有人員和營業狀態欄位到 monthly_store_summary
ALTER TABLE monthly_store_summary
  ADD COLUMN IF NOT EXISTS total_staff_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS admin_staff_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS newbie_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS business_days INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_gross_profit NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_customer_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prescription_addon_only_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS regular_prescription_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chronic_prescription_count INTEGER DEFAULT 0;

-- 註解說明
COMMENT ON COLUMN monthly_store_summary.store_name IS '門市名稱（快照）';
COMMENT ON COLUMN monthly_store_summary.store_code IS '門市代碼（快照）';
COMMENT ON COLUMN monthly_store_summary.total_staff_count IS '應有門市人數';
COMMENT ON COLUMN monthly_store_summary.admin_staff_count IS '應有行政人數';
COMMENT ON COLUMN monthly_store_summary.newbie_count IS '應有新人人數';
COMMENT ON COLUMN monthly_store_summary.business_days IS '營業天數';
COMMENT ON COLUMN monthly_store_summary.total_gross_profit IS '總毛利';
COMMENT ON COLUMN monthly_store_summary.total_customer_count IS '總來客數';
COMMENT ON COLUMN monthly_store_summary.prescription_addon_only_count IS '單純處方加購來客數';
COMMENT ON COLUMN monthly_store_summary.regular_prescription_count IS '一般箋張數';
COMMENT ON COLUMN monthly_store_summary.chronic_prescription_count IS '慢箋張數';
