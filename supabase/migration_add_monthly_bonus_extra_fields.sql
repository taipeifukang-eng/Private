-- 新增每月獎金匯入欄位
-- 日期: 2026-07-07

ALTER TABLE monthly_bonus_records
ADD COLUMN IF NOT EXISTS manager_supervisor_quarterly_bonus NUMERIC(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS opening_abnormal_responsibility_amount NUMERIC(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS bonus_difference_adjustment NUMERIC(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS other_bonus NUMERIC(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS other_bonus_note TEXT;

COMMENT ON COLUMN monthly_bonus_records.manager_supervisor_quarterly_bonus IS '經理.督導季獎金';
COMMENT ON COLUMN monthly_bonus_records.opening_abnormal_responsibility_amount IS '開店異常責任金額';
COMMENT ON COLUMN monthly_bonus_records.bonus_difference_adjustment IS '獎金差額調整';
COMMENT ON COLUMN monthly_bonus_records.other_bonus IS '其他獎金';
COMMENT ON COLUMN monthly_bonus_records.other_bonus_note IS '其他獎金備註';
