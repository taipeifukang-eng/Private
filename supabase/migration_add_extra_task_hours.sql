-- 為員工月狀態新增外務相關欄位
-- 2026-01-28

-- 添加外務時數欄位到 monthly_staff_status 表
ALTER TABLE monthly_staff_status
ADD COLUMN IF NOT EXISTS extra_task_planned_hours DECIMAL(5,1) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS extra_task_external_hours DECIMAL(5,1) DEFAULT NULL;

-- 添加註解說明
COMMENT ON COLUMN monthly_staff_status.extra_task_planned_hours IS '該店規劃實上時數：當員工被指派長照外務或診所業務時，該店規劃的實際上班時數';
COMMENT ON COLUMN monthly_staff_status.extra_task_external_hours IS '外務時數：員工執行長照外務或診所業務的時數';
