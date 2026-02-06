-- 添加代理店長欄位到每月人員狀態表
-- 用於標記主任/副店長/督導是否擔任該月的代理店長

ALTER TABLE monthly_staff_status 
ADD COLUMN IF NOT EXISTS is_acting_manager BOOLEAN DEFAULT false;

COMMENT ON COLUMN monthly_staff_status.is_acting_manager IS '是否擔任代理店長（適用於主任、副店長、督導）';
