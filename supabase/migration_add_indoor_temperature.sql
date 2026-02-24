-- ============================================
-- 新增室內溫度欄位 indoor_temperature
-- 日期: 2026-02-24
-- 說明: 記錄巡店時門市室內溫度（必填）
-- ============================================

-- 新增欄位
ALTER TABLE inspection_masters 
ADD COLUMN IF NOT EXISTS indoor_temperature DECIMAL(4,1);

-- 欄位說明
COMMENT ON COLUMN inspection_masters.indoor_temperature IS '室內溫度（攝氏）';
