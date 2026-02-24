-- ============================================
-- 新增巡店類型欄位 inspection_type
-- 日期: 2026-02-24
-- 說明: 區分「督導巡店」與未來的「經理巡店」等類型
--       預設值為 'supervisor'，現有紀錄全部視為督導巡店
-- ============================================

-- 新增欄位
ALTER TABLE inspection_masters 
ADD COLUMN IF NOT EXISTS inspection_type VARCHAR(20) DEFAULT 'supervisor';

-- 將所有現有紀錄設定為督導巡店
UPDATE inspection_masters SET inspection_type = 'supervisor' WHERE inspection_type IS NULL;

-- 建立索引（加速依類型查詢）
CREATE INDEX IF NOT EXISTS idx_inspection_masters_type ON inspection_masters(inspection_type);

-- 加上欄位說明
COMMENT ON COLUMN inspection_masters.inspection_type IS '巡店類型：supervisor=督導巡店, manager=經理巡店';
