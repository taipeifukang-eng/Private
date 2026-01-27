-- Migration: 新增門市簡稱和人資系統門市代碼欄位
-- 執行日期: 2026-01-24

-- 新增簡稱欄位
ALTER TABLE stores ADD COLUMN IF NOT EXISTS short_name TEXT;

-- 新增人資系統門市代碼欄位
ALTER TABLE stores ADD COLUMN IF NOT EXISTS hr_store_code TEXT;

-- 為人資系統代碼建立索引（可能會用於匯出對接查詢）
CREATE INDEX IF NOT EXISTS idx_stores_hr_store_code ON stores(hr_store_code) WHERE hr_store_code IS NOT NULL;

-- 新增欄位註解
COMMENT ON COLUMN stores.short_name IS '門市簡稱，用於簡化顯示';
COMMENT ON COLUMN stores.hr_store_code IS '人資系統門市代碼，用於資料匯出對接';
