-- 允許天數欄位使用小數 (支援半天計算)
-- 將 integer 改為 numeric(5,1) 以支援小數點一位

-- 修改 monthly_staff_status 表的天數欄位
ALTER TABLE monthly_staff_status 
  ALTER COLUMN work_days TYPE numeric(5,1),
  ALTER COLUMN partial_month_days TYPE numeric(5,1);

-- 註解說明
COMMENT ON COLUMN monthly_staff_status.work_days IS '工作天數（支援小數，如 15.5 天）';
COMMENT ON COLUMN monthly_staff_status.partial_month_days IS '非整月實際工作天數（支援小數，如 15.5 天）';
