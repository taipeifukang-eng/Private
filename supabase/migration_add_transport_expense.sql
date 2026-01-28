-- 為員工月狀態新增交通費用欄位
-- 2026-01-28

-- 添加交通費用欄位到 monthly_staff_status 表
ALTER TABLE monthly_staff_status
ADD COLUMN IF NOT EXISTS monthly_transport_expense INTEGER DEFAULT NULL,
ADD COLUMN IF NOT EXISTS transport_expense_notes TEXT DEFAULT NULL;

-- 添加註解說明
COMMENT ON COLUMN monthly_staff_status.monthly_transport_expense IS '本月交通費用：員工當月的交通補助金額（元）';
COMMENT ON COLUMN monthly_staff_status.transport_expense_notes IS '交通費用備註：交通費用的說明或特殊情況';
