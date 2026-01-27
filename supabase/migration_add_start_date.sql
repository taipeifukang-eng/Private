-- 在 monthly_staff_status 表中加入到職日期欄位
-- 日期: 2026-01-25
-- 說明: 加入 start_date 欄位以記錄員工到職日期

-- 加入 start_date 欄位
ALTER TABLE monthly_staff_status ADD COLUMN IF NOT EXISTS start_date DATE;

-- 加入註解說明
COMMENT ON COLUMN monthly_staff_status.start_date IS '員工到職日期';
